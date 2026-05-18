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
