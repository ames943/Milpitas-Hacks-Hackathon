import { Router, Request, Response } from 'express';

const router = Router();

// GET /api/trend/:userId
router.get('/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;

  res.json({
    success: true,
    data: {
      user_id: userId,
      trend: [],
    },
  });
});

export default router;
