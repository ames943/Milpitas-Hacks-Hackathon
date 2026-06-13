import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import Papa from 'papaparse';
import wav from 'node-wav';
import pitchfinder from 'pitchfinder';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

import { supabase } from '../lib/supabase';
import { extractTranscriptData, ClaudeParseError } from '../lib/claudeClient';
import { getLatestDimensionScores, blendAndInsertDimensions } from '../lib/dimensionUpdate';
import {
  computeNewCognitiveLoad,
  computeNewRecoveryCapacity,
  computeNewEmotionalRegulation,
} from '../lib/signalAdjustments';
import {
  computeFrameEnergies,
  computeAdaptiveThreshold,
  classifyFrames,
  countPauses,
  sampleVariance,
} from '../lib/audioFeatures';
import { parseSleepRows, computeSleepStats } from '../lib/sleepStats';

// Set ffmpeg binary path once at module load time.
if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

const router = Router();
const SIGNAL_CONFIDENCE = 20; // Each signal type contributes 20 points to confidence.

// ── Multer instances (one per route with independent size limits) ──────────────

function upload(limitBytes: number) {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: limitBytes } });
}

const uploadPdf   = upload(10 * 1024 * 1024).single('file'); // 10 MB
const uploadCsv   = upload(2  * 1024 * 1024).single('file'); //  2 MB
const uploadAudio = upload(5  * 1024 * 1024).single('file'); //  5 MB

/** Wraps a multer RequestHandler in a Promise for use in async route handlers. */
function runUpload(
  middleware: (req: Request, res: Response, cb: (err?: unknown) => void) => void,
  req: Request,
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    middleware(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

function handleMulterError(err: unknown, limitLabel: string, res: Response): boolean {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ success: false, error: `File too large. Maximum is ${limitLabel}.` });
    } else {
      res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    }
    return true;
  }
  return false;
}

/** Validates that a prior dimension_scores row exists (survey must come first). */
function requirePriorScores(
  latest: Awaited<ReturnType<typeof getLatestDimensionScores>>,
  res: Response,
): latest is NonNullable<typeof latest> {
  if (!latest) {
    res.status(409).json({
      success: false,
      error: 'No dimension scores found for this user. Please complete the survey first.',
    });
    return false;
  }
  return true;
}

/**
 * Inserts a signal_data row for the given user.
 * raw_data and processed_data are stored as JSONB.
 */
async function storeSignalData(
  userId: string,
  signalType: 'transcript' | 'sleep' | 'voice',
  rawData: Record<string, unknown>,
  processedData: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase
    .from('signal_data')
    .insert({
      user_id: userId,
      signal_type: signalType,
      raw_data: rawData,
      processed_data: processedData,
      confidence_contribution: SIGNAL_CONFIDENCE,
    })
    .select('id')
    .single();

  if (error) throw error;
  return (data as { id: string }).id;
}

// ── Audio conversion helper ────────────────────────────────────────────────────

const AUDIO_MIME_TO_EXT: Record<string, string> = {
  'audio/webm':   '.webm',
  'audio/mpeg':   '.mp3',
  'audio/mp3':    '.mp3',
  'audio/mp4':    '.m4a',
  'audio/x-m4a':  '.m4a',
  'audio/aac':    '.aac',
  'audio/ogg':    '.ogg',
};
const WAV_MIMES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);
const ACCEPTED_AUDIO_MIMES = new Set([...Object.keys(AUDIO_MIME_TO_EXT), ...WAV_MIMES]);

/**
 * Converts an audio buffer to a 44100 Hz mono 16-bit PCM WAV buffer using ffmpeg.
 * Output at 44100 Hz ensures 20ms frames (882 samples) cover the ≥100 Hz pitch
 * detection range that fits within the YIN autocorrelation window.
 */
