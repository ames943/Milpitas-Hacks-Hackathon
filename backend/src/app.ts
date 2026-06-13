import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health';
import surveyRouter from './routes/survey';
import signalsRouter from './routes/signals';
import dashboardRouter from './routes/dashboard';
import exercisesRouter from './routes/exercises';
import trendRouter from './routes/trend';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/survey', surveyRouter);
app.use('/api/signals', signalsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/exercises', exercisesRouter);
app.use('/api/trend', trendRouter);

app.use(errorHandler);

export default app;
