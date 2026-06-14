/** UUID pattern — accepts any RFC 4122 UUID format (v1–v5) to support demo student IDs. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUUID(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/** Strips HTML tags from a string. Used to sanitize the `name` field. */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

export const VALID_EXERCISE_CATEGORIES = new Set([
  'Cognitive',
  'Structural',
  'Physical',
  'Social',
]);

/** Max allowed size for completion_data JSON payloads. */
export const MAX_COMPLETION_DATA_BYTES = 10 * 1024; // 10 KB
