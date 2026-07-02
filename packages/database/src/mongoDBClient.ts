import { MongoDBClient as CoreMongoDBClient } from '@bemodest/core';
import { logger } from '@bemodest/utils';
import { Collection, Db, FindOptions, UpdateFilter, Filter, IndexSpecification, CreateIndexesOptions, FindOneAndUpdateOptions, Document, MongoClient } from 'mongodb';
import * as fs from 'node:fs/promises';

const MONGODB_MAX_TIME_MS = Number(process.env.MONGODB_MAX_TIME_MS) || 30000;

export class MongoDBClient {
    public client: MongoClient | null = null;
    public database: Db | null = null;
    public dbName: string;
    private maxTimeMS: number;
    private core: CoreMongoDBClient;

    constructor() {
        this.dbName = process.env.MONGO_DB_NAME || 'test';
        this.maxTimeMS = MONGODB_MAX_TIME_MS;
        this.core = new CoreMongoDBClient(
            process.env.MONGO_USERNAME || process.env.MONGO_USER,
            process.env.MONGO_PASSWORD,
            process.env.MONGO_HOST,
            process.env.MONGO_PORT ? Number(process.env.MONGO_PORT) : undefined,
            this.dbName
        );
    }

    async connect(): Promise<void> {
        try {
            await this.core.connect();
            this.client = this.core.client;
            this.database = this.core.db;
            logger.info('Successfully connected to MongoDB');
        } catch (error) {
            logger.error('Error connecting to MongoDB:', error);
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.client) {
                await this.core.close();
                this.client = null;
                this.database = null;
                logger.info('Connection to MongoDB closed');
            } else {
                logger.warn('No active MongoDB connection to close');
            }
        } catch (error) {
            logger.error('Error closing MongoDB connection:', error);
            throw error;
        }
    }

    getCollection<T extends Document = Document>(collectionName: string): Collection<T> {
        this._ensureConnected();
        return this.database!.collection<T>(collectionName);
    }

    async count(collectionName: string, query: Filter<any>): Promise<number> {
        try {
            const collection = this.getCollection(collectionName);
            const count = await collection.countDocuments(query, { maxTimeMS: this.maxTimeMS });
            return count;
        } catch (error) {
            logger.error('Error counting documents:', error);
            throw error;
        }
    }

    async createOne(collectionName: string, document: any): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.insertOne(document);
            return result;
        } catch (error) {
            logger.error('Error creating document:', error);
            throw error;
        }
    }

    async readOne(collectionName: string, query: Filter<any>): Promise<any | null> {
        try {
            const collection = this.getCollection(collectionName);
            const document = await collection.findOne(query, { maxTimeMS: this.maxTimeMS });
            return document;
        } catch (error) {
            logger.error('Error reading document:', error);
            throw error;
        }
    }

    async readOneFromDatabase(databaseName: string, collectionName: string, query: Filter<any>): Promise<any | null> {
        try {
            this._ensureConnected();
            const collection = this.client!.db(databaseName).collection(collectionName);
            const document = await collection.findOne(query, { maxTimeMS: this.maxTimeMS });
            return document;
        } catch (error) {
            logger.error('Error reading document from database:', error);
            throw error;
        }
    }

    async createIndex(
        collectionName: string,
        indexSpec: IndexSpecification,
        options: CreateIndexesOptions = {}
    ): Promise<string> {
        try {
            const collection = this.getCollection(collectionName);
            return await collection.createIndex(indexSpec, { ...options, maxTimeMS: this.maxTimeMS });
        } catch (error) {
            logger.error('Error creating index:', error);
            throw error;
        }
    }

    async updateOne(collectionName: string, query: Filter<any>, update: UpdateFilter<any>): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.updateOne(query, update, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error updating document:', error);
            throw error;
        }
    }

    async findOneAndUpdate(
        collectionName: string,
        query: Filter<any>,
        update: UpdateFilter<any> | Document[],
        options: FindOneAndUpdateOptions = {}
    ): Promise<any | null> {
        try {
            const collection = this.getCollection(collectionName);
            const document = await collection.findOneAndUpdate(query, update, { ...options, maxTimeMS: this.maxTimeMS });
            return document;
        } catch (error) {
            logger.error('Error finding and updating document:', error);
            throw error;
        }
    }

    async deleteOne(collectionName: string, query: Filter<any>): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.deleteOne(query, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error deleting document:', error);
            throw error;
        }
    }

    async createMany(collectionName: string, documents: any[]): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.insertMany(documents);
            return result;
        } catch (error) {
            logger.error('Error creating multiple documents:', error);
            throw error;
        }
    }

    async readMany(collectionName: string, query: Filter<any>, options: FindOptions = {}): Promise<any[]> {
        try {
            const collection = this.getCollection(collectionName);
            const cursor = collection.find(query, { ...options, maxTimeMS: this.maxTimeMS });
            const documents = await cursor.toArray();
            return documents;
        } catch (error) {
            logger.error('Error reading multiple documents:', error);
            throw error;
        }
    }

    async updateMany(collectionName: string, query: Filter<any>, update: UpdateFilter<any>): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.updateMany(query, update, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error updating multiple documents:', error);
            throw error;
        }
    }

    async deleteMany(collectionName: string, query: Filter<any>): Promise<any> {
        try {
            const collection = this.getCollection(collectionName);
            const result = await collection.deleteMany(query, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error deleting multiple documents:', error);
            throw error;
        }
    }

    async aggregate(collectionName: string, pipeline: any[]): Promise<any[]> {
        try {
            const collection = this.getCollection(collectionName);
            const cursor = collection.aggregate(pipeline, { maxTimeMS: this.maxTimeMS });
            const result = await cursor.toArray();
            return result;
        } catch (error) {
            logger.error('Error executing aggregation:', error);
            throw error;
        }
    }

    private _ensureConnected(): void {
        if (!this.database || !this.client) {
            throw new Error('MongoDBClient: Database not connected. Call connect() first.');
        }
    }

    async imageToBase64(filePath: string): Promise<string> {
        try {
            const bitmap = await fs.readFile(filePath);
            return bitmap.toString('base64');
        } catch (error) {
            logger.error(`Error converting image to Base64: ${filePath}`, error);
            throw error;
        }
    }

    base64ToDataURI(base64: string, mimeType: string = 'image/png'): string {
        return `data:${mimeType};base64,${base64}`;
    }

    // Domain-Specific Helpers (Type-safe signatures as needed)
    async getChainsWithCounts(chainsCollection: string, addrsCollection: string, query: Filter<any> = {}): Promise<any[]> {
        this._ensureConnected();
        const chains = await this.readMany(chainsCollection, query);

        const labelCounts = await this.aggregate(addrsCollection, [
            { $unwind: "$chains" },
            { $group: { _id: "$chains", count: { $sum: 1 } } }
        ]);

        const countMap: Record<string, number> = {};
        labelCounts.forEach(item => {
            if (item._id) countMap[item._id] = item.count;
        });

        return chains.map(chain => ({
            ...chain,
            _id: chain._id.toString(),
            code: chain.code || chain.chain,
            labelCount: countMap[chain.caip2] || 0
        }));
    }

    async getCaip2ToGeckoTerminalMapping(collectionName: string): Promise<Record<string, string>> {
        this._ensureConnected();
        const chains = await this.readMany(collectionName, {});
        const mapping: Record<string, string> = {};
        for (const chain of chains) {
            if (chain.caip2 && chain.annotation?.geckoterminal) {
                mapping[chain.caip2] = chain.annotation.geckoterminal;
            }
        }
        return mapping;
    }
}

let sharedDB: MongoDBClient | null = null;
let connectionPromise: Promise<MongoDBClient> | null = null;

export async function getDBClient(): Promise<MongoDBClient> {
    if (sharedDB) return sharedDB;

    if (!connectionPromise) {
        connectionPromise = (async () => {
            const db = new MongoDBClient();
            await db.connect();
            sharedDB = db;
            logger.info('[DB] Shared MongoDB connection established');
            return db;
        })();
    }

    return connectionPromise;
}

export async function closeDBClient(): Promise<void> {
    if (sharedDB) {
        await sharedDB.close();
        sharedDB = null;
        connectionPromise = null;
        logger.info('[DB] Shared MongoDB connection closed');
    }
}
