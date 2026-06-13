/**
 * Unit tests for all signal processing pure functions.
 * No database, no Claude API, no filesystem I/O.
 *
 * Sections:
 *   1. sleepStats — normalizeDurationToHours, sampleStdev, parseSleepRows, computeSleepStats
 *   2. signalAdjustments — computeNewCognitiveLoad, computeNewRecoveryCapacity, computeNewEmotionalRegulation
 *   3. audioFeatures — computeFrameEnergies, computeAdaptiveThreshold, classifyFrames, countPauses, sampleVariance
 *   4. Sleep CSV fixture — parses sample_sleep.csv end-to-end
 *   5. Voice WAV pipeline — generates synthetic WAV, runs full feature extraction pipeline
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';

import { normalizeDurationToHours, sampleStdev, parseSleepRows, computeSleepStats } from './sleepStats';
import { computeNewCognitiveLoad, computeNewRecoveryCapacity, computeNewEmotionalRegulation } from './signalAdjustments';
import {
  computeFrameEnergies,
  computeAdaptiveThreshold,
  classifyFrames,
  countPauses,
  sampleVariance,
} from './audioFeatures';
import wav from 'node-wav';
import pitchfinder from 'pitchfinder';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generates a synthetic 16-bit mono WAV buffer.
 * Starts with SILENCE_SECONDS of silence so the adaptive threshold has a real noise
 * floor to anchor against — without silence, a pure constant-energy sine fools the
 * 1.5× p10 threshold into classifying all frames as silent.
 */
function generateSineWav(
  frequencyHz = 220,
  durationSeconds = 6,
  sampleRate = 44100,
): Buffer {
  const SILENCE_SECONDS = 1.0;
  const silenceSamples  = Math.floor(sampleRate * SILENCE_SECONDS);
  const sineSamples     = Math.floor(sampleRate * (durationSeconds - SILENCE_SECONDS));
  const numSamples      = silenceSamples + sineSamples;
  const dataSize        = numSamples * 2; // 16-bit = 2 bytes/sample
  const fileSize        = 36 + dataSize;

  // Buffer.alloc zeroes memory, so silence samples are already correct (0).
  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;

  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(fileSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16,           o); o += 4; // fmt chunk size
  buf.writeUInt16LE(1,            o); o += 2; // PCM
  buf.writeUInt16LE(1,            o); o += 2; // mono
  buf.writeUInt32LE(sampleRate,   o); o += 4;
  buf.writeUInt32LE(sampleRate*2, o); o += 4; // byte rate
  buf.writeUInt16LE(2,            o); o += 2; // block align
  buf.writeUInt16LE(16,           o); o += 2; // bits/sample
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;

  // Skip ahead past silence region (already zero-filled).
  o += silenceSamples * 2;

  // Write sine wave samples.
  for (let i = 0; i < sineSamples; i++) {
    const sample = Math.sin(2 * Math.PI * frequencyHz * i / sampleRate);
    buf.writeInt16LE(Math.round(sample * 32767), o);
    o += 2;
  }

  return buf;
}

// ─── 1. sleepStats ──────────────────────────────────────────────────────────

describe('normalizeDurationToHours', () => {
  it('passes through values already in hours (≤24)', () => {
    assert.equal(normalizeDurationToHours(7.5), 7.5);
    assert.equal(normalizeDurationToHours(8),   8);
    assert.equal(normalizeDurationToHours('6.5'), 6.5);
  });

  it('converts minutes to hours (>24, ≤1000)', () => {
    assert.ok(Math.abs((normalizeDurationToHours(480) ?? 0) - 8) < 0.001, '480 min = 8 h');
    assert.ok(Math.abs((normalizeDurationToHours(450) ?? 0) - 7.5) < 0.001, '450 min = 7.5 h');
  });

  it('converts seconds to hours (>1000)', () => {
    assert.ok(Math.abs((normalizeDurationToHours(28800) ?? 0) - 8) < 0.001, '28800 s = 8 h');
    assert.ok(Math.abs((normalizeDurationToHours(27000) ?? 0) - 7.5) < 0.001, '27000 s = 7.5 h');
  });

  it('returns null for non-positive or non-numeric values', () => {
    assert.equal(normalizeDurationToHours(0),     null);
    assert.equal(normalizeDurationToHours(-1),    null);
    assert.equal(normalizeDurationToHours('abc'), null);
    assert.equal(normalizeDurationToHours(''),    null);
  });
});

describe('sampleStdev', () => {
  it('returns 0 for fewer than 2 values', () => {
    assert.equal(sampleStdev([]),  0);
    assert.equal(sampleStdev([7]), 0);
  });

  it('computes known stdev correctly (n-1 denominator)', () => {
    // Dataset: [2, 4, 4, 4, 5, 5, 7, 9] — population stdev = 2, sample stdev ≈ 2.138
    const vals = [2, 4, 4, 4, 5, 5, 7, 9];
    const result = sampleStdev(vals);
    assert.ok(Math.abs(result - 2.138) < 0.001, `expected ~2.138, got ${result}`);
  });

  it('returns 0 for identical values', () => {
    assert.equal(sampleStdev([8, 8, 8, 8]), 0);
  });
});

