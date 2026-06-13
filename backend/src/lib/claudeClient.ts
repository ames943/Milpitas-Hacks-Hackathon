/**
 * Backboard.io API client for LLM inference.
 * Uses Backboard's managed API keys — no separate Anthropic/OpenAI credentials needed.
 * Set BACKBOARD_API_KEY in .env.
 *
 * API ref: https://backboard-docs.docsalot.dev
 * Endpoint: POST https://app.backboard.io/api/threads/messages
 */

const BACKBOARD_URL = 'https://app.backboard.io/api/threads/messages';
const MODEL_PROVIDER = 'anthropic';
const MODEL_NAME     = 'claude-sonnet-4-6';

// Standard 4.0 GPA scale for grade-point conversion when no GPA is explicitly stated.
// Matches the College Board / NACAC conversion table.
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
- gpa: Use the stated GPA if explicitly present. Otherwise compute it from listed course grades using this scale:
${GRADE_SCALE_TABLE}
  If credit hours are listed, compute a weighted average; otherwise use a simple mean.
  Round to 2 decimal places.
- course_load: Count distinct courses listed for the most recent term.
- has_ap_honors: true if any course title contains "AP", "Advanced Placement", "Honors", or "IB".
- grade_trend: Compare the most recent term to prior term(s).
  "improving" = GPA or grade average rose by more than 0.1.
  "declining" = GPA or grade average fell by more than 0.1.
  "stable"    = change ≤ 0.1, or only one term is available.

Return ONLY the JSON object. Nothing before or after it.`;

export interface TranscriptData {
  gpa: number;
  course_load: number;
  has_ap_honors: boolean;
  grade_trend: 'improving' | 'declining' | 'stable';
}

export class BackboardError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message);
    this.name = 'BackboardError';
  }
}

/** @deprecated Use BackboardError */
export { BackboardError as ClaudeParseError };

function getApiKey(): string {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) throw new Error('BACKBOARD_API_KEY environment variable is not set');
  return key;
}

export async function extractTranscriptData(transcriptText: string): Promise<TranscriptData> {
  const apiKey = getApiKey();

  const response = await fetch(BACKBOARD_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: transcriptText,
      system_prompt: TRANSCRIPT_SYSTEM_PROMPT,
      llm_provider: MODEL_PROVIDER,
      model_name: MODEL_NAME,
      json_output: true,   // enforce JSON output
      memory: 'off',       // don't persist transcript content across requests
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '(no body)');
    throw new BackboardError(
      `Backboard API error ${response.status}: ${errorBody}`,
      errorBody,
    );
  }

  const result = await response.json() as { content: unknown };

  // content may be a pre-parsed object (json_output=true) or a JSON string,
  // possibly wrapped in markdown fences (```json ... ```) — strip them if present.
  const rawContent =
    typeof result.content === 'string'
      ? result.content.trim()
      : JSON.stringify(result.content);
  const raw = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackboardError('Backboard response content was not valid JSON', rawContent);
  }

  const p = parsed as Record<string, unknown>;
  if (
    typeof p.gpa !== 'number' ||
    typeof p.course_load !== 'number' ||
    typeof p.has_ap_honors !== 'boolean' ||
    !['improving', 'declining', 'stable'].includes(p.grade_trend as string)
  ) {
    throw new BackboardError(
      'Response did not match expected schema (gpa, course_load, has_ap_honors, grade_trend)',
      raw,
    );
  }

  return {
    gpa: p.gpa as number,
    course_load: p.course_load as number,
    has_ap_honors: p.has_ap_honors as boolean,
    grade_trend: p.grade_trend as 'improving' | 'declining' | 'stable',
  };
}
