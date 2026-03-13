/**
 * Custom error classes following RULES O-8007, A-4007
 */
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly timestamp: string;
    readonly requestId?: string;
    constructor(message: string, code: string, statusCode: number, requestId?: string);
    toJSON(): {
        message: string;
        code: string;
        statusCode: number;
        timestamp: string;
        requestId: string | undefined;
    };
}
export declare class ValidationError extends AppError {
    constructor(message: string, requestId?: string);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string, requestId?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string, requestId?: string);
}
export declare class NotFoundError extends AppError {
    constructor(message?: string, requestId?: string);
}
export declare class InternalServerError extends AppError {
    constructor(message?: string, requestId?: string);
}
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
export declare function formatErrorResponse(error: Error | AppError): {
    success: boolean;
    error: {
        code: string;
        message: string;
    };
};
