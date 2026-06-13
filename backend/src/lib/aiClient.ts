/**
 * Generic Backboard.io AI client.
 * All AI/LLM calls in Mosaic route through this module.
 * Set BACKBOARD_API_KEY in .env — Backboard uses its own managed keys,
 * no separate Anthropic/OpenAI credentials required.
 *
 * API: POST https://app.backboard.io/api/threads/messages
 */

const BACKBOARD_URL   = 'https://app.backboard.io/api/threads/messages';
const MODEL_PROVIDER  = 'anthropic';
const MODEL_NAME      = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT = 8_000; // ms

export class AIParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'AIParseError';
  }
}

function getApiKey(): string {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) throw new Error('BACKBOARD_API_KEY environment variable is not set');
  return key;
}

/** Strips ```json / ``` markdown fences that the model may emit despite json_output: true. */
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// ── Overloads ─────────────────────────────────────────────────────────────────
// jsonOutput: true  → returns parsed unknown (caller must narrow the type)
// jsonOutput: false / omitted → returns raw string

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  opts: { jsonOutput: true; timeoutMs?: number },
): Promise<unknown>;
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  opts?: { jsonOutput?: false; timeoutMs?: number },
): Promise<string>;
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  opts?: { jsonOutput?: boolean; timeoutMs?: number },
): Promise<unknown> {
  const apiKey = getApiKey();
  const { jsonOutput = false, timeoutMs = DEFAULT_TIMEOUT } = opts ?? {};

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(BACKBOARD_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:       userPrompt,
        system_prompt: systemPrompt,
        llm_provider:  MODEL_PROVIDER,
        model_name:    MODEL_NAME,
        json_output:   jsonOutput,
        memory:        'off',
        stream:        false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tid);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(no body)');
    throw new AIParseError(`Backboard API error ${response.status}: ${body}`, body);
  }

  const result = await response.json() as { content: unknown };

  if (!jsonOutput) {
    return typeof result.content === 'string' ? result.content.trim() : JSON.stringify(result.content);
  }

  // JSON path — strip markdown fences, then parse
  const rawContent =
    typeof result.content === 'string' ? result.content.trim() : JSON.stringify(result.content);
  const stripped = stripFences(rawContent);

  try {
    return JSON.parse(stripped);
  } catch {
    throw new AIParseError('Response was not valid JSON after fence stripping', rawContent);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transcript extraction (Part 3) — kept here so all AI calls live in one file
// ─────────────────────────────────────────────────────────────────────────────

const GRADE_SCALE_TABLE = `
A  = 4.0 | A- = 3.7
B+ = 3.3 | B  = 3.0 | B- = 2.7
C+ = 2.3 | C  = 2.0 | C- = 1.7
D+ = 1.3 | D  = 1.0 | D- = 0.7
F  = 0.0
`.trim();

const TRANSCRIPT_SYSTEM_PROMPT = `You are an academic transcript analysis system.
Read the provided transcript text and return STRICT JSON only.
No preamble, no markdown fences, no explanation — only the raw JSON object.

Required shape:
{ "gpa": number, "course_load": number, "has_ap_honors": boolean, "grade_trend": "improving" | "declining" | "stable" }

Rules:
- gpa: Use the stated GPA if explicitly present. Otherwise compute from grades using:
${GRADE_SCALE_TABLE}
  Weighted average if credit hours listed, simple mean otherwise. Round to 2 decimal places.
- course_load: Count distinct courses in the most recent term.
- has_ap_honors: true if any course title contains "AP", "Advanced Placement", "Honors", or "IB".
- grade_trend: "improving" = GPA rose > 0.1 vs prior term; "declining" = fell > 0.1; "stable" = otherwise.

Return ONLY the JSON object. Nothing before or after it.`;

export interface TranscriptData {
  gpa: number;
  course_load: number;
  has_ap_honors: boolean;
  grade_trend: 'improving' | 'declining' | 'stable';
}

export async function extractTranscriptData(transcriptText: string): Promise<TranscriptData> {
  const result = await callAI(TRANSCRIPT_SYSTEM_PROMPT, transcriptText, { jsonOutput: true }) as Record<string, unknown>;

  if (
    typeof result.gpa !== 'number' ||
    typeof result.course_load !== 'number' ||
    typeof result.has_ap_honors !== 'boolean' ||
    !['improving', 'declining', 'stable'].includes(result.grade_trend as string)
  ) {
    throw new AIParseError(
      'Transcript response did not match expected schema (gpa, course_load, has_ap_honors, grade_trend)',
      JSON.stringify(result),
    );
  }

  return {
    gpa:          result.gpa as number,
    course_load:  result.course_load as number,
    has_ap_honors: result.has_ap_honors as boolean,
    grade_trend:  result.grade_trend as TranscriptData['grade_trend'],
  };
}