describe('parseSleepRows', () => {
  it('identifies Apple Health column names case-insensitively', () => {
    const headers = ['startDate', 'Sleep Analysis [Asleep] (hr)'];
    const rows = [
      { startDate: '2024-01-01', 'Sleep Analysis [Asleep] (hr)': '7.5' },
      { startDate: '2024-01-02', 'Sleep Analysis [Asleep] (hr)': '6.0' },
      { startDate: '2024-01-03', 'Sleep Analysis [Asleep] (hr)': '8.0' },
    ];
    const result = parseSleepRows(rows, headers);
    assert.equal(result.nights.length, 3);
    assert.equal(result.nights[0].hours, 7.5);
  });

  it('identifies generic "date" + "value" columns', () => {
    const headers = ['date', 'value'];
    const rows = [
      { date: '2024-01-01', value: '7' },
      { date: '2024-01-02', value: '6' },
      { date: '2024-01-03', value: '8' },
    ];
    const result = parseSleepRows(rows, headers);
    assert.equal(result.nights.length, 3);
  });

  it('skips rows with missing or invalid duration', () => {
    const headers = ['date', 'value'];
    const rows = [
      { date: '2024-01-01', value: '7' },
      { date: '2024-01-02', value: '' },      // blank
      { date: '2024-01-03', value: '-1' },    // negative
      { date: '2024-01-04', value: '6.5' },
    ];
    const result = parseSleepRows(rows, headers);
    assert.equal(result.nights.length, 2);
  });

  it('throws a descriptive string if date column is missing', () => {
    assert.throws(
      () => parseSleepRows([{ value: '7' }], ['value']),
      (err: unknown) => typeof err === 'string' && err.includes('date'),
    );
  });

  it('throws a descriptive string if duration column is missing', () => {
    assert.throws(
      () => parseSleepRows([{ date: '2024-01-01' }], ['date']),
      (err: unknown) => typeof err === 'string' && err.includes('duration'),
    );
  });
});

describe('computeSleepStats', () => {
  it('computes correct avg and stdev for known values', () => {
    const nights = [
      { date: '1', hours: 7 },
      { date: '2', hours: 8 },
      { date: '3', hours: 6 },
    ];
    const stats = computeSleepStats(nights);
    assert.ok(Math.abs(stats.avg_sleep_hours - 7) < 0.001);
    assert.equal(stats.nights_analyzed, 3);
    assert.ok(stats.sleep_variability_hours > 0);
  });
});

// ─── 2. signalAdjustments ───────────────────────────────────────────────────

describe('computeNewCognitiveLoad', () => {
  it('declining trend increases cognitive_load by 10', () => {
    assert.equal(computeNewCognitiveLoad(50, 'declining', 4, false), 60);
  });

  it('improving trend decreases cognitive_load by 5', () => {
    assert.equal(computeNewCognitiveLoad(50, 'improving', 4, false), 45);
  });

  it('stable trend leaves cognitive_load unchanged (no course/honors modifiers)', () => {
    assert.equal(computeNewCognitiveLoad(50, 'stable', 4, false), 50);
  });

  it('course_load ≥ 6 adds 5 (heavy schedule threshold)', () => {
    assert.equal(computeNewCognitiveLoad(50, 'stable', 6, false), 55);
    assert.equal(computeNewCognitiveLoad(50, 'stable', 5, false), 50); // 5 < threshold
  });

  it('AP/Honors + declining compounds (+5 extra)', () => {
    // declining (+10) + course_load 6 (+5) + ap_honors + declining (+5) = +20
    assert.equal(computeNewCognitiveLoad(50, 'declining', 6, true), 70);
  });

  it('clamps to 100 at upper boundary', () => {
    assert.equal(computeNewCognitiveLoad(95, 'declining', 6, true), 100);
  });

  it('clamps to 0 at lower boundary', () => {
    assert.equal(computeNewCognitiveLoad(3, 'improving', 4, false), 0);
  });
});

