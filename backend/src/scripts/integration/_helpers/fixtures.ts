/**
 * Binary fixture generators for integration tests.
 * All fixtures are generated in-memory — no files committed to the repo.
 */

// ── CSV fixtures ───────────────────────────────────────────────────────────────

/** Apple Health export format — 10 nights, ~7h avg */
export const APPLE_HEALTH_CSV = `startDate,Sleep Analysis [Asleep] (hr)
2024-01-01,7.5
2024-01-02,6.0
2024-01-03,8.0
2024-01-04,5.5
2024-01-05,7.2
2024-01-06,6.8
2024-01-07,8.5
2024-01-08,6.0
2024-01-09,7.0
2024-01-10,5.0
`;

/** Google Fit-style format with different column names */
export const GOOGLE_FIT_CSV = `Date,Duration (ms)
2024-01-01,27000000
2024-01-02,21600000
2024-01-03,28800000
2024-01-04,19800000
2024-01-05,25920000
2024-01-06,24480000
2024-01-07,30600000
2024-01-08,21600000
2024-01-09,25200000
2024-01-10,18000000
`;

/** Generic date + hours format */
export const GENERIC_SLEEP_CSV = `date,hours
2024-01-01,7.5
2024-01-02,6.0
2024-01-03,8.0
2024-01-04,5.5
2024-01-05,7.2
2024-01-06,6.8
2024-01-07,8.5
2024-01-08,6.0
2024-01-09,7.0
2024-01-10,5.0
`;

/** CSV that leads to good sleep (8h avg, low variability) */
export const GOOD_SLEEP_CSV = `startDate,Sleep Analysis [Asleep] (hr)
2024-01-01,8.0
2024-01-02,8.0
2024-01-03,8.0
2024-01-04,8.0
2024-01-05,8.0
2024-01-06,8.0
2024-01-07,8.0
`;

/** CSV that leads to poor sleep (5h avg, high variability) */
export const POOR_SLEEP_CSV = `startDate,Sleep Analysis [Asleep] (hr)
2024-01-01,3.0
2024-01-02,7.5
2024-01-03,4.0
2024-01-04,8.0
2024-01-05,3.5
2024-01-06,7.0
2024-01-07,4.5
`;

/** CSV with header only — no data rows */
export const EMPTY_SLEEP_CSV = `startDate,Sleep Analysis [Asleep] (hr)
`;

// ── WAV fixture ────────────────────────────────────────────────────────────────

/**
 * Generates a synthetic 16-bit mono WAV buffer.
 * Replicates the pattern from src/lib/signals.test.ts.
 * 1 second of silence followed by (durationSeconds-1) seconds of sine tone.
 * The silence ensures the adaptive threshold has a real noise floor.
 */
export function generateSineWav(
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

  const buf = Buffer.alloc(44 + dataSize, 0); // 44-byte RIFF header + data

  // RIFF chunk
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 4);
  buf.write('WAVE', 8, 'ascii');

  // fmt sub-chunk
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);       // chunk size
  buf.writeUInt16LE(1, 20);        // PCM
  buf.writeUInt16LE(1, 22);        // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);        // block align
  buf.writeUInt16LE(16, 34);       // bits per sample

  // data sub-chunk
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  // Samples — silence first, then sine
  for (let i = 0; i < sineSamples; i++) {
    const t     = i / sampleRate;
    const value = Math.round(32767 * Math.sin(2 * Math.PI * frequencyHz * t));
    const clamp = Math.max(-32768, Math.min(32767, value));
    buf.writeInt16LE(clamp, 44 + (silenceSamples + i) * 2);
  }

  return buf;
}

// ── PDF fixture ────────────────────────────────────────────────────────────────

/**
 * Creates a minimal valid PDF with extractable text (>50 chars).
 * Uses standard Type1 Helvetica font — pdf-parse can extract ASCII text
 * from standard Type1 fonts without a ToUnicode CMap.
 */
export function createTestPDF(): Buffer {
  const TEXT =
    'Academic Transcript: GPA 3.8, AP Biology, 6 courses, grade trend stable, honor roll student';

  const stream    = `BT /F1 12 Tf 72 720 Td (${TEXT}) Tj ET`;
  const streamLen = Buffer.byteLength(stream, 'binary');

  const header = '%PDF-1.4\n';
  const obj1   = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2   = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3   = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const obj4   = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`;
  const obj5   = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  // Compute byte offsets for the xref table.
  const hLen    = Buffer.byteLength(header, 'binary');
  const o1Len   = Buffer.byteLength(obj1,   'binary');
  const o2Len   = Buffer.byteLength(obj2,   'binary');
  const o3Len   = Buffer.byteLength(obj3,   'binary');
  const o4Len   = Buffer.byteLength(obj4,   'binary');
  const o5Len   = Buffer.byteLength(obj5,   'binary');

  const obj1Off = hLen;
  const obj2Off = obj1Off + o1Len;
  const obj3Off = obj2Off + o2Len;
  const obj4Off = obj3Off + o3Len;
  const obj5Off = obj4Off + o4Len;
  const xrefOff = obj5Off + o5Len;

  const pad10 = (n: number) => n.toString().padStart(10, '0');
  const entry  = (n: number) => `${pad10(n)} 00000 n\r\n`;

  const xref =
    'xref\n' +
    '0 6\n' +
    `0000000000 65535 f\r\n` +
    entry(obj1Off) +
    entry(obj2Off) +
    entry(obj3Off) +
    entry(obj4Off) +
    entry(obj5Off) +
    'trailer\n' +
    '<< /Size 6 /Root 1 0 R >>\n' +
    `startxref\n${xrefOff}\n%%EOF\n`;

  const full = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref;
  return Buffer.from(full, 'binary');
}
