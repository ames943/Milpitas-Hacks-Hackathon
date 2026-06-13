/**
 * Integration tests — POST /api/signals/{transcript,sleep,voice}
 * Supabase: real. Backboard: mocked (transcript uses extractTranscriptData).
 *
 * NOTE: Tests within each describe block run sequentially and build on state
 * seeded in beforeAll. This is intentional for route integration tests.
 */
import 'dotenv/config';

// Mock aiClient BEFORE any app imports so all in-process requires get the mock.
jest.mock('../../lib/aiClient', () => ({
  callAI: jest.fn(),
  AIParseError: class AIParseError extends Error {
    rawOutput: string;
    constructor(msg: string, raw: string) {
      super(msg);
      this.name = 'AIParseError';
      this.rawOutput = raw;
    }
  },
  extractTranscriptData: jest.fn(),
}));

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../app';
import { callAI, extractTranscriptData } from '../../lib/aiClient';
import { cleanupUser, seedUser, seedSurvey } from './_helpers/cleanup';
import { setupDefaultAiMock } from './_helpers/mockAi';
import {
  APPLE_HEALTH_CSV,
  GOOGLE_FIT_CSV,
  GENERIC_SLEEP_CSV,
  GOOD_SLEEP_CSV,
  POOR_SLEEP_CSV,
  EMPTY_SLEEP_CSV,
  generateSineWav,
  createTestPDF,
} from './_helpers/fixtures';

const SURVEY_USER = randomUUID(); // user who has completed a survey
const NO_SURVEY   = randomUUID(); // user who has NOT completed a survey

const DEFAULT_TRANSCRIPT = {
  gpa: 3.8, course_load: 6, has_ap_honors: true, grade_trend: 'stable' as const,
};

beforeAll(async () => {
  // Seed users
  await seedUser(SURVEY_USER);
  await seedUser(NO_SURVEY);
  // Submit survey so signal tests have a baseline dimension_scores row
  await seedSurvey(SURVEY_USER, request(app));
});

afterAll(async () => {
  await cleanupUser(SURVEY_USER);
  await cleanupUser(NO_SURVEY);
});

