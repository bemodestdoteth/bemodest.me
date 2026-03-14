import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

const SIGNATURE_MAX_AGE_MS = 30_000;

/**
 * Validates HMAC-SHA256 signature from Python snapper.
 * @param {string|undefined} signature - X-Signature header (hex)
 * @param {string|undefined} timestamp - X-Timestamp header (unix ms string)
 * @param {string} secret - Shared secret key
 * @returns {boolean}
 */
export const validateSignature = (signature: string | undefined, timestamp: string | undefined, secret: string | undefined): boolean => {
    if (!signature || !timestamp || !secret) return false;
    const ts = Number(timestamp);
    if (isNaN(ts) || Date.now() - ts > SIGNATURE_MAX_AGE_MS) return false;
    const expected = createHmac('sha256', secret).update(timestamp).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
        return false;
    }
};

/**
 * Creates a SHA-256 hash of a string.
 * @param {string} str - String to hash
 * @returns {string} Hex-encoded hash
 */
export const hashString = (str: string): string => {
    return createHash('sha256').update(str).digest('hex');
};
