"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionFormDraftSchema = exports.DraftChainFormSchema = exports.DraftEntityFormSchema = exports.DraftLabelFormSchema = exports.DwDeepDiveTaskSchema = exports.DwStatusBodySchema = exports.ChainDeleteSchema = exports.ChainUpdateSchema = exports.ChainInsertSchema = exports.AlertRuleSchema = exports.LabelDeleteBulkSchema = exports.LabelInsertBulkSchema = exports.LabelDeleteSchema = exports.LabelUpdateSchema = exports.LabelInsertSchema = exports.LabelGetSchema = exports.EntityUpdateSchema = exports.EntityDeleteSchema = exports.EntityInsertSchema = exports.EntityGetSchema = exports.ChainGetSchema = exports.ErrorObjectSchema = exports.ApiResponseSchema = exports.LoginRequestSchema = exports.AuthSessionSchema = exports.EntitySchema = exports.LabelSchema = exports.AliasSchema = exports.Caip2RedisSchema = exports.Caip2Schema = exports.ALERT_CONDITIONS = exports.DW_STATUS_VALUES = exports.CAIP2_DB_RE = exports.CAIP2_RE = void 0;
__exportStar(require("./schemas/index.js"), exports);
const zod_1 = require("zod");
// ==========================================
// Constants & Regex
// ==========================================
exports.CAIP2_RE = /^[-a-z0-9]{3,8}\/[-_.a-zA-Z0-9]{1,32}$/;
/**
 * Note: using '/' internally for Redis-safe encoding (eip155/1)
 * The DB stores with ':' (eip155:1). Validate DB values with:
 */
