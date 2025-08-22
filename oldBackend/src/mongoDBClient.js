import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

const envFile = process.env.NODE_ENV === "dev" ? `.env.${process.env.NODE_ENV}` : '.env';
dotenv.config({ path: envFile });

export class MongoDBClient {
  constructor() {
    // Read credentials from environment variables
    const user = encodeURIComponent(process.env.MONGO_USER);
    const password = encodeURIComponent(process.env.MONGO_PASSWORD);
    const host = process.env.MONGO_HOST;
    const port = process.env.MONGO_PORT;
    const dbName = process.env.MONGO_DB_NAME;

    this.uri = `mongodb://${user}:${password}@${host}:${port}/${dbName}?authSource=admin`;
    this.client = new MongoClient(this.uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    this.database = null;
  }

  // --------------------
  // Connection Methods
  // --------------------
  async connect() {
    try {
      await this.client.connect();
      this.database = this.client.db(this.dbName);
      console.log('Successfully connected to MongoDB');
    } catch (error) {
      console.error('Error connecting to MongoDB:', error);
      throw error;
    }
  }

  async close() {
    try {
      if (this.client) {
        await this.client.close();
        console.log('Connection to MongoDB closed');
      } else {
        console.log('No active MongoDB connection to close');
      }
    } catch (error) {
      console.error('Error closing MongoDB connection:', error);
      throw error;
    }
  }

  // --------------------
  // Single-Document CRUD
  // --------------------
  /**
   * Create (Insert) a single document
   */
  async createOne(collectionName, document) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.insertOne(document);
      return result; // contains insertedId, etc.
    } catch (error) {
      console.error('Error creating document:', error);
      throw error;
    }
  }

  /**
   * Read (Find) a single document
   */
  async readOne(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const document = await collection.findOne(query);
      return document;
    } catch (error) {
      console.error('Error reading document:', error);
      throw error;
    }
  }

  /**
   * Update a single document
   */
  async updateOne(collectionName, query, update) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.updateOne(query, update);
      return result; // contains matchedCount, modifiedCount
    } catch (error) {
      console.error('Error updating document:', error);
      throw error;
    }
  }

  /**
   * Delete a single document
   */
  async deleteOne(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.deleteOne(query);
      return result; // contains deletedCount
    } catch (error) {
      console.error('Error deleting document:', error);
      throw error;
    }
  }

  // --------------------
  // Multi-Document CRUD
  // --------------------
  /**
   * Create (Insert) multiple documents
   * @param {string} collectionName - The collection to insert into.
   * @param {Array} documents - Array of documents to insert.
   */
  async createMany(collectionName, documents) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.insertMany(documents);
      return result; // contains insertedCount, insertedIds
    } catch (error) {
      console.error('Error creating multiple documents:', error);
      throw error;
    }
  }

  /**
   * Read (Find) multiple documents
   * @param {string} collectionName - The collection to query.
   * @param {object} query - The MongoDB query to match documents.
   * @param {object} [options] - Additional find options (e.g., projection, sort, limit).
   */
  async readMany(collectionName, query, options = {}) {
    try {
      const collection = this.database.collection(collectionName);
      const cursor = collection.find(query, options);
      const documents = await cursor.toArray();
      return documents;
    } catch (error) {
      console.error('Error reading multiple documents:', error);
      throw error;
    }
  }

  /**
   * Update multiple documents
   * @param {string} collectionName - The collection to update.
   * @param {object} query - Query to match documents to update.
   * @param {object} update - The update operations (e.g. {$set: {field: value}}).
   */
  async updateMany(collectionName, query, update) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.updateMany(query, update);
      return result; // contains matchedCount, modifiedCount
    } catch (error) {
      console.error('Error updating multiple documents:', error);
      throw error;
    }
  }

  /**
   * Delete multiple documents
   * @param {string} collectionName - The collection to delete from.
   * @param {object} query - Query to match documents to delete.
   */
  async deleteMany(collectionName, query) {
    try {
      const collection = this.database.collection(collectionName);
      const result = await collection.deleteMany(query);
      return result; // contains deletedCount
    } catch (error) {
      console.error('Error deleting multiple documents:', error);
      throw error;
    }
  }
}