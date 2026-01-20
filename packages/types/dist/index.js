"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorObjectSchema = exports.EntitySchema = exports.LoginRequestSchema = exports.ApiResponseSchema = exports.AuthSessionSchema = exports.LabelSchema = void 0;
const zod_1 = require("zod");
/**
 * Label Zod schema for runtime validation
 * @description Validates label data from API and extension
 * @example
 * const result = LabelSchema.parse({ addr: '0x123', label: 'MyWallet', chain: 'ETH', tracking: true, comment: 'Test' });
 */
exports.LabelSchema = zod_1.z.object({
    addr: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1).max(100),
    chain: zod_1.z.string().min(1),
    code: zod_1.z.string().optional(),
    entity: zod_1.z.string().optional(),
    entityImage: zod_1.z.string().url().optional(),
    tracking: zod_1.z.boolean().default(false),
    comment: zod_1.z.string().max(500).optional(),
});
/**
 * Auth Session schema for JWT validation
 */
exports.AuthSessionSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1),
    type: zod_1.z.enum(['web', 'extension']).optional(),
    iat: zod_1.z.number().optional(),
    exp: zod_1.z.number().optional(),
});
/**
 * API Response schema following RULES A-4006
 */
const ApiResponseSchema = (dataSchema) => zod_1.z.object({
    success: zod_1.z.boolean(),
    data: dataSchema.optional(),
    error: zod_1.z
        .object({
        code: zod_1.z.string(),
        message: zod_1.z.string(),
    })
        .optional(),
    meta: zod_1.z
        .object({
        executionTimeMs: zod_1.z.number().optional(),
        itemsProcessed: zod_1.z.number().optional(),
    })
        .optional(),
});
exports.ApiResponseSchema = ApiResponseSchema;
/**
 * Login request schema
 */
exports.LoginRequestSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(50),
    password: zod_1.z.string().min(1),
});
/**
 * Entity schema
 */
exports.EntitySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    code: zod_1.z.string().min(1).max(20),
    tracking: zod_1.z.boolean().default(false),
    image: zod_1.z.string().url().optional(),
    comment: zod_1.z.string().max(500).optional(),
});
/**
 * Error object following RULES O-8007
 */
exports.ErrorObjectSchema = zod_1.z.object({
    message: zod_1.z.string(),
    code: zod_1.z.string(),
    statusCode: zod_1.z.number(),
    timestamp: zod_1.z.string(),
    requestId: zod_1.z.string().optional(),
});
