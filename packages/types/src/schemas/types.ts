import { z } from 'zod';
import { ObjectId } from 'mongodb';

export const ObjectIdSchema = z.union([
    z.string(),
    z.instanceof(ObjectId)
]).transform(val => {
    if (typeof val === 'string') return new ObjectId(val);
    return val;
});

export const BaseMongoSchema = z.object({
    _id: ObjectIdSchema.optional(),
});

export const CAIP2_DB_RE = /^[-a-z0-9]{3,8}:[-_.a-zA-Z0-9]{1,32}$/;
export const Caip2Schema = z.string().regex(CAIP2_DB_RE, 'Must be a valid CAIP-2 ID (namespace:reference)');
