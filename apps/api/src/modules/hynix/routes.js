import express from 'express';
import { logger } from '@bemodest/utils';

import { getHynixSnapshot } from './service.js';

const router = express.Router();

router.get('/snapshot', async (req, res) => {
  try {
    const data = await getHynixSnapshot();
    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('[Hynix] Failed to build snapshot', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