describe('computeNewRecoveryCapacity', () => {
  it('no penalty for 8h avg with ≤1h variability', () => {
    assert.equal(computeNewRecoveryCapacity(70, 8, 1), 70);
    assert.equal(computeNewRecoveryCapacity(70, 8, 0.5), 70);
  });

  it('1h sleep deficit (7h avg) costs 8 points', () => {
    assert.equal(computeNewRecoveryCapacity(70, 7, 0), 62);
  });

  it('1h excess variability (stdev=2h) costs 10 points', () => {
    assert.equal(computeNewRecoveryCapacity(70, 8, 2), 60);
  });

  it('combined penalties are additive', () => {
    // 1h deficit (8 pts) + 1h extra variability (10 pts) = -18
    assert.equal(computeNewRecoveryCapacity(70, 7, 2), 52);
  });

  it('clamps to 0 for severe deficit', () => {
    assert.equal(computeNewRecoveryCapacity(10, 4, 3), 0);
  });

  it('clamps to 100 when prior is already high and penalties are small', () => {
    assert.equal(computeNewRecoveryCapacity(100, 8, 0.5), 100);
  });
});

describe('computeNewEmotionalRegulation', () => {
  it('high pitch variance (expressive) → no reduction or small reduction', () => {
    // pitch_variance = 80 → flatness_score = 0 → delta = 0
    const result = computeNewEmotionalRegulation(70, 80);
    assert.equal(result, 70);
  });

  it('zero pitch variance (monotone) → maximum reduction of 15', () => {
    // flatness_score = 1 → delta = -15
    const result = computeNewEmotionalRegulation(70, 0);
    assert.equal(result, 55);
  });

  it('partial flatness → proportional reduction', () => {
    // pitch_variance = 40 → flatness_score = 0.5 → delta = -7.5 → result 62.5 → round 63
    const result = computeNewEmotionalRegulation(70, 40);
    assert.ok(result >= 62 && result <= 63, `expected ~63, got ${result}`);
  });

  it('clamps to 0 for flat affect on low baseline', () => {
    assert.equal(computeNewEmotionalRegulation(5, 0), 0);
  });

  it('clamps to 100 at upper boundary', () => {
    assert.equal(computeNewEmotionalRegulation(100, 80), 100);
  });
});

// ─── 3. audioFeatures ───────────────────────────────────────────────────────

describe('sampleVariance', () => {
  it('returns 0 for fewer than 2 values', () => {
    assert.equal(sampleVariance([]),   0);
    assert.equal(sampleVariance([5]),  0);
  });

  it('returns 0 for identical values', () => {
    assert.equal(sampleVariance([3, 3, 3]), 0);
  });

  it('computes sample variance correctly (n-1)', () => {
    // [2, 4] → mean=3, variance=(1+1)/1 = 2
    assert.equal(sampleVariance([2, 4]), 2);
  });
});

describe('computeFrameEnergies', () => {
  it('returns one energy value per frame', () => {
    const samples = new Float32Array(1000).fill(0.5);
    const energies = computeFrameEnergies(samples, 100);
    assert.equal(energies.length, 10);
  });

  it('computes correct energy for a known signal', () => {
    // constant signal of 0.5 → energy = 0.5² = 0.25
    const samples = new Float32Array(200).fill(0.5);
    const energies = computeFrameEnergies(samples, 100);
    assert.ok(Math.abs(energies[0] - 0.25) < 1e-6, `expected 0.25, got ${energies[0]}`);
  });

  it('returns zero energy for silent signal', () => {
    const samples = new Float32Array(200).fill(0);
    const energies = computeFrameEnergies(samples, 100);
    for (const e of energies) assert.equal(e, 0);
  });
});

describe('computeAdaptiveThreshold', () => {
  it('returns 0 for empty energies', () => {
    assert.equal(computeAdaptiveThreshold(new Float64Array(0)), 0);
  });

  it('is 1.5× the 10th-percentile energy', () => {
    // Array [0,1,2,3,4,5,6,7,8,9] — length 10.
    // p10 index = floor(10 × 0.1) = floor(1) = 1 → sorted[1] = 1
    // threshold = 1.5 × 1 = 1.5
    const energies = new Float64Array(Array.from({ length: 10 }, (_, i) => i));
    const threshold = computeAdaptiveThreshold(energies);
    assert.ok(Math.abs(threshold - 1.5) < 1e-9, `expected 1.5, got ${threshold}`);
  });

  it('produces a positive threshold when noise floor is non-zero', () => {
    const energies = new Float64Array([0.01, 0.01, 0.01, 0.5, 0.5, 0.5]);
    const threshold = computeAdaptiveThreshold(energies);
    assert.ok(threshold > 0);
  });
});

describe('classifyFrames', () => {
  it('classifies frames above threshold as voiced', () => {
    const energies = new Float64Array([0.1, 0.5, 0.01, 0.8]);
    const voiced = classifyFrames(energies, 0.05);
    assert.deepEqual(voiced, [true, true, false, true]);
  });
});

