export * from './generated.js';
import { z } from 'zod';

/**
 * Label Zod schema for runtime validation
 * @description Validates label data from API and extension
 * @example
 * const result = LabelSchema.parse({ addr: '0x123', label: 'MyWallet', chain: 'ETH', tracking: true, comment: 'Test' });
 */
export const LabelSchema = z.object({
  addr: z.string().min(1),
  label: z.string().min(1).max(100),
  chain: z.string().min(1),
  code: z.string().optional(),
  entity: z.string().optional(),
  entityImage: z.string().url().optional(),
  tracking: z.boolean().default(false),
  comment: z.string().max(500).optional(),
});

export type Label = z.infer<typeof LabelSchema>;

/**
 * Auth Session schema for JWT validation
 */
export const AuthSessionSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['web', 'extension']).optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

/**
 * API Response schema following RULES A-4006
 */
export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .optional(),
    meta: z
      .object({
        executionTimeMs: z.number().optional(),
        itemsProcessed: z.number().optional(),
      })
      .optional(),
  });

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    executionTimeMs?: number;
    itemsProcessed?: number;
  };
};

/**
 * Login request schema
 */
export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Entity schema
 */
export const EntitySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  tracking: z.boolean().default(false),
  image: z.string().url().optional(),
  comment: z.string().max(500).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

/**
 * Error object following RULES O-8007
 */
export const ErrorObjectSchema = z.object({
  message: z.string(),
  code: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
  requestId: z.string().optional(),
});

export type ErrorObject = z.infer<typeof ErrorObjectSchema>;
