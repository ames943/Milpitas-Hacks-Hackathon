/**
 * Re-export shim — all implementation moved to aiClient.ts.
 * Kept for backward compat with signals.ts and test scripts.
 */
export {
  callAI,
  AIParseError,
  AIParseError as BackboardError,
  AIParseError as ClaudeParseError,
  extractTranscriptData,
} from './aiClient';
export type { TranscriptData } from './aiClient';
