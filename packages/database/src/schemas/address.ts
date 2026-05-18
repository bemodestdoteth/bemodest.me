import { z } from 'zod';
import { BaseMongoSchema } from './mongo.js';

const CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;
const Caip2Schema = z.string().regex(CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');

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
