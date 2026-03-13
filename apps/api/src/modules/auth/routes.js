import { Router } from 'express';
import * as authController from './controller.js';

const router = Router();

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/api/session', authController.checkSession);
router.get('/api/extension/token', authController.getExtensionToken);

export default router;
