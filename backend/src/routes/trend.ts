import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase';
import { calculateTrend } from '../lib/trendCalculation';
import type { DimensionScoresRow } from '../lib/dimensionUpdate';

const router = Router();

// GET /api/trend/:userId
router.get('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  const { userId } = req.params;

  try {
    const { data, error } = await supabase
      .from('dimension_scores')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const snapshots = (data ?? []) as DimensionScoresRow[];

    if (snapshots.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No dimension scores found for this user.',
      });
    }

    if (snapshots.length === 1) {
      return res.status(200).json({
        success: true,
        data: {
          has_trend:      false,
          snapshot_count: 1,
          snapshots,
          trend:          null,
          latest:         snapshots[0],
        },
      });
    }

    const latest   = snapshots[snapshots.length - 1];
    const previous = snapshots[snapshots.length - 2];
    const trend    = calculateTrend(previous, latest);

    return res.status(200).json({
      success: true,
      data: {
        has_trend:      true,
        snapshot_count: snapshots.length,
        snapshots,
        trend,
        latest,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
