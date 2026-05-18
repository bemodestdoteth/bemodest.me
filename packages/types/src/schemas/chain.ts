import { z } from 'zod';
import { BaseMongoSchema } from './mongo.js';
import { Caip2Schema } from './types.js';

export const ChainSchema = BaseMongoSchema.extend({
    caip2: Caip2Schema,
    code: z.string().regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric').optional(),
    chain: z.string(),
    name: z.string(),
    symbol: z.string().optional(),
    chainId: z.number().optional(),
    isTestnet: z.boolean().default(false),
    gasPriceGwei: z.number().nullable().optional(),
    rpc: z.array(z.string().url().or(z.literal('placeholder'))).optional(),
    wsRpc: z.array(z.string().url().or(z.literal('placeholder'))).optional(),
    blockExplorerPrefix: z.string().optional(),
    bgColor: z.string().optional(),
    fontColor: z.enum(['#EFEFEF', '#303030']).optional(),
    addrRegexPatterns: z.array(z.string()).optional(),
    addrCaseSensitive: z.boolean().default(false),
    memoRequired: z.boolean().default(false),
    memoRegexPatterns: z.array(z.string()).optional(),
    block_time: z.number().int().default(30),
    annotation: z.record(z.any()).optional(),
    status: z.enum(['active', 'deprecated']).default('active'),
    supersededBy: Caip2Schema.optional(),
});

export type Chain = z.infer<typeof ChainSchema>;
