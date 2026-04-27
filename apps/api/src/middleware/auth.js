import jwt from 'jsonwebtoken';
import { validateApiConfig } from '@bemodest/config';
import { AuthSessionSchema } from '@bemodest/types';

import { UnauthorizedError, formatErrorResponse } from '@bemodest/utils';

/**
 * Express middleware for JWT authentication following RULES S-3007, A-4007
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next function
 * @example
 * app.get('/api/protected', authMiddleware, (req, res) => {
 *   console.log(req.user); // { userId: 'admin', type: 'web' }
 * });
 */
export function authMiddleware(req, res, next) {
  const config = validateApiConfig();
  const authHeader = req.headers.authorization;
  let token;

  if (authHeader && authHeader.startsWith('Bearer ') && authHeader !== 'Bearer null') {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies[config.COOKIE_NAME]) {
    // CSRF Defense-in-depth when relying on cookies
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      const allowedOrigin = config.CORS_ORIGIN;
      const allowedExtension = `chrome-extension://${config.CHROME_EXTENSION_ID}`;

      let isTrusted = false;
      if (origin && (origin === allowedOrigin || origin === allowedExtension)) isTrusted = true;
      if (referer && (referer.startsWith(allowedOrigin) || referer.startsWith(allowedExtension))) isTrusted = true;

      if (!isTrusted) {
        return res.status(403).json(formatErrorResponse(new UnauthorizedError('CSRF protection: untrusted origin')));
      }
    }

    token = req.cookies[config.COOKIE_NAME];
  }

  if (!token) {
    return res.status(401).json(formatErrorResponse(new UnauthorizedError('No token provided')));
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const validated = AuthSessionSchema.parse(decoded);

    req.user = validated;
    next();
  } catch (error) {
    return res.status(401).json(formatErrorResponse(new UnauthorizedError('Invalid token')));
  }
}

/**
 * Socket.IO middleware for JWT authentication
 * @param {import('socket.io').Socket} socket - Socket.IO socket
 * @param {Function} next - Socket.IO next function
 * @example
 * io.use(socketAuthMiddleware);
 */
export function socketAuthMiddleware(socket, next) {
  const config = validateApiConfig();
  let token = socket.handshake.auth?.token;

  if (!token || token === 'null') {
    const cookieHeader = socket.handshake.headers?.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(new RegExp('(^| )' + config.COOKIE_NAME + '=([^;]+)'));
      if (match) token = match[2];
    }
  }

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const validated = AuthSessionSchema.parse(decoded);

    socket.user = validated;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
}