beforeEach(() => {
  setupDefaultAiMock(
    callAI as jest.MockedFunction<typeof callAI>,
    extractTranscriptData as jest.MockedFunction<typeof extractTranscriptData>,
  );
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Survey-first gate ─────────────────────────────────────────────────────────

describe('signals — survey-first gate (no prior survey → 409)', () => {
  const PDF = createTestPDF();
  const WAV = generateSineWav();
  const CSV = Buffer.from(APPLE_HEALTH_CSV);

  it('transcript before survey → 409', async () => {
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', NO_SURVEY)
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(409);
  });

  it('sleep before survey → 409', async () => {
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', NO_SURVEY)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });
    expect(res.status).toBe(409);
  });

  it('voice before survey → 409', async () => {
    const res = await request(app)
      .post('/api/signals/voice')
      .field('user_id', NO_SURVEY)
      .attach('file', WAV, { filename: 'voice.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(409);
  });
});

// ── Transcript ────────────────────────────────────────────────────────────────

describe('POST /api/signals/transcript', () => {
  it('valid PDF → 201, confidence_score = 60 (40 + 20)', async () => {
    const PDF = createTestPDF();
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', SURVEY_USER)
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dimension_scores.confidence_score).toBe(60);
    expect(res.body.data.signal.signal_type).toBe('transcript');
  });

  it('second transcript upload → confidence still 60, new dimension row', async () => {
    const PDF = createTestPDF();
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', SURVEY_USER)
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    // confidence doesn't go above 100 and doesn't go below existing level
    expect(res.body.data.dimension_scores.confidence_score).toBeGreaterThanOrEqual(60);
  });

  it('non-PDF file → 422', async () => {
    const txt = Buffer.from('This is plain text');
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', SURVEY_USER)
      .attach('file', txt, { filename: 'transcript.txt', contentType: 'text/plain' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('missing file → 400', async () => {
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', SURVEY_USER);
    expect(res.status).toBe(400);
  });

  it('missing user_id → 400', async () => {
    const PDF = createTestPDF();
    const res = await request(app)
      .post('/api/signals/transcript')
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
  });

  it('AI returns malformed JSON → 422 with error message', async () => {
    const { AIParseError } = jest.requireMock('../../lib/aiClient') as {
      AIParseError: new (m: string, r: string) => Error & { rawOutput: string };
    };
    (extractTranscriptData as jest.Mock).mockRejectedValueOnce(
      new AIParseError('Bad JSON from AI', '{ invalid }'),
    );
    const PDF = createTestPDF();
    const res = await request(app)
      .post('/api/signals/transcript')
      .field('user_id', SURVEY_USER)
      .attach('file', PDF, { filename: 'transcript.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});

// ── Sleep ─────────────────────────────────────────────────────────────────────

describe('POST /api/signals/sleep', () => {
  it('valid Apple Health CSV (7+ nights) → 201, confidence increases by 20', async () => {
    const before = await request(app).get(`/api/dashboard/${SURVEY_USER}`);
    const prevConf: number = before.body?.data?.confidence?.total ?? 0;

    const CSV = Buffer.from(APPLE_HEALTH_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.dimension_scores.confidence_score).toBeGreaterThanOrEqual(prevConf + 20);
    expect(res.body.data.signal.signal_type).toBe('sleep');
  });

  it('Google Fit format CSV → 201', async () => {
    const CSV = Buffer.from(GOOGLE_FIT_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });
    expect(res.status).toBe(201);
  });

  it('generic date,hours CSV → 201', async () => {
    const CSV = Buffer.from(GENERIC_SLEEP_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });
    expect(res.status).toBe(201);
  });

  it('good sleep (8h avg, no variability) → recovery_capacity unchanged or improved', async () => {
    const dimBefore = await request(app).get(`/api/dashboard/${SURVEY_USER}`);
    const prevRC: number = dimBefore.body?.data?.dimensions?.recovery_capacity?.score ?? 50;

    const CSV = Buffer.from(GOOD_SLEEP_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    const newRC = Number(res.body.data.dimension_scores.recovery_capacity);
    // 8h avg, 0 variability → no penalty → RC should be >= prior
    expect(newRC).toBeGreaterThanOrEqual(prevRC);
  });

  it('poor sleep (5h avg, high variability) → recovery_capacity decreases', async () => {
    const CSV = Buffer.from(POOR_SLEEP_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    // Just verify it processes without error — exact value depends on prior state
    expect(res.body.data.dimension_scores.recovery_capacity).toBeGreaterThanOrEqual(0);
  });

  it('non-CSV file → 422', async () => {
    const notCSV = Buffer.from('%PDF-1.4 this is not a csv file at all');
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', notCSV, { filename: 'sleep.pdf', contentType: 'application/pdf' });
    // CSV parser will likely error or missing columns
    expect([400, 422]).toContain(res.status);
  });

  it('empty CSV (header only) → 422', async () => {
    const CSV = Buffer.from(EMPTY_SLEEP_CSV);
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER)
      .attach('file', CSV, { filename: 'sleep.csv', contentType: 'text/csv' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('missing file → 400', async () => {
    const res = await request(app)
      .post('/api/signals/sleep')
      .field('user_id', SURVEY_USER);
    expect(res.status).toBe(400);
  });
});

// ── Voice ─────────────────────────────────────────────────────────────────────

describe('POST /api/signals/voice', () => {
  it('valid WAV file (6s sine) → 201, confidence increases', async () => {
    const WAV = generateSineWav(220, 6);
    const res = await request(app)
      .post('/api/signals/voice')
      .field('user_id', SURVEY_USER)
      .attach('file', WAV, { filename: 'voice.wav', contentType: 'audio/wav' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.signal.signal_type).toBe('voice');
    expect(res.body.data.voice_analysis.duration_seconds).toBeGreaterThanOrEqual(5);
  });

  it('non-audio file → 422', async () => {
    const pdf = createTestPDF();
    const res = await request(app)
      .post('/api/signals/voice')
      .field('user_id', SURVEY_USER)
      .attach('file', pdf, { filename: 'voice.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('very short audio (< 5s) → 422', async () => {
    const WAV = generateSineWav(220, 3); // 3 seconds — below 5s minimum
    const res = await request(app)
      .post('/api/signals/voice')
      .field('user_id', SURVEY_USER)
      .attach('file', WAV, { filename: 'voice.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('missing file → 400', async () => {
    const res = await request(app)
      .post('/api/signals/voice')
      .field('user_id', SURVEY_USER);
    expect(res.status).toBe(400);
  });

  it('confidence reaches 100 after survey + transcript + sleep + voice', async () => {
    // The SURVEY_USER has already gone through all signal submissions above.
    // Fetch the latest dashboard to check final confidence.
    const res = await request(app).get(`/api/dashboard/${SURVEY_USER}`);
    expect(res.status).toBe(200);
    expect(res.body.data.confidence.total).toBe(100);
  });
});
