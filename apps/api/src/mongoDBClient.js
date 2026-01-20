import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import fs from 'node:fs/promises';
import winston from 'winston';

// Initialize Winston logger (RULES O-8001, O-8002)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] | ${level} | ${message}`;
        })
      )
    }),
    new winston.transports.File({ filename: process.env.LOG_FILE || 'mongodb.log' })
  ]
});

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });

/**
 * MongoDB client wrapper with connection pooling and timeout management
 * @class MongoDBClient
 * @description Provides CRUD operations with RULES compliance (D-6001, D-6004, S-3002)
 */
export class MongoDBClient {
  /**
   * Creates MongoDB client instance with environment-based configuration
   * @constructor
   * @throws {Error} If required environment variables are missing
   */
  constructor() {
    // Read credentials from environment variables (RULES S-3001)
    const user = encodeURIComponent(process.env.MONGO_USER);
    const password = encodeURIComponent(process.env.MONGO_PASSWORD); // RULES S-3002
    const host = process.env.MONGO_HOST;
    const port = process.env.MONGO_PORT;
    this.dbName = process.env.MONGO_DB_NAME;

    this.uri = `mongodb://${user}:${password}@${host}:${port}/${this.dbName}?tls=true&authSource=admin`;
    this.client = new MongoClient(this.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    this.database = null;
    this.maxTimeMS = 30000; // RULES D-6004: 30s timeout for operations
  }

  // --------------------
  // Connection Methods
  // --------------------
  /**
   * Establishes connection to MongoDB database
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If connection fails
   * @example
   * const dbClient = new MongoDBClient();
   * await dbClient.connect();
   */
  async connect() {
    try {
      await this.client.connect();
      this.database = this.client.db(this.dbName);
      logger.info('Successfully connected to MongoDB'); // RULES O-8001
    } catch (error) {
      logger.error('Error connecting to MongoDB:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Closes MongoDB connection gracefully
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If closing connection fails
   * @example
   * await dbClient.close();
   */
  async close() {
    try {
      if (this.client) {
        await this.client.close();
        logger.info('Connection to MongoDB closed'); // RULES O-8001
      } else {
        logger.warn('No active MongoDB connection to close'); // RULES O-8001
      }
    } catch (error) {
      logger.error('Error closing MongoDB connection:', error); // RULES O-8001
      throw error;
    }
  }

  // --------------------
  // Single-Document CRUD
  // --------------------

  /**
   * Counts documents in collection matching the query
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @returns {Promise<number>} Count of matching documents
   * @throws {Error} If count fails
   * @example
   * const count = await dbClient.count('users', { status: 'active' });
   */
  async count(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const count = await collection.countDocuments(query, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return count;
    } catch (error) {
      logger.error('Error counting documents:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Creates a single document in specified collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} document - Document to insert
   * @returns {Promise<object>} InsertOneResult with insertedId
   * @throws {Error} If insertion fails
   * @example
   * const result = await dbClient.createOne('users', { name: 'Alice', email: 'alice@example.com' });
   * console.log(result.insertedId);
   */
  async createOne(collectionName, document) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.insertOne(document);
      return result;
    } catch (error) {
      logger.error('Error creating document:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Fetches a single document from collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @returns {Promise<object|null>} Document if found, null otherwise
   * @throws {Error} If query execution fails
   * @example
   * const user = await dbClient.readOne('users', { email: 'alice@example.com' });
   */
  async readOne(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const document = await collection.findOne(query, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return document;
    } catch (error) {
      logger.error('Error reading document:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Updates a single document in collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @param {object} update - Update operations (e.g., {$set: {field: value}})
   * @returns {Promise<object>} UpdateResult with matchedCount and modifiedCount
   * @throws {Error} If update fails
   * @example
   * const result = await dbClient.updateOne('users', { _id: userId }, { $set: { status: 'active' } });
   */
  async updateOne(collectionName, query, update) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.updateOne(query, update, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return result;
    } catch (error) {
      logger.error('Error updating document:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Deletes a single document from collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @returns {Promise<object>} DeleteResult with deletedCount
   * @throws {Error} If deletion fails
   * @example
   * const result = await dbClient.deleteOne('users', { email: 'inactive@example.com' });
   */
  async deleteOne(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.deleteOne(query, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return result;
    } catch (error) {
      logger.error('Error deleting document:', error); // RULES O-8001
      throw error;
    }
  }

  // --------------------
  // Multi-Document CRUD
  // --------------------
  /**
   * Creates multiple documents in collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {Array<object>} documents - Array of documents to insert
   * @returns {Promise<object>} InsertManyResult with insertedCount and insertedIds
   * @throws {Error} If insertion fails
   * @example
   * const users = [{ name: 'Alice' }, { name: 'Bob' }];
   * const result = await dbClient.createMany('users', users);
   */
  async createMany(collectionName, documents) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.insertMany(documents);
      return result;
    } catch (error) {
      logger.error('Error creating multiple documents:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Fetches multiple documents from collection with timeout
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @param {object} [options={}] - Additional find options (projection, sort, limit)
   * @returns {Promise<Array<object>>} Array of matching documents
   * @throws {Error} If query execution fails or exceeds timeout
   * @example
   * const activeUsers = await dbClient.readMany('users', { status: 'active' }, { projection: { password: 0 } });
   */
  async readMany(collectionName, query, options = {}) {
    try {
      const collection = this.database.collection(collectionName);
      // RULES D-6004: Add maxTimeMS timeout
      const cursor = collection.find(query, { ...options, maxTimeMS: this.maxTimeMS });
      const documents = await cursor.toArray();
      return documents;
    } catch (error) {
      logger.error('Error reading multiple documents:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Updates multiple documents in collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @param {object} update - Update operations (e.g., {$set: {field: value}})
   * @returns {Promise<object>} UpdateResult with matchedCount and modifiedCount
   * @throws {Error} If update fails
   * @example
   * const result = await dbClient.updateMany('users', { status: 'pending' }, { $set: { status: 'approved' } });
   */
  async updateMany(collectionName, query, update) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.updateMany(query, update, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return result;
    } catch (error) {
      logger.error('Error updating multiple documents:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Deletes multiple documents from collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {object} query - MongoDB query filter
   * @returns {Promise<object>} DeleteResult with deletedCount
   * @throws {Error} If deletion fails
   * @example
   * const result = await dbClient.deleteMany('sessions', { expiresAt: { $lt: new Date() } });
   */
  async deleteMany(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.deleteMany(query, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      return result;
    } catch (error) {
      logger.error('Error deleting multiple documents:', error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Performs aggregation pipeline on collection
   * @async
   * @param {string} collectionName - Target collection name
   * @param {Array<object>} pipeline - Aggregation pipeline stages
   * @returns {Promise<Array<object>>} Aggregation results
   * @throws {Error} If aggregation fails
   * @example
   * const stats = await dbClient.aggregate('orders', [{ $group: { _id: '$status', count: { $sum: 1 } } }]);
   */
  async aggregate(collectionName, pipeline) {
    try {
      const collection = this.database.collection(collectionName);
      const cursor = collection.aggregate(pipeline, { maxTimeMS: this.maxTimeMS }); // RULES D-6004
      const result = await cursor.toArray();
      return result;
    } catch (error) {
      logger.error('Error executing aggregation:', error); // RULES O-8001
      throw error;
    }
  }

  // --------------------
  // Helper Methods
  // --------------------
  /**
   * Converts image file to Base64 string for BSON storage
   * @async
   * @param {string} filePath - Absolute path to image file
   * @returns {Promise<string>} Base64 encoded string
   * @throws {Error} If file reading fails
   * @example
   * const base64Image = await dbClient.imageToBase64('/path/to/logo.png');
   * await dbClient.createOne('entities', { name: 'Acme', image: base64Image });
   */
  async imageToBase64(filePath) {
    try {
      const bitmap = await fs.readFile(filePath);
      return bitmap.toString('base64');
    } catch (error) {
      logger.error(`Error converting image to Base64: ${filePath}`, error); // RULES O-8001
      throw error;
    }
  }

  /**
   * Convert Base64 string back to Data URI for HTML rendering
   * @param {string} base64 - The Base64 encoded string from MongoDB
   * @param {string} [mimeType='image/png'] - The MIME type of the image
   * @returns {string} Fully qualified Data URI
   * @example
   * const dataUri = dbClient.base64ToDataURI(doc.imageString);
   */
  base64ToDataURI(base64, mimeType = 'image/png') {
    return `data:${mimeType};base64,${base64}`;
  }
}