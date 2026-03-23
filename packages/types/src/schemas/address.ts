import { z } from 'zod';
import { BaseMongoSchema, Caip2Schema } from './types.js';

export const AddressAliasSchema = z.object({
    name: z.string(),
    chain: Caip2Schema,
});

export const AddressSchema = BaseMongoSchema.extend({
    addr: z.string(),
    chains: z.array(Caip2Schema).default([]),
    entity: z.string().optional(),
    entityImage: z.string().optional(),
    comment: z.string().optional(),
    label: z.string().optional(),
    tracking: z.boolean().default(false),
    aliases: z.array(AddressAliasSchema).default([]),
});

export type Address = z.infer<typeof AddressSchema>;