describe('countPauses', () => {
  it('returns 0 for all-voiced signal', () => {
    const voiced = [true, true, true, true, true];
    assert.equal(countPauses(voiced, 44100, 882), 0);
  });

  it('returns 0 if silent run is shorter than 300ms', () => {
    // At 44100 Hz, 882 samples/frame: need ≥ceil(0.3*44100/882)=15 silent frames.
    // Provide 14 silent frames — below the threshold.
    const voiced = [true, ...new Array(14).fill(false), true];
    assert.equal(countPauses(voiced, 44100, 882), 0);
  });

  it('counts a pause when silence run ≥ 15 frames at 44100/882', () => {
    const voiced = [true, ...new Array(15).fill(false), true];
    assert.equal(countPauses(voiced, 44100, 882), 1);
  });

  it('counts multiple distinct pauses', () => {
    const voiced = [
      true, ...new Array(15).fill(false), true,
      ...new Array(15).fill(false), true,
    ];
    assert.equal(countPauses(voiced, 44100, 882), 2);
  });
});

// ─── 4. Sleep CSV fixture ────────────────────────────────────────────────────

describe('Sleep CSV fixture (src/fixtures/sample_sleep.csv)', () => {
  it('parses 10 valid nights from the Apple Health-style fixture', () => {
    const Papa = require('papaparse') as typeof import('papaparse');
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'sample_sleep.csv');
    const csvText = fs.readFileSync(fixturePath, 'utf-8');

    const result = Papa.parse<Record<string, string>>(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    const headers = result.meta.fields ?? [];
    const { nights } = parseSleepRows(result.data, headers);
    assert.equal(nights.length, 10, 'fixture should yield 10 valid nights');

    const stats = computeSleepStats(nights);
    assert.ok(stats.avg_sleep_hours > 5 && stats.avg_sleep_hours < 10, 'avg should be in plausible range');
    assert.ok(stats.sleep_variability_hours >= 0, 'stdev must be non-negative');
    assert.equal(stats.nights_analyzed, 10);
  });
});

// ─── 5. Voice WAV pipeline ───────────────────────────────────────────────────

describe('Voice WAV pipeline (synthetic sine wave)', () => {
  it('extracts plausible acoustic features from a 6-second sine tone', () => {
    const wavBuffer = generateSineWav(220, 6, 44100);

    // Decode
    const decoded = wav.decode(wavBuffer);
    const samples    = decoded.channelData[0];
    const sampleRate = decoded.sampleRate;

    assert.equal(sampleRate, 44100);
    const durationSeconds = samples.length / sampleRate;
    assert.ok(durationSeconds >= 5, `duration ${durationSeconds}s should be ≥ 5`);

    // Frame energy
    const frameSize = Math.round(sampleRate * 0.02); // 20ms = 882 samples
    const energies  = computeFrameEnergies(samples, frameSize);
    assert.ok(energies.length > 0, 'should have frames');

    const maxEnergy = Math.max(...Array.from(energies));
    assert.ok(maxEnergy > 1e-8, 'sine wave should not be silent');

    // Voiced classification
    const threshold = computeAdaptiveThreshold(energies);
    const voiced    = classifyFrames(energies, threshold);
    const voicedCount = voiced.filter(Boolean).length;
    assert.ok(voicedCount > 0, 'sine wave should have voiced frames');

    const speaking_ratio = voicedCount / voiced.length;
    assert.ok(speaking_ratio > 0 && speaking_ratio <= 1, 'speaking_ratio should be in (0,1]');

    // Pitch detection
    const detectPitch = pitchfinder.YIN({ sampleRate, threshold: 0.1 });
    const pitchValues: number[] = [];

    for (let i = 0; i < voiced.length; i++) {
      if (!voiced[i]) continue;
      const frame = samples.slice(i * frameSize, (i + 1) * frameSize);
      const pitch = detectPitch(frame);
      if (pitch !== null && pitch >= 100 && pitch <= 500) {
        pitchValues.push(pitch);
      }
    }

    assert.ok(pitchValues.length > 0, 'YIN should detect pitch for a 220 Hz sine wave');

    // The sine wave is a pure tone, so pitch values should cluster near 220 Hz.
    const meanPitch = pitchValues.reduce((a, b) => a + b, 0) / pitchValues.length;
    assert.ok(
      Math.abs(meanPitch - 220) < 30,
      `mean detected pitch ${meanPitch.toFixed(1)} Hz should be near 220 Hz`,
    );

    // Features must be finite numbers, not NaN or Infinity.
    const pitch_variance_hz = sampleVariance(pitchValues);
    const energy_variance   = sampleVariance(Array.from(energies).filter((_, i) => voiced[i]));

    assert.ok(isFinite(pitch_variance_hz), 'pitch_variance_hz must be finite');
    assert.ok(isFinite(energy_variance),   'energy_variance must be finite');

    // Monotone sine → flat affect → low pitch variance → flatness_score near 1
    const new_er = computeNewEmotionalRegulation(70, pitch_variance_hz);
    assert.ok(new_er >= 0 && new_er <= 100, 'emotional_regulation result must be clamped');
  });
});
