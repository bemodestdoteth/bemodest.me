"use strict";
/**
 * Custom error classes following RULES O-8007, A-4007
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalServerError = exports.NotFoundError = exports.UnauthorizedError = exports.ValidationError = exports.AppError = void 0;
exports.formatErrorResponse = formatErrorResponse;
class AppError extends Error {
    code;
    statusCode;
    timestamp;
    requestId;
    constructor(message, code, statusCode, requestId) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.statusCode = statusCode;
        this.timestamp = new Date().toISOString();
        this.requestId = requestId;
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
        return {
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            timestamp: this.timestamp,
            requestId: this.requestId,
        };
    }
}
exports.AppError = AppError;
class ValidationError extends AppError {
    constructor(message, requestId) {
        super(message, 'VALIDATION_ERROR', 400, requestId);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', requestId) {
        super(message, 'UNAUTHORIZED', 401, requestId);
        this.name = 'UnauthorizedError';
    }
}
exports.UnauthorizedError = UnauthorizedError;
class NotFoundError extends AppError {
    constructor(message = 'Resource not found', requestId) {
        super(message, 'NOT_FOUND', 404, requestId);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class InternalServerError extends AppError {
    constructor(message = 'Internal server error', requestId) {
        super(message, 'INTERNAL_ERROR', 500, requestId);
        this.name = 'InternalServerError';
    }
}
exports.InternalServerError = InternalServerError;
/**
 * Formats error for API response following RULES A-4006
 * @param {Error} error - Error object
 * @returns {object} Formatted error response
 * @example
 * try {
 *   // ... operation
 * } catch (err) {
 *   return res.status(500).json(formatErrorResponse(err));
 * }
 */
function formatErrorResponse(error) {
    if (error instanceof AppError) {
        return {
            success: false,
            error: {
                code: error.code,
                message: error.message,
            },
        };
    }
    return {
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: error.message || 'An unexpected error occurred',
        },
    };
}
