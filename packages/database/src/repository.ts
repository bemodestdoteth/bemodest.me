import {
    Collection,
    Document,
    Filter,
    UpdateFilter,
    FindOptions,
    InsertOneResult,
    UpdateResult,
    DeleteResult,
    OptionalUnlessRequiredId,
    ObjectId
} from 'mongodb';
import { z } from 'zod';
import { MongoDBClient, getDBClient } from './mongoDBClient.js';

export abstract class GenericRepository<T extends Document, S extends z.ZodType<any>> {
    protected collectionName: string;
    protected schema: S;

    constructor(collectionName: string, schema: S) {
        this.collectionName = collectionName;
        this.schema = schema;
    }

    protected async getCollection(): Promise<Collection<T>> {
        const client = await getDBClient();
        // @ts-ignore - access private database for repo use
        return client.database!.collection<T>(this.collectionName);
    }

    async findOne(filter: Filter<T>, options?: FindOptions): Promise<T | null> {
        const col = await this.getCollection();
        const doc = await col.findOne(filter, options);
        return doc as unknown as T | null;
    }

    async findMany(filter: Filter<T>, options?: FindOptions): Promise<T[]> {
        const col = await this.getCollection();
        const docs = await col.find(filter, options).toArray();
        return docs as unknown as T[];
    }

    async insertOne(doc: OptionalUnlessRequiredId<T>): Promise<InsertOneResult<T>> {
        const col = await this.getCollection();
        // Validate if schema is provided
        if (this.schema) {
            this.schema.parse(doc);
        }
        return col.insertOne(doc);
    }

    async updateOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult<T>> {
        const col = await this.getCollection();
        return col.updateOne(filter, update);
    }

    async deleteOne(filter: Filter<T>): Promise<DeleteResult> {
        const col = await this.getCollection();
        return col.deleteOne(filter);
    }

    async count(filter: Filter<T>): Promise<number> {
        const col = await this.getCollection();
        return col.countDocuments(filter);
    }
}
