import { z } from 'zod';

const CAIP2_RE = /^[-a-z0-9]{3,8}\/[-_.a-zA-Z0-9]{1,32}$/;
// Note: using '/' internally for Redis-safe encoding (eip155/1)
// The DB stores with ':' (eip155:1). Validate DB values with:
const CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;

export const Caip2Schema = z.string().regex(CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');
export const Caip2RedisSchema = z.string().regex(CAIP2_RE, 'Must be a valid CAIP-2 encoded for Redis (namespace/reference)');

export const AliasSchema = z.object({
    name: z.string().min(1, 'Alias name must not be empty'),
    chain: Caip2Schema,
});

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
        chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
        entity: z.string().optional().default(''),
        comment: z.string().optional().default(''),
        label: z.string().optional().default(''),
        tracking: z.boolean().optional().default(false),
        aliases: z.array(AliasSchema).optional().default([])
    })
});

/**
 * Schema for labelUpdate event payload
 * @type {z.ZodObject}
 */
export const LabelUpdateSchema = z.object({
    body: z.object({
        originalAddr: z.string().min(1, 'Original address required'),
        addr: z.string().min(1, 'Address required'),
        chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
        entity: z.string().optional().default(''),
        comment: z.string().optional().default(''),
        label: z.string().optional().default(''),
        tracking: z.boolean().optional().default(false),
        aliases: z.array(AliasSchema).optional().default([])
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
            chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
            entity: z.string().optional().default(''),
            comment: z.string().optional().default(''),
            label: z.string().min(1, 'Label must not be empty'),
            tracking: z.boolean().optional().default(false),
            aliases: z.array(AliasSchema).optional().default([])
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
        caip2: Caip2Schema,
        name: z.string().min(1, 'Name is required'),
        symbol: z.string().optional().or(z.literal('')),
        chainId: z.number().optional(),
        isTestnet: z.boolean().optional().default(false),
        gasPriceGwei: z.number().nullable().optional(),
        rpc: z.array(z.union([z.string().url(), z.literal('placeholder')])).optional(),
        wsRpc: z.array(z.union([z.string().url(), z.literal('placeholder')])).optional(),
        blockExplorerPrefix: z.string().min(1, 'Block Explorer Prefix is required'),
        bgColor: z.string().min(1, 'Background Color is required'),
        fontColor: z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: z.array(z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: z.boolean().optional().default(false),
        memoRequired: z.boolean().optional().default(false),
        memoRegexPatterns: z.array(z.string()).optional().default([]),
        block_time: z.number().int().optional().default(30),
        annotation: z.object({
            geckoterminal: z.string().optional(),
            code: z.string().min(1, 'Annotation code is required')
        }).passthrough(),
        status: z.enum(['active', 'deprecated']).optional().default('active'),
        supersededBy: Caip2Schema.optional()
    })
}).refine(data => {
    if (data.body.memoRequired && (!data.body.memoRegexPatterns || data.body.memoRegexPatterns.length === 0)) {
        return false;
    }
    return true;
}, {
    message: 'memoRegexPatterns is required when memoRequired is true',
    path: ['body', 'memoRegexPatterns']
}).refine(data => {
    if (data.body.status === 'deprecated' && !data.body.supersededBy) {
        return false;
    }
    return true;
}, {
    message: 'A supersededBy CAIP-2 ID is required when status is deprecated',
    path: ['body', 'supersededBy']
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
        caip2: Caip2Schema,
        name: z.string().min(1, 'Name is required'),
        code: z.string().regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric').optional().or(z.literal('')),
        symbol: z.string().optional().or(z.literal('')),
        chainId: z.number().optional(),
        isTestnet: z.boolean().optional().default(false),
        gasPriceGwei: z.number().nullable().optional(),
        rpc: z.array(z.union([z.string().url(), z.literal('placeholder')])).optional(),
        wsRpc: z.array(z.union([z.string().url(), z.literal('placeholder')])).optional(),
        blockExplorerPrefix: z.string().min(1, 'Block Explorer Prefix is required'),
        bgColor: z.string().min(1, 'Background Color is required'),
        fontColor: z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: z.array(z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: z.boolean().optional().default(false),
        memoRequired: z.boolean().optional().default(false),
        memoRegexPatterns: z.array(z.string()).optional().default([]),
        block_time: z.number().int().optional().default(30),
        annotation: z.object({
            geckoterminal: z.string().optional(),
            code: z.string().min(1, 'Annotation code is required')
        }).passthrough(),
        status: z.enum(['active', 'deprecated']).optional().default('active'),
        supersededBy: Caip2Schema.optional()
    })
}).refine(data => {
    if (data.body.memoRequired && (!data.body.memoRegexPatterns || data.body.memoRegexPatterns.length === 0)) {
        return false;
    }
    return true;
}, {
    message: 'memoRegexPatterns is required when memoRequired is true',
    path: ['body', 'memoRegexPatterns']
}).refine(data => {
    if (data.body.status === 'deprecated' && !data.body.supersededBy) {
        return false;
    }
    return true;
}, {
    message: 'A supersededBy CAIP-2 ID is required when status is deprecated',
    path: ['body', 'supersededBy']
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

// ==========================================
// D/W Status Schemas
// ==========================================

const DW_STATUS_VALUES = /** @type {['both','deposit_only','withdraw_only','suspended']} */ (
    ['both', 'deposit_only', 'withdraw_only', 'suspended']
);

/**
 * Schema for POST /api/dw-status body
 * @type {z.ZodObject}
 */
export const DwStatusBodySchema = z.object({
    exchange: z.string().min(1, 'exchange required'),
    network: z.string().min(1, 'network required').transform(val => val.replace('/', ':')),
    ticker: z.string().min(1, 'ticker required'),
    status: z.enum(DW_STATUS_VALUES, { message: 'Invalid status value' }),
});

/**
 * Schema for POST /api/deep-dive/start and /stop body
 * @type {z.ZodObject}
 */
export const DwDeepDiveTaskSchema = z.object({
    ticker: z.string().min(1, 'ticker required'),
    exchanges: z.array(z.string().min(1)).min(1, 'exchanges array required'),
});

// ==========================================
// Alert Rule Schemas  (PRICE_ALERT_PLAN.md Phase 1)
// ==========================================

const ALERT_CONDITIONS = /** @type {const} */ ([
    'spread_pct',
    'price_above',
    'price_below',
    'change_pct_5m',
    'volume_spike',
]);

/**
 * Schema for POST /api/alert-rules and PATCH /api/alert-rules/:id body.
 * Mirrors the MongoDB `alertRules` DSL document.
 * @type {z.ZodObject}
 */
// ==========================================
// Alert Rule Schemas (PRICE_ALERT_PLAN.md Phase 1)
// ==========================================

/**
 * @deprecated Use shared schemas from @bemodest/schema-definitions
 * Schema for POST /api/alert-rules and PATCH /api/alert-rules/:id body.
 * Mirrors the MongoDB `alertRules` DSL document.
 */
export const AlertRuleSchema = z.any(); // Placeholder to prevent breaking imports immediately


/**
 * Schema for PATCH /api/alert-rules/:id/reset-webhook — no body required.
 * @type {z.ZodObject}
 */
export const AlertRuleResetWebhookSchema = z.object({});

