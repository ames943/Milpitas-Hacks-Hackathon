import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health';
import surveyRouter from './routes/survey';
import signalsRouter from './routes/signals';
import dashboardRouter from './routes/dashboard';
import exercisesRouter from './routes/exercises';
import trendRouter from './routes/trend';
import usersRouter from './routes/users';
import { errorHandler } from './middleware/errorHandler';
import {
  surveyLimiter,
  signalLimiter,
  dashboardLimiter,
  recommendedLimiter,
  voicePromptLimiter,
} from './middleware/rateLimiters';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/users', usersRouter);

// Rate limiters for survey, signals, dashboard, and exercises are gated behind
// ENABLE_RATE_LIMIT=true so unit tests (which send many requests) are not
// throttled. The userCreateLimiter lives in users.ts and is always active
// (integration test 46 exercises it directly and resets the store in beforeAll).
if (process.env.ENABLE_RATE_LIMIT === 'true') {
  app.use('/api/survey', surveyLimiter);
  app.use('/api/signals/transcript', signalLimiter);
  app.use('/api/signals/sleep', signalLimiter);
  app.use('/api/signals/voice', signalLimiter);
  app.use('/api/signals/voice/prompt', voicePromptLimiter);
  app.use('/api/dashboard', dashboardLimiter);
  app.use('/api/exercises/recommended', recommendedLimiter);
}

app.use('/api/survey', surveyRouter);
app.use('/api/signals', signalsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/exercises', exercisesRouter);
app.use('/api/trend', trendRouter);

app.use(errorHandler);

export default app;
