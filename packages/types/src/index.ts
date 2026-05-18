export * from './schemas/index.js';

import { z } from 'zod';

// ==========================================
// Constants & Regex
// ==========================================

export const CAIP2_RE = /^[-a-z0-9]{3,8}\/[-_.a-zA-Z0-9]{1,32}$/;
/**
 * Note: using '/' internally for Redis-safe encoding (eip155/1)
 * The DB stores with ':' (eip155:1). Validate DB values with:
 */
export const CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;

export const DW_STATUS_VALUES = ['both', 'deposit_only', 'withdraw_only', 'suspended'] as const;

export const ALERT_CONDITIONS = [
  'spread_pct',
  'price_above',
  'price_below',
  'change_pct_5m',
  'change_pct_24h',
  'volume_spike',
] as const;

// ==========================================
// Base Domain Schemas
// ==========================================

export const Caip2Schema = z.string().regex(CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');
export const Caip2RedisSchema = z.string().regex(CAIP2_RE, 'Must be a valid CAIP-2 encoded for Redis (namespace/reference)');

export const AliasSchema = z.object({
  name: z.string().min(1, 'Alias name must not be empty'),
  chain: Caip2Schema,
});

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

export const EntitySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  tracking: z.boolean().default(false),
  image: z.string().url().optional(),
  comment: z.string().max(500).optional(),
});

export type Entity = z.infer<typeof EntitySchema>;

// ==========================================
// Auth & Transport Schemas
// ==========================================

export const AuthSessionSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['web', 'extension']).optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

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

export const ErrorObjectSchema = z.object({
  message: z.string(),
  code: z.string(),
  statusCode: z.number(),
  timestamp: z.string(),
  requestId: z.string().optional(),
});

export type ErrorObject = z.infer<typeof ErrorObjectSchema>;

// ==========================================
// Socket.IO Payload Schemas
// ==========================================

export const ChainGetSchema = z.object({
  params: z.object({}).optional().default({}),
});

export const EntityGetSchema = z.object({
  params: z.object({}).optional().default({}),
});

export const EntityInsertSchema = z.object({
  body: z.record(
    z.string().min(1, 'Entity name required'),
    z.object({
      image: z.string().optional().default(''),
      imageFilename: z.string().optional(),
      comment: z.string().optional().default(''),
      tracking: z.boolean().optional().default(false),
    })
  ),
});

export const EntityDeleteSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Entity name required for deletion'),
  }),
});

export const EntityUpdateSchema = z.object({
  body: z.object({
    originalName: z.string().min(1, 'Original entity name required'),
    name: z.string().min(1, 'Entity name required'),
    image: z.string().optional().default(''),
    imageFilename: z.string().optional(),
    comment: z.string().optional().default(''),
    tracking: z.boolean().optional().default(false),
  }),
});

export const LabelGetSchema = z.object({
  params: z.object({}).optional().default({}),
});

export const LabelInsertSchema = z.object({
  body: z.object({
    addr: z.string().min(1, 'Address required'),
    chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
    entity: z.string().optional().default(''),
    comment: z.string().optional().default(''),
    label: z.string().optional().default(''),
    tracking: z.boolean().optional().default(false),
    aliases: z.array(AliasSchema).optional().default([]),
  }),
});

export const LabelUpdateSchema = z.object({
  body: z.object({
    originalAddr: z.string().min(1, 'Original address required'),
    addr: z.string().min(1, 'Address required'),
    chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
    entity: z.string().optional().default(''),
    comment: z.string().optional().default(''),
    label: z.string().optional().default(''),
    tracking: z.boolean().optional().default(false),
    aliases: z.array(AliasSchema).optional().default([]),
  }),
});

export const LabelDeleteSchema = z.object({
  body: z.object({
    addr: z.string().min(1, 'Address required for deletion'),
  }),
});

export const LabelInsertBulkSchema = z.object({
  body: z.array(
    z.object({
      addr: z.string().min(1, 'Address required'),
      chains: z.array(Caip2Schema).min(1, 'At least one chain required'),
      entity: z.string().optional().default(''),
      comment: z.string().optional().default(''),
      label: z.string().min(1, 'Label must not be empty'),
      tracking: z.boolean().optional().default(false),
      aliases: z.array(AliasSchema).optional().default([]),
    })
  ).min(1, 'At least one label required for bulk insert'),
});

