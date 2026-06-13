import rateLimit, { MemoryStore, ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

function tooManyHandler(req: Request, res: Response): void {
  const retryAfter = res.getHeader('Retry-After');
  res.status(429).json({
    error: 'Too many requests',
    retry_after_seconds:
      typeof retryAfter === 'string' ? parseInt(retryAfter, 10) : 3600,
  });
}

// ── User create: 10 per IP per hour ──────────────────────────────────────────
// Store exported so integration tests can reset it between runs.
export const userCreateStore = new MemoryStore();
export const userCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  store: userCreateStore,
  keyGenerator: (req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});

// ── Survey: 5 per user_id per hour ───────────────────────────────────────────
// express.json() runs before routes, so req.body.user_id is available here.
export const surveyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) =>
    (req.body?.user_id as string | undefined) ?? ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});

// ── Signal uploads: 10 per IP per route per hour ─────────────────────────────
// user_id is in multipart body (parsed by multer inside the handler), so we
// key by IP + path to get per-type limiting without accessing the body early.
export const signalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${ipKeyGenerator(req)}:${req.path}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});

// ── Dashboard: 30 per user per hour ──────────────────────────────────────────
export const dashboardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) =>
    (req.params.userId as string | undefined) ?? ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});

// ── Recommended exercises: 20 per user per hour ───────────────────────────────
export const recommendedLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) =>
    (req.params.userId as string | undefined) ?? ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});

// ── Voice prompt: 100 per IP per hour (static endpoint) ──────────────────────
export const voicePromptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 100,
  keyGenerator: (req) => ipKeyGenerator(req),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooManyHandler,
});