async function convertToWav(inputBuffer: Buffer, inputExt: string): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not found');

  const id = crypto.randomUUID();
  const inputPath  = path.join(os.tmpdir(), `mosaic-${id}${inputExt}`);
  const outputPath = path.join(os.tmpdir(), `mosaic-${id}.wav`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioChannels(1)          // mono
        .audioFrequency(44100)     // 44.1 kHz for pitch detection coverage
        .audioCodec('pcm_s16le')   // 16-bit signed PCM
        .format('wav')
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(outputPath);
    });

    return await fs.readFile(outputPath);
  } finally {
    await Promise.all([
      fs.unlink(inputPath).catch(() => {}),
      fs.unlink(outputPath).catch(() => {}),
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/signals/transcript
// ─────────────────────────────────────────────────────────────────────────────

router.post('/transcript', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await runUpload(uploadPdf, req, res);
  } catch (err) {
    if (handleMulterError(err, '10 MB', res)) return;
    return next(err);
  }

  try {
    const user_id = req.body?.user_id as string | undefined;
    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      return res.status(400).json({ success: false, error: 'user_id (string) is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Field name must be "file".' });
    }
    if (req.file.mimetype !== 'application/pdf') {
      return res.status(422).json({
        success: false,
        error: `Expected application/pdf, received ${req.file.mimetype}`,
      });
    }

    // Extract text from PDF.
    const parsed = await pdfParse(req.file.buffer);
    const extractedText = parsed.text ?? '';
    if (extractedText.trim().length < 50) {
      return res.status(422).json({
        success: false,
        error:
          'Could not extract readable text from this PDF (fewer than 50 characters). ' +
          'Scanned/image-only PDFs are not supported — please upload a text-based PDF.',
      });
    }

    // Check survey prerequisite.
    const latest = await getLatestDimensionScores(user_id);
    if (!requirePriorScores(latest, res)) return;

    // Call Claude to extract structured academic data.
    let transcriptData: Awaited<ReturnType<typeof extractTranscriptData>>;
    try {
      transcriptData = await extractTranscriptData(extractedText);
    } catch (err) {
      if (err instanceof ClaudeParseError) {
        return res.status(422).json({
          success: false,
          error: `Could not parse Claude response: ${err.message}`,
          claude_raw_output: err.rawOutput,
        });
      }
      if ((err as Error).message?.includes('ANTHROPIC_API_KEY')) {
        return res.status(503).json({ success: false, error: (err as Error).message });
      }
      throw err;
    }

    // Compute cognitive_load adjustment.
    const new_cognitive_load = computeNewCognitiveLoad(
      Number(latest.cognitive_load),
      transcriptData.grade_trend,
      transcriptData.course_load,
      transcriptData.has_ap_honors,
    );

    // Persist signal and new dimension snapshot.
    const signalId = await storeSignalData(
      user_id,
      'transcript',
      // Raw: extracted text truncated to 5000 chars for storage.
      { text: extractedText.substring(0, 5000), original_filename: req.file.originalname },
      transcriptData as unknown as Record<string, unknown>,
    );

    const newDimRow = await blendAndInsertDimensions(
      user_id,
      latest,
      { cognitive_load: new_cognitive_load },
      SIGNAL_CONFIDENCE,
      `Transcript signal processed. GPA: ${transcriptData.gpa.toFixed(2)}, ` +
        `${transcriptData.course_load} courses, grade trend: ${transcriptData.grade_trend}. ` +
        `cognitive_load adjusted from ${Math.round(Number(latest.cognitive_load))} → ${new_cognitive_load}.`,
    );

    return res.status(201).json({
      success: true,
      data: {
        signal: { id: signalId, signal_type: 'transcript', confidence_contribution: SIGNAL_CONFIDENCE },
        transcript_analysis: transcriptData,
        dimension_scores: newDimRow,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. POST /api/signals/sleep
// ─────────────────────────────────────────────────────────────────────────────

router.post('/sleep', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await runUpload(uploadCsv, req, res);
  } catch (err) {
    if (handleMulterError(err, '2 MB', res)) return;
    return next(err);
  }

  try {
    const user_id = req.body?.user_id as string | undefined;
    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      return res.status(400).json({ success: false, error: 'user_id (string) is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Field name must be "file".' });
    }

    const csvText = req.file.buffer.toString('utf-8');
    const parseResult = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
      return res.status(422).json({
        success: false,
        error: `CSV parse error: ${parseResult.errors[0].message}`,
      });
    }

    const headers = parseResult.meta.fields ?? [];
    let parsedSleep: ReturnType<typeof parseSleepRows>;
    try {
      parsedSleep = parseSleepRows(parseResult.data, headers);
    } catch (colErr) {
      return res.status(422).json({ success: false, error: colErr });
    }

    if (parsedSleep.nights.length < 3) {
      return res.status(422).json({
        success: false,
        error:
          `Only ${parsedSleep.nights.length} valid night(s) found. ` +
          'At least 3 nights of data are required for a meaningful sleep variability calculation.',
      });
    }

    const stats = computeSleepStats(parsedSleep.nights);

    // Check survey prerequisite.
    const latest = await getLatestDimensionScores(user_id);
    if (!requirePriorScores(latest, res)) return;

    const new_recovery_capacity = computeNewRecoveryCapacity(
      Number(latest.recovery_capacity),
      stats.avg_sleep_hours,
      stats.sleep_variability_hours,
    );

    const signalId = await storeSignalData(
      user_id,
      'sleep',
      // Raw rows: cap at 100 for storage.
      { rows: parsedSleep.nights.slice(0, 100), source_columns: { date: parsedSleep.dateColumn, duration: parsedSleep.durationColumn } },
      {
        avg_sleep_hours: Math.round(stats.avg_sleep_hours * 100) / 100,
        sleep_variability_hours: Math.round(stats.sleep_variability_hours * 100) / 100,
        nights_analyzed: stats.nights_analyzed,
      },
    );

    const newDimRow = await blendAndInsertDimensions(
      user_id,
      latest,
      { recovery_capacity: new_recovery_capacity },
      SIGNAL_CONFIDENCE,
      `Sleep signal processed. ${stats.nights_analyzed} nights, avg ${stats.avg_sleep_hours.toFixed(1)}h, ` +
        `variability ±${stats.sleep_variability_hours.toFixed(2)}h (sample stdev). ` +
        `recovery_capacity adjusted from ${Math.round(Number(latest.recovery_capacity))} → ${new_recovery_capacity}.`,
    );

    return res.status(201).json({
      success: true,
      data: {
        signal: { id: signalId, signal_type: 'sleep', confidence_contribution: SIGNAL_CONFIDENCE },
        sleep_analysis: {
          avg_sleep_hours: Math.round(stats.avg_sleep_hours * 100) / 100,
          sleep_variability_hours: Math.round(stats.sleep_variability_hours * 100) / 100,
          nights_analyzed: stats.nights_analyzed,
        },
        dimension_scores: newDimRow,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. POST /api/signals/voice
// ─────────────────────────────────────────────────────────────────────────────

router.post('/voice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await runUpload(uploadAudio, req, res);
  } catch (err) {
    if (handleMulterError(err, '5 MB', res)) return;
    return next(err);
  }

  try {
    const user_id = req.body?.user_id as string | undefined;
    if (!user_id || typeof user_id !== 'string' || !user_id.trim()) {
      return res.status(400).json({ success: false, error: 'user_id (string) is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded. Field name must be "file".' });
    }

    const mimeType = req.file.mimetype.toLowerCase();
    if (!ACCEPTED_AUDIO_MIMES.has(mimeType)) {
      return res.status(422).json({
        success: false,
        error: `Unsupported audio format "${mimeType}". Accepted: webm, mp3, wav, m4a.`,
      });
    }

    // Decode to PCM: WAV files decode directly; others go through ffmpeg first.
    let wavBuffer: Buffer;
    try {
      if (WAV_MIMES.has(mimeType)) {
        wavBuffer = req.file.buffer;
      } else {
        const ext = AUDIO_MIME_TO_EXT[mimeType] ?? '.audio';
        wavBuffer = await convertToWav(req.file.buffer, ext);
      }
    } catch (convertErr) {
      return res.status(422).json({
        success: false,
        error: `Audio conversion failed: ${(convertErr as Error).message}`,
      });
    }

    const decoded = wav.decode(wavBuffer);
    const samples = decoded.channelData[0]; // Float32Array in [-1, 1]
    const sampleRate = decoded.sampleRate;
    const durationSeconds = samples.length / sampleRate;

    if (durationSeconds < 5) {
      return res.status(422).json({
        success: false,
        error: `Audio is too short (${durationSeconds.toFixed(1)}s). Minimum is 5 seconds.`,
      });
    }

    // ── Short-time energy analysis (20ms frames) ─────────────────────────────
    // Frame size: 20ms — per spec. At 44100 Hz this is 882 samples.
    const frameSize = Math.round(sampleRate * 0.02);
    const energies = computeFrameEnergies(samples, frameSize);

    // Guard: truly silent audio (max energy near zero) can't be analyzed.
    const maxEnergy = Math.max(...Array.from(energies));
    if (maxEnergy < 1e-8) {
      return res.status(422).json({ success: false, error: 'Audio appears to be silent.' });
    }

    const threshold = computeAdaptiveThreshold(energies);
    const voiced = classifyFrames(energies, threshold);

    const voicedCount = voiced.filter(Boolean).length;
    if (voicedCount === 0) {
      return res.status(422).json({
        success: false,
        error: 'No voiced speech detected in the audio.',
      });
    }

    const speaking_ratio = voicedCount / voiced.length;
    const num_pauses = countPauses(voiced, sampleRate, frameSize);

    // ── Pitch detection on voiced frames (YIN algorithm) ─────────────────────
    // Filter: 100-500 Hz human voice F0 range. Lower bound is 100 Hz because
    // 20ms frames at 44100 Hz (882 samples) allow reliable detection ≥ 100 Hz.
    // Very low male voices (<100 Hz) are outside this range — documented limitation.
    const detectPitch = pitchfinder.YIN({ sampleRate, threshold: 0.1 });
    const pitchValues: number[] = [];
    const voicedEnergies: number[] = [];

    for (let i = 0; i < voiced.length; i++) {
      if (!voiced[i]) continue;
      voicedEnergies.push(energies[i]);

      const frame = samples.slice(i * frameSize, (i + 1) * frameSize);
      const pitch = detectPitch(frame);
      if (pitch !== null && pitch >= 100 && pitch <= 500) {
        pitchValues.push(pitch);
      }
    }

    // pitch_variance_hz = sample variance of F0 across voiced frames (in Hz).
    // Lower variance → flatter affect — proxy for emotional expressiveness.
    // NOT a clinical measure; appropriate hedging required in UI (see signalAdjustments.ts).
    const pitch_variance_hz = sampleVariance(pitchValues);
    const energy_variance    = sampleVariance(voicedEnergies);
    const frames_analyzed    = voiced.length;

    const processedData = {
      duration_seconds:    Math.round(durationSeconds * 100) / 100,
      speaking_ratio:      Math.round(speaking_ratio * 1000) / 1000,
      num_pauses,
      pitch_variance_hz:   Math.round(pitch_variance_hz * 100) / 100,
      energy_variance:     energy_variance,
      frames_analyzed,
    };

    // Check survey prerequisite.
    const latest = await getLatestDimensionScores(user_id);
    if (!requirePriorScores(latest, res)) return;

    const new_emotional_regulation = computeNewEmotionalRegulation(
      Number(latest.emotional_regulation),
      pitch_variance_hz,
    );

    const signalId = await storeSignalData(
      user_id,
      'voice',
      {
        original_filename: req.file.originalname,
        original_mimetype: req.file.mimetype,
        file_size_bytes: req.file.size,
      },
      processedData,
    );

    const newDimRow = await blendAndInsertDimensions(
      user_id,
      latest,
      { emotional_regulation: new_emotional_regulation },
      SIGNAL_CONFIDENCE,
      `Voice signal processed. Duration: ${durationSeconds.toFixed(1)}s, ` +
        `speaking ratio: ${(speaking_ratio * 100).toFixed(1)}%, pauses: ${num_pauses}, ` +
        `pitch variance: ${pitch_variance_hz.toFixed(1)} Hz. ` +
        `emotional_regulation adjusted from ${Math.round(Number(latest.emotional_regulation))} → ${new_emotional_regulation}.`,
    );

    return res.status(201).json({
      success: true,
      data: {
        signal: { id: signalId, signal_type: 'voice', confidence_contribution: SIGNAL_CONFIDENCE },
        voice_analysis: processedData,
        dimension_scores: newDimRow,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
