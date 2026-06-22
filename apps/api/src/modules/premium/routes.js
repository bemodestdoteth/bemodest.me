import express from 'express';
import { logger } from '@bemodest/utils';

import { getPremiumCandles } from './service.js';

const router = express.Router();

router.post('/candles', async (req, res) => {
  try {
    const data = await getPremiumCandles(req.body);
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('[Premium] Failed to build premium candles', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
