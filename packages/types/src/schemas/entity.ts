import { z } from 'zod';
import { BaseMongoSchema } from './types.js';

export const EntitySchema = BaseMongoSchema.extend({
    name: z.string(),
    code: z.string(),
    tracking: z.boolean().default(false),
    image: z.string().optional(), // Base64 stored in DB, converted to DataURI on read
    comment: z.string().optional(),
});

export type Entity = z.infer<typeof EntitySchema>;
