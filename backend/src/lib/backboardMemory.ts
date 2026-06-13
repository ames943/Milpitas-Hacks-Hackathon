/**
 * Backboard memory API helpers.
 * All writes are fire-and-forget (never throw).
 * Reads await the result but fall back to "" on failure.
 */

import { supabase } from './supabase';
import type { DimensionScoresRow } from './dimensionUpdate';
import { dimensionColor } from './dashboardHelpers';

const BACKBOARD_BASE = 'https://app.backboard.io/api';

function apiKey(): string | null {
  return process.env.BACKBOARD_API_KEY ?? null;
}

function authHeaders(): Record<string, string> {
  const key = apiKey();
  if (!key) return {};
  return { 'X-API-Key': key, 'Content-Type': 'application/json' };
}

/** Returns the stored Backboard assistant_id for this user, or null if none. */
export async function getAssistantId(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('backboard_assistant_id')
      .eq('id', userId)
      .single();
    if (error || !data) return null;
    return (data as { backboard_assistant_id: string | null }).backboard_assistant_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Creates a Backboard assistant for the user and persists the ID.
 * Returns the assistant_id, or null on any failure (fire-and-forget safe).
 */
export async function createAssistant(userId: string): Promise<string | null> {
  const key = apiKey();
  if (!key) {
    console.warn('[backboardMemory] BACKBOARD_API_KEY not set — assistant creation skipped');
    return null;
  }
  try {
    const res = await fetch(`${BACKBOARD_BASE}/assistants`, {
      method: 'POST',
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `mosaic-user-${userId}` }),
    });
    if (!res.ok) {
      console.warn(
        `[backboardMemory] createAssistant HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      );
      return null;
    }
    const body = (await res.json()) as { assistant_id: string };
    const assistantId = body.assistant_id;
    // Persist — non-fatal if this fails
    await supabase
      .from('users')
      .update({ backboard_assistant_id: assistantId })
      .eq('id', userId);
    return assistantId;
  } catch (err) {
    console.warn('[backboardMemory] createAssistant failed (non-fatal):', err);
    return null;
  }
}

/**
 * Searches Backboard memories and returns a formatted context string.
 * Returns "" on failure or empty results — callers must handle this gracefully.
 */
export async function searchMemories(
  assistantId: string,
  query: string,
  limit = 5,
): Promise<string> {
  const key = apiKey();
  if (!key) return '';
  try {
    const res = await fetch(
      `${BACKBOARD_BASE}/assistants/${assistantId}/memories/search`,
      {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit }),
      },
    );
    if (!res.ok) {
      console.warn(`[backboardMemory] searchMemories HTTP ${res.status}`);
      return '';
    }
    const body = (await res.json()) as {
      memories: Array<{ content: string; score: number }>;
    };
    const memories = body.memories ?? [];
    if (memories.length === 0) return '';
    return `Prior snapshots for this student:\n${memories.map((m) => m.content).join('\n')}`;
  } catch (err) {
    console.warn('[backboardMemory] searchMemories failed (non-fatal):', err);
    return '';
  }
}

/** Adds a memory to the Backboard assistant. Fire-and-forget, never throws. */
export async function addMemory(
  assistantId: string,
  content: string,
  metadata: object,
): Promise<void> {
  const key = apiKey();
  if (!key) return;
  try {
    const res = await fetch(
      `${BACKBOARD_BASE}/assistants/${assistantId}/memories`,
      {
        method: 'POST',
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, metadata }),
      },
    );
    if (!res.ok) {
      console.warn(
        `[backboardMemory] addMemory HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      );
    }
  } catch (err) {
    console.warn('[backboardMemory] addMemory failed (non-fatal):', err);
  }
}

/** Formats a dimension_scores row into the standard Backboard memory string. */
export function formatSnapshotMemory(
  scores: DimensionScoresRow,
  signalsPresent: string[],
): string {
  const cl   = Math.round(Number(scores.cognitive_load));
  const er   = Math.round(Number(scores.emotional_regulation));
  const rc   = Math.round(Number(scores.recovery_capacity));
  const conf = Math.round(Number(scores.confidence_score));

  return (
    `Mosaic snapshot [${scores.created_at}]: ` +
    `Cognitive Load=${cl}/100 (higher=worse), ` +
    `Emotional Regulation=${er}/100 (higher=better), ` +
    `Recovery Capacity=${rc}/100 (higher=better). ` +
    `Confidence=${conf}%. ` +
    `Signals present: ${signalsPresent.length > 0 ? signalsPresent.join(', ') : 'survey only'}. ` +
    `Interpretation: CL=${dimensionColor(cl, true)}, ER=${dimensionColor(er, false)}, RC=${dimensionColor(rc, false)}.`
  );
}

// Suppress unused import warning for authHeaders (used by TypeScript but not yet wired to calls)
void authHeaders;
