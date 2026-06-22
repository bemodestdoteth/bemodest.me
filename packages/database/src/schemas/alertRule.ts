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

export const AlertDestinationKindSchema = z.enum(['builtin_api_ingest', 'external_webhook']);

export type AlertDestinationKind = z.infer<typeof AlertDestinationKindSchema>;

export const AlertTypeSchema = z.enum(['normal', 'urgent']);

export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertTypeOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte']);

export type AlertTypeOperator = z.infer<typeof AlertTypeOperatorSchema>;

export const WebhookTemplateSchema = z.enum(['price_spike', 'new_entry']);

export type WebhookTemplate = z.infer<typeof WebhookTemplateSchema>;

export const AlertDestinationTemplateSchema = BaseMongoSchema.extend({
    _id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    label: z.string().min(1),
    kind: AlertDestinationKindSchema,
    url: z.string().url(),
    enabled: z.boolean().default(true),
    supported_alert_types: z.array(AlertTypeSchema).nonempty().refine(
        alertTypes => new Set(alertTypes).size === alertTypes.length,
        { message: 'supported_alert_types must be unique' },
    ),
    protected: z.boolean().default(false),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
});

export const AlertDestinationAssignmentSchema = z.object({
    destination_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    enabled: z.boolean().default(true),
    dead: z.boolean().default(false),
    last_failed_at: z.string().optional(),
});

export const AlertTypeRuleSchema = z.object({
    alert_type: AlertTypeSchema,
    operator: AlertTypeOperatorSchema,
    value: z.number(),
});

export const AlertTypeRulesSchema = z.array(AlertTypeRuleSchema).nonempty().refine(
    rules => new Set(rules.map(rule => rule.alert_type)).size === rules.length,
    { message: 'alert_type_rules must contain each alert_type at most once' },
);

export const DestinationAssignmentsSchema = z.array(AlertDestinationAssignmentSchema).nonempty().refine(
    assignments => new Set(assignments.map(assignment => assignment.destination_id)).size === assignments.length,
    { message: 'destination_assignments destination_id values must be unique' },
);

export const DeliveryDestinationSchema = AlertDestinationTemplateSchema.pick({
    _id: true,
    label: true,
    kind: true,
});

export const AlertEventIngestSchema = z.object({
    alert_event_id: z.string().uuid(),
    rule_id: z.string(),
    label: z.string(),
    scope: AlertRuleScopeSchema,
    condition: AlertConditionSchema,
    alert_type: AlertTypeSchema,
    ticker: z.string(),
    quote: z.string(),
    exchanges: z.array(z.string()),
    value: z.number(),
    threshold: z.number(),
    highest_exchange: z.string().optional().nullable(),
    lowest_exchange: z.string().optional().nullable(),
    price_high: z.number().optional().nullable(),
    price_low: z.number().optional().nullable(),
    premium_exchange: z.string().optional().nullable(),
    premium_adjustment_pct: z.number().optional().nullable(),
    triggered_at: z.string(),
    delivery_destination: DeliveryDestinationSchema,
    webhook_template: WebhookTemplateSchema.optional().nullable(),
    template_payload: z.record(z.unknown()).optional().nullable(),
});

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
    destination_assignments: DestinationAssignmentsSchema,
    alert_type_rules: AlertTypeRulesSchema,
});

export const AlertDestinationSchema = AlertDestinationTemplateSchema;

export type AlertDestination = z.infer<typeof AlertDestinationTemplateSchema>;
export type AlertDestinationTemplate = z.infer<typeof AlertDestinationTemplateSchema>;
export type AlertDestinationAssignment = z.infer<typeof AlertDestinationAssignmentSchema>;
export type AlertTypeRule = z.infer<typeof AlertTypeRuleSchema>;
export type AlertEventIngest = z.infer<typeof AlertEventIngestSchema>;
export type AlertRule = z.infer<typeof AlertRuleSchema>;