exports.CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;
exports.DW_STATUS_VALUES = ['both', 'deposit_only', 'withdraw_only', 'suspended'];
exports.ALERT_CONDITIONS = [
    'spread_pct',
    'price_above',
    'price_below',
    'change_pct_5m',
    'change_pct_24h',
    'volume_spike',
];
// ==========================================
// Base Domain Schemas
// ==========================================
exports.Caip2Schema = zod_1.z.string().regex(exports.CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');
exports.Caip2RedisSchema = zod_1.z.string().regex(exports.CAIP2_RE, 'Must be a valid CAIP-2 encoded for Redis (namespace/reference)');
exports.AliasSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'Alias name must not be empty'),
    chain: exports.Caip2Schema,
});
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
exports.EntitySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    code: zod_1.z.string().min(1).max(20),
    tracking: zod_1.z.boolean().default(false),
    image: zod_1.z.string().url().optional(),
    comment: zod_1.z.string().max(500).optional(),
});
// ==========================================
// Auth & Transport Schemas
// ==========================================
exports.AuthSessionSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1),
    type: zod_1.z.enum(['web', 'extension']).optional(),
    iat: zod_1.z.number().optional(),
    exp: zod_1.z.number().optional(),
});
exports.LoginRequestSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(50),
    password: zod_1.z.string().min(1),
});
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
exports.ErrorObjectSchema = zod_1.z.object({
    message: zod_1.z.string(),
    code: zod_1.z.string(),
    statusCode: zod_1.z.number(),
    timestamp: zod_1.z.string(),
    requestId: zod_1.z.string().optional(),
});
// ==========================================
// Socket.IO Payload Schemas
// ==========================================
exports.ChainGetSchema = zod_1.z.object({
    params: zod_1.z.object({}).optional().default({}),
});
exports.EntityGetSchema = zod_1.z.object({
    params: zod_1.z.object({}).optional().default({}),
});
exports.EntityInsertSchema = zod_1.z.object({
    body: zod_1.z.record(zod_1.z.string().min(1, 'Entity name required'), zod_1.z.object({
        image: zod_1.z.string().optional().default(''),
        imageFilename: zod_1.z.string().optional(),
        comment: zod_1.z.string().optional().default(''),
        tracking: zod_1.z.boolean().optional().default(false),
    })),
});
exports.EntityDeleteSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Entity name required for deletion'),
    }),
});
exports.EntityUpdateSchema = zod_1.z.object({
    body: zod_1.z.object({
        originalName: zod_1.z.string().min(1, 'Original entity name required'),
        name: zod_1.z.string().min(1, 'Entity name required'),
        image: zod_1.z.string().optional().default(''),
        imageFilename: zod_1.z.string().optional(),
        comment: zod_1.z.string().optional().default(''),
        tracking: zod_1.z.boolean().optional().default(false),
    }),
});
exports.LabelGetSchema = zod_1.z.object({
    params: zod_1.z.object({}).optional().default({}),
});
exports.LabelInsertSchema = zod_1.z.object({
    body: zod_1.z.object({
        addr: zod_1.z.string().min(1, 'Address required'),
        chains: zod_1.z.array(exports.Caip2Schema).min(1, 'At least one chain required'),
        entity: zod_1.z.string().optional().default(''),
        comment: zod_1.z.string().optional().default(''),
        label: zod_1.z.string().optional().default(''),
        tracking: zod_1.z.boolean().optional().default(false),
        aliases: zod_1.z.array(exports.AliasSchema).optional().default([]),
    }),
});
exports.LabelUpdateSchema = zod_1.z.object({
    body: zod_1.z.object({
        originalAddr: zod_1.z.string().min(1, 'Original address required'),
        addr: zod_1.z.string().min(1, 'Address required'),
        chains: zod_1.z.array(exports.Caip2Schema).min(1, 'At least one chain required'),
        entity: zod_1.z.string().optional().default(''),
        comment: zod_1.z.string().optional().default(''),
        label: zod_1.z.string().optional().default(''),
        tracking: zod_1.z.boolean().optional().default(false),
        aliases: zod_1.z.array(exports.AliasSchema).optional().default([]),
    }),
});
exports.LabelDeleteSchema = zod_1.z.object({
    body: zod_1.z.object({
        addr: zod_1.z.string().min(1, 'Address required for deletion'),
    }),
});
exports.LabelInsertBulkSchema = zod_1.z.object({
    body: zod_1.z.array(zod_1.z.object({
        addr: zod_1.z.string().min(1, 'Address required'),
        chains: zod_1.z.array(exports.Caip2Schema).min(1, 'At least one chain required'),
        entity: zod_1.z.string().optional().default(''),
        comment: zod_1.z.string().optional().default(''),
        label: zod_1.z.string().min(1, 'Label must not be empty'),
        tracking: zod_1.z.boolean().optional().default(false),
        aliases: zod_1.z.array(exports.AliasSchema).optional().default([]),
    })).min(1, 'At least one label required for bulk insert'),
});
exports.LabelDeleteBulkSchema = zod_1.z.object({
    address: zod_1.z.union([
        zod_1.z.string().min(1, 'Address required'),
        zod_1.z.array(zod_1.z.string().min(1, 'Address required')).min(1, 'At least one address required')
    ]),
    key: zod_1.z.string().optional()
});
exports.AlertRuleSchema = zod_1.z.any(); // Placeholder as per deprecated original, pending full JSON schema integration
exports.ChainInsertSchema = zod_1.z.object({
    body: zod_1.z.object({
        caip2: exports.Caip2Schema,
        chain: zod_1.z.string().min(1, 'Chain identifier is required'),
        name: zod_1.z.string().min(1, 'Name is required'),
        symbol: zod_1.z.string().optional().or(zod_1.z.literal('')),
        chainId: zod_1.z.number().optional(),
        isTestnet: zod_1.z.boolean().optional().default(false),
        gasPriceGwei: zod_1.z.number().nullable().optional(),
        rpc: zod_1.z.array(zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal('placeholder')])).optional(),
        wsRpc: zod_1.z.array(zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal('placeholder')])).optional(),
        blockExplorerPrefix: zod_1.z.string().min(1, 'Block Explorer Prefix is required'),
        bgColor: zod_1.z.string().min(1, 'Background Color is required'),
        fontColor: zod_1.z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: zod_1.z.array(zod_1.z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: zod_1.z.boolean().optional().default(false),
        memoRequired: zod_1.z.boolean().optional().default(false),
        memoRegexPatterns: zod_1.z.array(zod_1.z.string()).optional().default([]),
        block_time: zod_1.z.number().int().optional().default(30),
        code: zod_1.z.string().regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric').min(1, 'Code is required'),
        annotation: zod_1.z.object({
            geckoterminal: zod_1.z.string().optional(),
        }).passthrough().optional(),
        status: zod_1.z.enum(['active', 'deprecated']).optional().default('active'),
        supersededBy: exports.Caip2Schema.optional(),
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
exports.ChainUpdateSchema = zod_1.z.object({
    body: zod_1.z.object({
        _id: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).refine(val => val !== undefined && val !== "undefined", {
            message: 'Valid ID is required for update',
        }),
        caip2: exports.Caip2Schema,
        chain: zod_1.z.string().min(1, 'Chain identifier is required'),
        name: zod_1.z.string().min(1, 'Name is required'),
        code: zod_1.z.string().regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric').optional().or(zod_1.z.literal('')),
        symbol: zod_1.z.string().optional().or(zod_1.z.literal('')),
        chainId: zod_1.z.number().optional(),
        isTestnet: zod_1.z.boolean().optional().default(false),
        gasPriceGwei: zod_1.z.number().nullable().optional(),
        rpc: zod_1.z.array(zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal('placeholder')])).optional(),
        wsRpc: zod_1.z.array(zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal('placeholder')])).optional(),
        blockExplorerPrefix: zod_1.z.string().min(1, 'Block Explorer Prefix is required'),
        bgColor: zod_1.z.string().min(1, 'Background Color is required'),
        fontColor: zod_1.z.enum(['#EFEFEF', '#303030']),
        addrRegexPatterns: zod_1.z.array(zod_1.z.string()).min(1, 'At least one address regex pattern is required'),
        addrCaseSensitive: zod_1.z.boolean().optional().default(false),
        memoRequired: zod_1.z.boolean().optional().default(false),
        memoRegexPatterns: zod_1.z.array(zod_1.z.string()).optional().default([]),
        block_time: zod_1.z.number().int().optional().default(30),
        annotation: zod_1.z.object({
            geckoterminal: zod_1.z.string().optional(),
        }).passthrough().optional(),
        status: zod_1.z.enum(['active', 'deprecated']).optional().default('active'),
        supersededBy: exports.Caip2Schema.optional(),
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
exports.ChainDeleteSchema = zod_1.z.object({
    body: zod_1.z.object({
        name: zod_1.z.string().min(1, 'Chain name required for deletion'),
    }),
});
exports.DwStatusBodySchema = zod_1.z.object({
    exchange: zod_1.z.string().min(1, 'exchange required'),
    network: zod_1.z.string().min(1, 'network required').transform(val => val.replace('/', ':')),
    ticker: zod_1.z.string().min(1, 'ticker required'),
    status: zod_1.z.enum(exports.DW_STATUS_VALUES, { message: 'Invalid status value' }),
});
exports.DwDeepDiveTaskSchema = zod_1.z.object({
    ticker: zod_1.z.string().min(1, 'ticker required'),
    exchanges: zod_1.z.array(zod_1.z.string().min(1)).min(1, 'exchanges array required'),
});
// ==========================================
// Extension Form Draft Schemas
// ==========================================
exports.DraftLabelFormSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    comment: zod_1.z.string().optional(),
    entity: zod_1.z.string().optional(),
    track: zod_1.z.boolean().optional(),
    chains: zod_1.z.array(zod_1.z.string()).optional(),
    aliases: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string(), chain: zod_1.z.string() })).optional().default([]),
    editingAddr: zod_1.z.string().optional(),
});
exports.DraftEntityFormSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    comment: zod_1.z.string().optional(),
    track: zod_1.z.boolean().optional(),
    image: zod_1.z.string().optional(),
    imageFilename: zod_1.z.string().optional(),
    editingId: zod_1.z.string().optional(),
});
exports.DraftChainFormSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    namespace: zod_1.z.string().optional(),
    reference: zod_1.z.string().optional(),
    symbol: zod_1.z.string().optional(),
    isTestnet: zod_1.z.boolean().optional(),
    gasPrice: zod_1.z.string().optional(),
    explorerPrefix: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    supersededBy: zod_1.z.string().optional(),
    bgType: zod_1.z.string().optional(),
    bgColorStart: zod_1.z.string().optional(),
    bgColorMid: zod_1.z.string().optional(),
    bgColorEnd: zod_1.z.string().optional(),
    fontColor: zod_1.z.string().optional(),
    regex: zod_1.z.string().optional(),
    caseSensitive: zod_1.z.boolean().optional(),
    rpcs: zod_1.z.array(zod_1.z.string()).optional(),
    wsRpcs: zod_1.z.array(zod_1.z.string()).optional(),
    annotations: zod_1.z.record(zod_1.z.string()).optional(),
    editingId: zod_1.z.string().optional(),
});
exports.ExtensionFormDraftSchema = zod_1.z.object({
    labels: exports.DraftLabelFormSchema.optional(),
    entities: exports.DraftEntityFormSchema.optional(),
    chains: exports.DraftChainFormSchema.optional(),
    activeTab: zod_1.z.string().optional(),
});
//# sourceMappingURL=index.js.map