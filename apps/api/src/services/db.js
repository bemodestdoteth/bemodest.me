import { getDBClient as sharedGetDBClient, closeDBClient as sharedCloseDBClient } from '@bemodest/database';

/**
 * Get the singleton MongoDB client instance from the shared database package
 * @returns {Promise<import('@bemodest/database').MongoDBClient>}
 */
export async function getDBClient() {
    return sharedGetDBClient();
}

/**
 * Gracefully close the shared MongoDB connection
 */
export async function closeDBClient() {
    return sharedCloseDBClient();
}
