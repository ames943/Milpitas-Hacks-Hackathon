import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { count, error } = await supabase
      .from('exercise_library')
      .select('*', { count: 'exact', head: true });

    if (error) throw Object.assign(new Error(error.message), { statusCode: 503 });

    res.json({
      success: true,
      supabase: 'connected',
      exercise_count: count,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
