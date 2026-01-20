/**
 * Custom error classes following RULES O-8007, A-4007
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly timestamp: string;
  public readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    requestId?: string
  ) {
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

export class ValidationError extends AppError {
  constructor(message: string, requestId?: string) {
    super(message, 'VALIDATION_ERROR', 400, requestId);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', requestId?: string) {
    super(message, 'UNAUTHORIZED', 401, requestId);
    this.name = 'UnauthorizedError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', requestId?: string) {
    super(message, 'NOT_FOUND', 404, requestId);
    this.name = 'NotFoundError';
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', requestId?: string) {
    super(message, 'INTERNAL_ERROR', 500, requestId);
    this.name = 'InternalServerError';
  }
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
export function formatErrorResponse(error: Error | AppError) {
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
