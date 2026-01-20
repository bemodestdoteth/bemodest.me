import { z } from 'zod';
/**
 * Label Zod schema for runtime validation
 * @description Validates label data from API and extension
 * @example
 * const result = LabelSchema.parse({ addr: '0x123', label: 'MyWallet', chain: 'ETH', tracking: true, comment: 'Test' });
 */
export declare const LabelSchema: z.ZodObject<{
    addr: z.ZodString;
    label: z.ZodString;
    chain: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    entity: z.ZodOptional<z.ZodString>;
    entityImage: z.ZodOptional<z.ZodString>;
    tracking: z.ZodDefault<z.ZodBoolean>;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    addr: string;
    label: string;
    chain: string;
    tracking: boolean;
    code?: string | undefined;
    entity?: string | undefined;
    entityImage?: string | undefined;
    comment?: string | undefined;
}, {
    addr: string;
    label: string;
    chain: string;
    code?: string | undefined;
    entity?: string | undefined;
    entityImage?: string | undefined;
    tracking?: boolean | undefined;
    comment?: string | undefined;
}>;
export type Label = z.infer<typeof LabelSchema>;
/**
 * Auth Session schema for JWT validation
 */
export declare const AuthSessionSchema: z.ZodObject<{
    userId: z.ZodString;
    type: z.ZodOptional<z.ZodEnum<["web", "extension"]>>;
    iat: z.ZodOptional<z.ZodNumber>;
    exp: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    type?: "web" | "extension" | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}, {
    userId: string;
    type?: "web" | "extension" | undefined;
    iat?: number | undefined;
    exp?: number | undefined;
}>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
/**
 * API Response schema following RULES A-4006
 */
export declare const ApiResponseSchema: <T extends z.ZodType>(dataSchema: T) => z.ZodObject<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, z.objectUtil.addQuestionMarks<z.baseObjectOutputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}>, any> extends infer T_1 ? { [k in keyof T_1]: T_1[k]; } : never, z.baseObjectInputType<{
    success: z.ZodBoolean;
    data: z.ZodOptional<T>;
    error: z.ZodOptional<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>>;
    meta: z.ZodOptional<z.ZodObject<{
        executionTimeMs: z.ZodOptional<z.ZodNumber>;
        itemsProcessed: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }, {
        executionTimeMs?: number | undefined;
        itemsProcessed?: number | undefined;
    }>>;
}> extends infer T_2 ? { [k_1 in keyof T_2]: T_2[k_1]; } : never>;
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
export declare const LoginRequestSchema: z.ZodObject<{
    username: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    username: string;
    password: string;
}, {
    username: string;
    password: string;
}>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
/**
 * Entity schema
 */
export declare const EntitySchema: z.ZodObject<{
    name: z.ZodString;
    code: z.ZodString;
    tracking: z.ZodDefault<z.ZodBoolean>;
    image: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    tracking: boolean;
    name: string;
    comment?: string | undefined;
    image?: string | undefined;
}, {
    code: string;
    name: string;
    tracking?: boolean | undefined;
    comment?: string | undefined;
    image?: string | undefined;
}>;
export type Entity = z.infer<typeof EntitySchema>;
/**
 * Error object following RULES O-8007
 */
export declare const ErrorObjectSchema: z.ZodObject<{
    message: z.ZodString;
    code: z.ZodString;
    statusCode: z.ZodNumber;
    timestamp: z.ZodString;
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    requestId?: string | undefined;
}, {
    code: string;
    message: string;
    statusCode: number;
    timestamp: string;
    requestId?: string | undefined;
}>;
export type ErrorObject = z.infer<typeof ErrorObjectSchema>;
