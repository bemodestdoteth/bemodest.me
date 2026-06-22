import { logger } from '@bemodest/utils';
import { encodeDbPassword } from '@bemodest/config';
import { MongoClient, Db, Collection, FindOptions, UpdateFilter, Filter, AggregateOptions, IndexSpecification, CreateIndexesOptions } from 'mongodb';
import * as fs from 'node:fs/promises';


const MONGO_TLS = process.env.MONGO_TLS === 'true';
const MONGO_AUTH_SOURCE = process.env.MONGO_AUTH_SOURCE || 'admin';
const MONGODB_MAX_TIME_MS = Number(process.env.MONGODB_MAX_TIME_MS) || 30000;

export class MongoDBClient {
    private client: MongoClient;
    private database: Db | null = null;
    private dbName: string;
    private maxTimeMS: number;
    private uri: string;

    constructor() {
        const user = encodeURIComponent(process.env.MONGO_USER || '');
        const password = encodeDbPassword(process.env.MONGO_PASSWORD || '');
        const host = process.env.MONGO_HOST;
        const port = process.env.MONGO_PORT;
        this.dbName = process.env.MONGO_DB_NAME || 'test';

        const tls = MONGO_TLS ? 'true' : 'false';
        const authSource = MONGO_AUTH_SOURCE;

        this.uri = `mongodb://${user}:${password}@${host}:${port}/${this.dbName}?tls=${tls}&authSource=${authSource}`;
        this.client = new MongoClient(this.uri);
        this.maxTimeMS = MONGODB_MAX_TIME_MS;
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
            this.database = this.client.db(this.dbName);
            logger.info('Successfully connected to MongoDB');
        } catch (error) {
            logger.error('Error connecting to MongoDB:', error);
            throw error;
        }
    }

    async close(): Promise<void> {
        try {
            if (this.client) {
                await this.client.close();
                logger.info('Connection to MongoDB closed');
            } else {
                logger.warn('No active MongoDB connection to close');
            }
        } catch (error) {
            logger.error('Error closing MongoDB connection:', error);
            throw error;
        }
    }

    async count(collectionName: string, query: Filter<any>): Promise<number> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const count = await collection.countDocuments(query, { maxTimeMS: this.maxTimeMS });
            return count;
        } catch (error) {
            logger.error('Error counting documents:', error);
            throw error;
        }
    }

    async createOne(collectionName: string, document: any): Promise<any> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.insertOne(document);
            return result;
        } catch (error) {
            logger.error('Error creating document:', error);
            throw error;
        }
    }

    async readOne(collectionName: string, query: Filter<any>): Promise<any | null> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
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
            const collection = this.client.db(databaseName).collection(collectionName);
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
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            return await collection.createIndex(indexSpec, { ...options, maxTimeMS: this.maxTimeMS });
        } catch (error) {
            logger.error('Error creating index:', error);
            throw error;
        }
    }

    async updateOne(collectionName: string, query: Filter<any>, update: UpdateFilter<any>): Promise<any> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.updateOne(query, update, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error updating document:', error);
            throw error;
        }
    }

    async deleteOne(collectionName: string, query: Filter<any>): Promise<any> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.deleteOne(query, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error deleting document:', error);
            throw error;
        }
    }

    async createMany(collectionName: string, documents: any[]): Promise<any> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.insertMany(documents);
            return result;
        } catch (error) {
            logger.error('Error creating multiple documents:', error);
            throw error;
        }
    }

    async readMany(collectionName: string, query: Filter<any>, options: FindOptions = {}): Promise<any[]> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
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
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.updateMany(query, update, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error updating multiple documents:', error);
            throw error;
        }
    }

    async deleteMany(collectionName: string, query: Filter<any>): Promise<any> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const result = await collection.deleteMany(query, { maxTimeMS: this.maxTimeMS });
            return result;
        } catch (error) {
            logger.error('Error deleting multiple documents:', error);
            throw error;
        }
    }

    async aggregate(collectionName: string, pipeline: any[]): Promise<any[]> {
        try {
            this._ensureConnected();
            const collection = this.database!.collection(collectionName);
            const cursor = collection.aggregate(pipeline, { maxTimeMS: this.maxTimeMS });
            const result = await cursor.toArray();
            return result;
        } catch (error) {
            logger.error('Error executing aggregation:', error);
            throw error;
        }
    }

    private _ensureConnected(): void {
        if (!this.database) {
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

    // Higher-level helpers can be added here...
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
