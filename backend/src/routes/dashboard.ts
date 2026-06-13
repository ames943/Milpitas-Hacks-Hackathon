import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/dashboard/:userId
router.get('/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;

  res.json({
    success: true,
    data: {
      user_id: userId,
      latest_dimension_scores: {
        cognitive_load: null,
        emotional_regulation: null,
        recovery_capacity: null,
        confidence_score: null,
        explanation_text: null,
      },
      recent_survey: null,
      recent_signals: [],
    },
  });
});

export default router;
