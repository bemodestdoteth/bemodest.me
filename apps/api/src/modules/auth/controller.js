import { logger } from '@bemodest/utils';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const { COOKIE_NAME, COOKIE_SAME_SITE, COOKIE_MAX_AGE_MS, SIDECAR_URL } = config;
import * as authService from './service.js';

export const login = async (req, res) => {
    try {
        let username, password;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
            [username, password] = credentials.split(':');
        } else if (req.body.username && req.body.password) {
            username = req.body.username;
            password = req.body.password;
        } else {
            return res.status(401).json({ success: false, message: 'Missing credentials' });
        }

        const isValid = await authService.verifyAdmin(username, password);
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const webToken = authService.generateWebToken(username);
        const decoded = authService.decodeToken(webToken);
        const expiresAtMs = decoded.exp * 1000;

        res.cookie(COOKIE_NAME, webToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: COOKIE_SAME_SITE,
            maxAge: COOKIE_MAX_AGE_MS
        });

        return res.status(200).json({ success: true, data: { token: webToken, expiresAt: expiresAtMs } });
    } catch (err) {
        logger.error(`Login error: ${err.message}`);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const logout = (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.status(200).json({ success: true, message: 'Logged out successfully' });
};

export const checkSession = (req, res) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(200).json({ authenticated: false });

    try {
        const decoded = authService.verifyToken(token);
        const expiresAtMs = decoded.exp * 1000;
        const remainingMs = Math.max(expiresAtMs - Date.now(), 0);
        const FIVE_MINUTES_MS = 300000;

        return res.status(200).json({
            authenticated: true,
            userId: decoded.userId,
            expiresAt: expiresAtMs,
            remainingMs: remainingMs,
            isExpiringSoon: remainingMs > 0 && remainingMs < FIVE_MINUTES_MS
        });
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(200).json({ authenticated: false, reason: 'expired' });
        }
        return res.status(200).json({ authenticated: false });
    }
};

export const getExtensionToken = (req, res) => {
    const webToken = req.cookies[COOKIE_NAME];
    if (!webToken) return res.status(401).json({ success: false, message: 'Not authenticated' });

    try {
        const decoded = authService.verifyToken(webToken);
        const extensionToken = authService.generateExtensionToken(decoded.userId);

        return res.status(200).json({
            success: true,
            data: { token: extensionToken, sidecarUrl: SIDECAR_URL }
        });
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
};
