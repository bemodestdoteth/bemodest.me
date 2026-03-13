import { MongoDBClient } from '@bemodest/database';
import logger from '../config/logger.js';

let dbClient = null;

/**
 * Get the singleton MongoDB client instance
 * @returns {Promise<MongoDBClient>}
 */
export async function getDBClient() {
    if (!dbClient) {
        dbClient = new MongoDBClient();
        await dbClient.connect();
        logger.info('[DB] Singleton MongoDB connection established');
    }
    return dbClient;
}

/**
 * Gracefully close the MongoDB connection
 */
export async function closeDBClient() {
    if (dbClient) {
        await dbClient.close();
        dbClient = null;
        logger.info('[DB] Singleton MongoDB connection closed');
    }
}
