/**
 * Pure sleep CSV parsing and statistics computation.
 * Supports Apple Health and Google Fit export column name variants.
 */

export interface SleepNight {
  date: string;
  hours: number;
}

export interface SleepStats {
  avg_sleep_hours: number;
  /** Sample standard deviation (n-1 denominator) of nightly durations. */
  sleep_variability_hours: number;
  nights_analyzed: number;
}

// Checked in order, case-insensitive. First match wins.
const DATE_COLUMN_CANDIDATES = ['date', 'startdate', 'start date'];
const DURATION_COLUMN_CANDIDATES = [
  'sleep_duration_hours',
  'value',
  'duration',
  'sleep analysis [asleep] (hr)',
];

function findColumn(headers: string[], candidates: string[]): string | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lowerHeaders.indexOf(candidate.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return null;
}

/**
 * Normalizes a duration value to hours.
 *   > 1000 → assumed seconds (Apple Health raw export) → ÷ 3600
 *   > 24   → assumed minutes → ÷ 60
 *   ≤ 24   → assumed hours already
 * Returns null for non-positive or non-numeric values.
 */
export function normalizeDurationToHours(raw: string | number): number | null {
  const num = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (!isFinite(num) || num <= 0) return null;
  if (num > 1000) return num / 3600; // seconds → hours
  if (num > 24) return num / 60;    // minutes → hours
  return num;
}

/**
 * Sample standard deviation (n-1 denominator).
 * Returns 0 if fewer than 2 values.
 */
export function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export interface ParseSleepResult {
  nights: SleepNight[];
  dateColumn: string;
  durationColumn: string;
}

/**
 * Parses an array of PapaParse row objects into normalized SleepNight records.
 * Throws a descriptive string if required columns cannot be identified.
 */
export function parseSleepRows(
  rows: Record<string, string>[],
  headers: string[],
): ParseSleepResult {
  const dateCol = findColumn(headers, DATE_COLUMN_CANDIDATES);
  const durCol = findColumn(headers, DURATION_COLUMN_CANDIDATES);

  if (!dateCol) {
    throw `Could not identify date column. Expected one of: ${DATE_COLUMN_CANDIDATES.join(', ')}. Found columns: ${headers.join(', ')}`;
  }
  if (!durCol) {
    throw `Could not identify duration column. Expected one of: ${DURATION_COLUMN_CANDIDATES.join(', ')}. Found columns: ${headers.join(', ')}`;
  }

  const nights: SleepNight[] = [];
  for (const row of rows) {
    const rawDate = row[dateCol]?.trim();
    const rawDur = row[durCol]?.trim();
    if (!rawDate || !rawDur) continue;
    const hours = normalizeDurationToHours(rawDur);
    if (hours === null) continue;
    nights.push({ date: rawDate, hours });
  }

  return { nights, dateColumn: dateCol, durationColumn: durCol };
}

/** Computes aggregate statistics from a list of nightly sleep records. */
export function computeSleepStats(nights: SleepNight[]): SleepStats {
  const hours = nights.map((n) => n.hours);
  const avg = hours.reduce((a, b) => a + b, 0) / hours.length;
  return {
    avg_sleep_hours: avg,
    sleep_variability_hours: sampleStdev(hours),
    nights_analyzed: nights.length,
  };
}
