import { z } from 'zod';

/**
 * Zod validation schemas for Socket.IO events and API payloads (RULES S-3007, T-11001)
 * @module schemas
 * @description Co-located validation schemas per RULES M-12002
 * @see {@link https://dev.to/codanyks/secure-by-design-nodejs-api-security-patterns-for-2025|Secure-by-design patterns}
 */

// ==========================================
// Socket.IO Event Payload Schemas
// ==========================================

/**
 * Schema for chainGet event payload
 * @type {z.ZodObject}
 */
export const ChainGetSchema = z.object({
    params: z.object({}).optional().default({})
});

/**
 * Schema for entityGet event payload
 * @type {z.ZodObject}
 */
export const EntityGetSchema = z.object({
    params: z.object({}).optional().default({})
});

/**
 * Schema for entityInsert event payload
 * @type {z.ZodObject}
 */
export const EntityInsertSchema = z.object({
    body: z.record(
        z.string().min(1, 'Entity name required'),
        z.object({
            image: z.string().optional().default(''),
            imageFilename: z.string().optional(),
            comment: z.string().optional().default(''),
            tracking: z.boolean().optional().default(false)
        })
    )
});

/**
 * Schema for entityDelete event payload
 * @type {z.ZodObject}
 */
export const EntityDeleteSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Entity name required for deletion')
    })
});

/**
 * Schema for entityUpdate event payload
 * @type {z.ZodObject}
 */
export const EntityUpdateSchema = z.object({
    body: z.object({
        originalName: z.string().min(1, 'Original entity name required'),
        name: z.string().min(1, 'Entity name required'),
        image: z.string().optional().default(''),
        imageFilename: z.string().optional(),
        comment: z.string().optional().default(''),
        tracking: z.boolean().optional().default(false)
    })
});

/**
 * Schema for labelGet event payload
 * @type {z.ZodObject}
 */
export const LabelGetSchema = z.object({
    params: z.object({}).optional().default({})
});

/**
 * Schema for labelInsert event payload
 * @type {z.ZodObject}
 */
export const LabelInsertSchema = z.object({
    body: z.object({
        addr: z.string().min(1, 'Address required'),
        chain: z.string().min(1, 'Chain required'),
        entity: z.string().optional().default(''),
        comment: z.string().optional().default(''),
        label: z.string().optional().default(''),
        tracking: z.boolean().optional().default(false)
    })
});

/**
 * Schema for labelDelete event payload
 * @type {z.ZodObject}
 */
export const LabelDeleteSchema = z.object({
    body: z.object({
        addr: z.string().min(1, 'Address required for deletion')
    })
});

/**
 * Schema for labelInsertBulk event payload
 * @type {z.ZodObject}
 */
export const LabelInsertBulkSchema = z.object({
    body: z.array(
        z.object({
            addr: z.string().min(1, 'Address required'),
            chain: z.string().min(1, 'Chain required'),
            entity: z.string().optional().default(''),
            comment: z.string().optional().default(''),
            label: z.string().min(1, 'Label must not be empty'),
            tracking: z.boolean().optional().default(false)
        })
    ).min(1, 'At least one label required for bulk insert')
});

/**
 * Schema for labelDeleteBulk (REST API) payload
 * @type {z.ZodObject}
 */
export const LabelDeleteBulkSchema = z.object({
    address: z.union([
        z.string().min(1, 'Address required'),
        z.array(z.string().min(1, 'Address required')).min(1, 'At least one address required')
    ]),
    key: z.string().optional()
});

/**
 * Schema for chainInsert event payload
 * @type {z.ZodObject}
 */
export const ChainInsertSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Name is required'),
        blockExplorerPrefix: z.string().min(1, 'Block Explorer Prefix is required'),
        blockExplorerPostfix: z.string().optional().default(''),
        bgColor: z.string().min(1, 'Background Color is required'),
        fontColor: z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: z.array(z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: z.boolean().optional().default(false),
        annotation: z.object({}).optional().default({})
    })
});

/**
 * Schema for chainUpdate event payload
 * @type {z.ZodObject}
 */
export const ChainUpdateSchema = z.object({
    body: z.object({
        _id: z.union([z.string(), z.number()]).refine(val => val !== undefined && val !== "undefined", {
            message: 'Valid ID is required for update'
        }),
        name: z.string().min(1, 'Name is required'),
        code: z.string().regex(/^[A-Z]+$/, 'Code must be all caps').optional().or(z.literal('')),
        blockExplorerPrefix: z.string().min(1, 'Block Explorer Prefix is required'),
        blockExplorerPostfix: z.string().optional().default(''),
        bgColor: z.string().min(1, 'Background Color is required'),
        fontColor: z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: z.array(z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: z.boolean().optional().default(false),
        annotation: z.object({}).optional().default({})
    })
});

/**
 * Schema for chainDelete event payload
 * @type {z.ZodObject}
 */
export const ChainDeleteSchema = z.object({
    body: z.object({
        name: z.string().min(1, 'Chain name required for deletion')
    })
});

// ==========================================
// API Response Schemas (RULES A-4006)
// ==========================================

/**
 * Standard success response schema
 * @type {z.ZodObject}
 */
export const SuccessResponseSchema = z.object({
    success: z.literal(true),
    data: z.any(),
    timestamp: z.number().optional()
});

/**
 * Standard error response schema
 * @type {z.ZodObject}
 */
export const ErrorResponseSchema = z.object({
    success: z.literal(false),
    error: z.object({
        code: z.string(),
        message: z.string()
    })
});
