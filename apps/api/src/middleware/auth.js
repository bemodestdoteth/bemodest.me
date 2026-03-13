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
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(formatErrorResponse(new UnauthorizedError('No token provided')));
  }

  const token = authHeader.substring(7);

  try {
    const config = validateApiConfig();
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
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const config = validateApiConfig();
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const validated = AuthSessionSchema.parse(decoded);

    socket.user = validated;
    next();
  } catch (error) {
    next(new Error('Invalid token'));
  }
}
