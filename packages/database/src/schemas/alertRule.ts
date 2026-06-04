import { z } from 'zod';
import { BaseMongoSchema } from './mongo.js';

export const AlertConditionSchema = z.enum([
    'change_pct_5m',
    'change_pct_24h',
    'price_above',
    'price_below',
    'spread_pct',
    'volume_spike',
]);

export type AlertCondition = z.infer<typeof AlertConditionSchema>;

export const AlertRuleScopeSchema = z.enum(['alert', 'market_watch']);

export type AlertRuleScope = z.infer<typeof AlertRuleScopeSchema>;

export const AlertRuleSchema = BaseMongoSchema.extend({
    _id: z.string(), // Sentinel: Required for Rust integrity
    scope: AlertRuleScopeSchema.default('alert'),
    condition: AlertConditionSchema,
    cooldown_secs: z.number().int(),
    created_at: z.string().optional(),
    enabled: z.boolean(),
    exchanges: z.array(z.string()),
    label: z.string(),
    minSources: z.number().int().default(2),
    quote: z.string(),
    recovery_value: z.number(),
    ticker: z.string(),
    updated_at: z.string().optional(),
    value: z.number(),
    volumeFloorUsd: z.number().default(30000),
    webhook_dead: z.boolean().default(false),
    webhook_url: z.string().url(),
});

export type AlertRule = z.infer<typeof AlertRuleSchema>;
