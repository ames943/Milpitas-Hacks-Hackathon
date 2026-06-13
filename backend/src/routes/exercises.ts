import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/exercises/recommended/:userId
router.get('/recommended/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;

  res.json({
    success: true,
    data: {
      user_id: userId,
      recommended: [],
    },
  });
});

// POST /api/exercises/:id/complete
router.post('/:id/complete', (req: Request, res: Response) => {
  const { id } = req.params;

  res.json({
    success: true,
    message: 'Exercise completion recorded',
    data: {
      exercise_id: id,
      completion_id: 'placeholder-id',
    },
  });
});

export default router;