export const LabelDeleteBulkSchema = z.object({
  address: z.union([
    z.string().min(1, 'Address required'),
    z.array(z.string().min(1, 'Address required')).min(1, 'At least one address required')
  ]),
  key: z.string().optional()
});

export const AlertRuleSchema = z.any(); // Placeholder as per deprecated original, pending full JSON schema integration

export const ChainInsertSchema = z.object({
  body: z.object({
    caip2: Caip2Schema,
    chain: z.string().min(1, 'Chain identifier is required'),
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
    code: z.string().regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric').min(1, 'Code is required'),
    annotation: z.object({
      geckoterminal: z.string().optional(),
    }).passthrough().optional(),
    status: z.enum(['active', 'deprecated']).optional().default('active'),
    supersededBy: Caip2Schema.optional(),
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

export const ChainUpdateSchema = z.object({
  body: z.object({
    _id: z.union([z.string(), z.number()]).refine(val => val !== undefined && val !== "undefined", {
      message: 'Valid ID is required for update',
    }),
    caip2: Caip2Schema,
    chain: z.string().min(1, 'Chain identifier is required'),
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
    }).passthrough().optional(),
    status: z.enum(['active', 'deprecated']).optional().default('active'),
    supersededBy: Caip2Schema.optional(),
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

export const ChainDeleteSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Chain name required for deletion'),
  }),
});

export const DwStatusBodySchema = z.object({
  exchange: z.string().min(1, 'exchange required'),
  network: z.string().min(1, 'network required').transform(val => val.replace('/', ':')),
  ticker: z.string().min(1, 'ticker required'),
  status: z.enum(DW_STATUS_VALUES, { message: 'Invalid status value' }),
});

export const DwDeepDiveTaskSchema = z.object({
  ticker: z.string().min(1, 'ticker required'),
  exchanges: z.array(z.string().min(1)).min(1, 'exchanges array required'),
});

// ==========================================
// Extension Form Draft Schemas
// ==========================================

export const DraftLabelFormSchema = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  comment: z.string().optional(),
  entity: z.string().optional(),
  track: z.boolean().optional(),
  chains: z.array(z.string()).optional(),
  aliases: z.array(z.object({ name: z.string(), chain: z.string() })).optional().default([]),
  editingAddr: z.string().optional(),
});

export const DraftEntityFormSchema = z.object({
  name: z.string().optional(),
  comment: z.string().optional(),
  track: z.boolean().optional(),
  image: z.string().optional(),
  imageFilename: z.string().optional(),
  editingId: z.string().optional(),
});

export const DraftChainFormSchema = z.object({
  name: z.string().optional(),
  namespace: z.string().optional(),
  reference: z.string().optional(),
  symbol: z.string().optional(),
  isTestnet: z.boolean().optional(),
  gasPrice: z.string().optional(),
  explorerPrefix: z.string().optional(),
  status: z.string().optional(),
  supersededBy: z.string().optional(),
  bgType: z.string().optional(),
  bgColorStart: z.string().optional(),
  bgColorMid: z.string().optional(),
  bgColorEnd: z.string().optional(),
  fontColor: z.string().optional(),
  regex: z.string().optional(),
  caseSensitive: z.boolean().optional(),
  rpcs: z.array(z.string()).optional(),
  wsRpcs: z.array(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
  editingId: z.string().optional(),
});

export const ExtensionFormDraftSchema = z.object({
  labels: DraftLabelFormSchema.optional(),
  entities: DraftEntityFormSchema.optional(),
  chains: DraftChainFormSchema.optional(),
  activeTab: z.string().optional(),
});

export type DraftLabelForm = z.infer<typeof DraftLabelFormSchema>;
export type DraftEntityForm = z.infer<typeof DraftEntityFormSchema>;
export type DraftChainForm = z.infer<typeof DraftChainFormSchema>;
export type ExtensionFormDraft = z.infer<typeof ExtensionFormDraftSchema>;
