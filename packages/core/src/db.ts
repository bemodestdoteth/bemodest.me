/** MongoDB client for @bemodest/core.
 *
 * Asynchronous wrapper around the native mongodb driver with connection retries,
 * singleton pattern, and Fernet-encrypted credential support.
 */

import { MongoClient, Db, Document, MongoServerSelectionError } from "mongodb";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { decodeSecret } from "./requests.js";
import { getenv } from "./tasks.js";

export class ServiceWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceWalletError";
  }
}

export class ServiceWalletNotFoundError extends ServiceWalletError {
  constructor(message: string) {
    super(message);
    this.name = "ServiceWalletNotFoundError";
  }
}

export class ServiceWalletDataError extends ServiceWalletError {
  constructor(message: string) {
    super(message);
    this.name = "ServiceWalletDataError";
  }
}

export interface ServiceEvmWallet {
  walletLabel: string;
  address: string;
  privateKey: string;
  exchangeDepositAddress: string;
}

export interface ServiceApiCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

interface EncryptedSecretDocument {
  salt: Buffer | Uint8Array;
  encrypted_key: Buffer | Uint8Array;
}

interface EvmWalletDocument {
  address: string;
  privateKey: EncryptedSecretDocument;
}

export class MongoDBClient {
  /** Singleton MongoClient instance */
  private static _clientInstance: MongoClient | null = null;
  /** Async lock for connection safety */
  private static _connectingPromise: Promise<MongoClient> | null = null;

  private username: string;
  private password: string;
  private host: string;
  private port: number;
  private dbName: string;
  private verbose: boolean;

  public client: MongoClient | null = null;
  public db: Db | null = null;

  constructor(
    username?: string | null,
    password?: string | null,
    host?: string | null,
    port?: number | null,
    dbName?: string | null,
    _tlsCertificateFile?: string | null,
    _tlsCertificateKeyFile?: string | null,
    verbose = false,
  ) {
    this.username = encodeURIComponent(username ?? getenv("MONGO_USERNAME"));
    this.password = encodeURIComponent(password ?? getenv("MONGO_PASSWORD"));
    this.host = host ?? getenv("MONGO_HOST");
    this.port = port ?? parseInt(getenv("MONGO_PORT"), 10);
    this.dbName = dbName ?? getenv("MONGO_DB_NAME");
    this.verbose = verbose;

    if (this.verbose) {
      logger.debug(
        `Connecting to mongodb://${this.username}:****@${this.host}:${this.port}/${this.dbName}?tls=true`,
      );
    }
  }

  async connect(
    uri?: string | null,
    maxRetries?: number | null,
    retryDelay?: number | null,
  ): Promise<void> {
    const retries = maxRetries ?? config.mongo.maxRetries;
    const delay = retryDelay ?? config.mongo.retryDelay;

    if (!uri) {
      uri = `mongodb://${this.username}:${this.password}@${this.host}:${this.port}/${this.dbName}?tls=true`;
    }

    // Fast path: already connected
    if (MongoDBClient._clientInstance) {
      this.client = MongoDBClient._clientInstance;
      this.db = MongoDBClient._clientInstance.db(this.dbName);
      return;
    }

    // Serialize connection attempts via a shared promise
    if (!MongoDBClient._connectingPromise) {
      MongoDBClient._connectingPromise = this._createConnection(uri, retries, delay);
    }

    const connectPromise = MongoDBClient._connectingPromise;

    try {
      const client = await connectPromise;
      MongoDBClient._clientInstance = client;
      this.client = client;
      this.db = client.db(this.dbName);
    } catch (e) {
      throw e;
    } finally {
      MongoDBClient._connectingPromise = null;
    }
  }

  async close(): Promise<void> {
    if (MongoDBClient._clientInstance) {
      await MongoDBClient._clientInstance.close();
      MongoDBClient._clientInstance = null;
    }
    this.client = null;
    this.db = null;
  }


  private async _createConnection(
    uri: string,
    retries: number,
    delay: number,
  ): Promise<MongoClient> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const client = new MongoClient(uri, {
          serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMs,
          socketTimeoutMS: config.mongo.socketTimeoutMs,
          connectTimeoutMS: config.mongo.connectTimeoutMs,
          maxPoolSize: config.mongo.maxPoolSize,
          minPoolSize: config.mongo.minPoolSize,
          maxIdleTimeMS: config.mongo.maxIdleTimeMs,
          waitQueueTimeoutMS: config.mongo.waitQueueTimeoutMs,
          authSource: "admin",
        });

        await client.db("admin").command({ ping: 1 });

        if (this.verbose) {
          logger.debug(`MongoDB connection established: ${client}`);
          logger.info(`Connected to MongoDB: ${this.dbName}`);
        }
        return client;
      } catch (connErr) {
        logger.warn(
          `Connection attempt ${attempt}/${retries} failed: ${connErr}`,
        );
        if (attempt < retries) {
          logger.info(`Retrying in ${delay} seconds...`);
          await new Promise((r) => setTimeout(r, delay * 1000));
        } else {
          logger.error(
            `Error connecting to MongoDB after ${retries} attempts: ${connErr}`,
          );
          throw connErr;
        }
      }
    }
    throw new Error(`Failed to connect to MongoDB after ${retries} attempts`);
  }

  async createDocument(
    collectionName: string,
    document: Document,
  ): Promise<string> {
    if (!this.db) await this.connect();
    try {
      const collection = this.db!.collection(collectionName);
      const result = await collection.insertOne(document);
      return result.insertedId.toHexString();
    } catch (e) {
      logger.error(
        `Create operation failed:\ncollection: ${collectionName}\ndocument: ${JSON.stringify(document)}\nerror: ${e}`,
      );
      throw e;
    }
  }

  async createDocuments(
    collectionName: string,
    documents: Document[],
  ): Promise<string[]> {
    if (!this.db) await this.connect();
    try {
      const collection = this.db!.collection(collectionName);
      const result = await collection.insertMany(documents);
      if (this.verbose) {
        logger.debug(`Create operation: ${JSON.stringify(result)}`);
        logger.info(
          `Inserted ${Object.values(result.insertedIds).length} document(s) into collection: ${collectionName}`,
        );
      }
      return Object.values(result.insertedIds).map((id) => id.toHexString());
    } catch (e) {
      logger.error(
        `Create operation failed:\ncollection: ${collectionName}\ndocuments: ${JSON.stringify(documents)}\nerror: ${e}`,
      );
      throw e;
    }
  }

  async readDocument(
    collectionName: string,
    query: Record<string, unknown>,
    sort?:
      | [string, 1 | -1][]
      | Record<string, 1 | -1>
      | null,
    projection?: Record<string, unknown> | null,
    limit = 0,
  ): Promise<Document[]> {
    if (!this.db) await this.connect();
    try {
      const collection = this.db!.collection(collectionName);
      const cursor = collection.find(query, {
        projection: projection ?? undefined,
        maxTimeMS: config.mongo.queryMaxTimeMs,
      });
      if (sort) cursor.sort(sort);
      if (limit > 0) cursor.limit(limit);

      const documents = await cursor.toArray();

      if (this.verbose) {
        logger.debug(`Read operation: ${documents.length} docs found`);
        logger.info(
          `Found ${documents.length} document(s) matching query: ${JSON.stringify(query)}, collection: ${collectionName}`,
        );
      }
      return documents;
    } catch (e) {
      logger.error(
        `Read operation failed:\ncollection: ${collectionName}\nquery: ${JSON.stringify(query)}\nsort: ${JSON.stringify(sort)}\nprojection: ${JSON.stringify(projection)}\nlimit: ${limit}\nerror: ${e}`,
      );
      throw e;
    }
  }

  async readAndDecodeDocument(
    collectionName: string,
    query: Record<string, unknown>,
    sort?:
      | [string, 1 | -1][]
      | Record<string, 1 | -1>
      | null,
    projection?: Record<string, unknown> | null,
    limit = 0,
  ): Promise<Document[]> {
    if (!this.db) await this.connect();
    try {
      const documents = await this.readDocument(
        collectionName,
        query,
        sort,
        projection,
        limit,
      );
      for (const document of documents) {
        for (const key of Object.keys(document)) {
          const value = document[key];
          if (
            typeof value === "object" &&
            value !== null &&
            "encrypted_key" in value &&
            "salt" in value
          ) {
            const v = value as Record<string, Buffer>;
            document[key] = decodeSecret(v.encrypted_key, v.salt);
          }
        }
      }
      return documents;
    } catch (e) {
      logger.error(
        `Read and decode operation failed:\ncollection: ${collectionName}\nquery: ${JSON.stringify(query)}\nerror: ${e}`,
      );
      throw e;
    }
  }

  async updateDocument(
    collectionName: string,
    query: Record<string, unknown>,
    updateValues: Record<string, unknown>,
  ): Promise<number> {
    if (!this.db) await this.connect();
    try {
      const collection = this.db!.collection(collectionName);
      const result = await collection.updateMany(query, {
        $set: updateValues,
      });
      if (this.verbose) {
        logger.debug(`Update operation: ${result.modifiedCount} docs modified`);
        logger.info(
          `Modified ${result.modifiedCount} document(s). collection: ${collectionName}`,
        );
      }
      return result.modifiedCount;
    } catch (e) {
      logger.error(
        `Update operation failed:\ncollection: ${collectionName}\nquery: ${JSON.stringify(query)}\nupdate_values: ${JSON.stringify(updateValues)}\nerror: ${e}`,
      );
      throw e;
    }
  }

  async deleteDocument(
    collectionName: string,
    query: Record<string, unknown>,
  ): Promise<number> {
    if (!this.db) await this.connect();
    try {
      const collection = this.db!.collection(collectionName);
      const result = await collection.deleteMany(query);
      if (this.verbose) {
        logger.debug(`Delete operation: ${result.deletedCount} docs deleted`);
        logger.info(
          `Deleted ${result.deletedCount} document(s). collection: ${collectionName}`,
        );
      }
      return result.deletedCount;
    } catch (e) {
      logger.error(
        `Delete operation failed:\ncollection: ${collectionName}\nquery: ${JSON.stringify(query)}\nerror: ${e}`,
      );
      throw e;
    }
  }
}

export async function fetchLabels(
  query?: Record<string, unknown> | null,
): Promise<Document[]> {
  const q = query ?? {};
  const client = new MongoDBClient();
  await client.connect();
  return client.readDocument("labelAddrs", q);
}

export async function getServiceWallet(
  serviceName: string,
  environment: string,
  dbName?: string | null,
): Promise<{ private_key: string; address: string }> {
  const client = new MongoDBClient(
    undefined,
    undefined,
    undefined,
    undefined,
    dbName ?? getenv("MONGO_DB_NAME_PRIVATE"),
  );
  await client.connect();

  const wallets = await client.readAndDecodeDocument("wallets", {
    serviceName: serviceName,
    environment: environment,
    isActive: true,
  });

  if (!wallets.length) {
    throw new Error(
      `No active wallet found for ${serviceName} (${environment}). ` +
        "Please add it to codys-private.wallets first.",
    );
  }

  if (wallets.length > 1) {
    logger.warn(
      `Multiple active wallets found for ${serviceName} (${environment}). ` +
        `Using the first one: ${wallets[0].walletLabel ?? "unknown"}`,
    );
  }

  const walletDoc = wallets[0];
  return {
    private_key: walletDoc.privateKey as string,
    address: walletDoc.address as string,
  };
}

function encryptedApiSecretFromValue(
  value: unknown,
  fieldName: string,
  serviceName: string,
  environment: string,
): EncryptedSecretDocument {
  if (!isRecord(value)) {
    throw new ServiceWalletDataError(
      `Invalid or missing ${fieldName} for API credentials ${serviceName} (${environment}).`,
    );
  }

  const salt = value.salt;
  const encryptedKey = value.encrypted_key;
  if (!isByteValue(salt) || !isByteValue(encryptedKey)) {
    throw new ServiceWalletDataError(
      `Invalid ${fieldName} shape for API credentials ${serviceName} (${environment}).`,
    );
  }

  return { salt, encrypted_key: encryptedKey };
}

function serviceApiCredentialsFromDocument(
  document: Document,
  serviceName: string,
  environment: string,
): ServiceApiCredentials {
  const apiKey = document.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new ServiceWalletDataError(
      `Invalid apiKey for API credentials ${serviceName} (${environment}).`,
    );
  }

  const secretKey = encryptedApiSecretFromValue(
    document.secretKey,
    "secretKey",
    serviceName,
    environment,
  );
  const passphrase = encryptedApiSecretFromValue(
    document.passphrase,
    "passphrase",
    serviceName,
    environment,
  );

  return {
    apiKey,
    secretKey: decodeSecret(
      toBuffer(secretKey.encrypted_key),
      toBuffer(secretKey.salt),
    ),
    passphrase: decodeSecret(
      toBuffer(passphrase.encrypted_key),
      toBuffer(passphrase.salt),
    ),
  };
}

export async function getServiceApiCredentials(
  serviceName: string,
  environment: string,
  dbName?: string | null,
): Promise<ServiceApiCredentials> {
  const client = new MongoDBClient(
    undefined,
    undefined,
    undefined,
    undefined,
    dbName ?? getenv("MONGO_DB_NAME_PRIVATE"),
  );
  await client.connect();

  const documents = await client.readDocument(
    "APIs",
    { serviceName, environment },
    null,
    null,
    2,
  );

  if (!documents.length) {
    throw new ServiceWalletNotFoundError(
      `No API credentials found for ${serviceName} (${environment}). Please add them to codys-private.APIs first.`,
    );
  }

  if (documents.length > 1) {
    throw new ServiceWalletDataError(
      `Multiple API credential documents found for ${serviceName} (${environment}).`,
    );
  }

  return serviceApiCredentialsFromDocument(documents[0], serviceName, environment);
}

function nestedRecord(
  document: Record<string, unknown>,
  path: string[],
  walletLabel: string,
): Record<string, unknown> {
  let current: unknown = document;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      throw new ServiceWalletDataError(
        `Invalid wallet document shape for wallet ${walletLabel}.`,
      );
    }
    current = Object.getOwnPropertyDescriptor(current, key)?.value;
  }

  if (!isRecord(current)) {
    throw new ServiceWalletDataError(
      `Invalid wallet document shape for wallet ${walletLabel}.`,
    );
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isByteValue(value: unknown): value is Buffer | Uint8Array {
  return Buffer.isBuffer(value) || value instanceof Uint8Array;
}

function toBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function encryptedSecretFromValue(
  value: unknown,
  walletLabel: string,
): EncryptedSecretDocument {
  if (!isRecord(value)) {
    throw new ServiceWalletDataError(
      `Invalid or missing EVM privateKey for wallet ${walletLabel}.`,
    );
  }

  const salt = value.salt;
  const encryptedKey = value.encrypted_key;
  if (!isByteValue(salt) || !isByteValue(encryptedKey)) {
    throw new ServiceWalletDataError(
      `Invalid EVM privateKey shape for wallet ${walletLabel}.`,
    );
  }

  return { salt, encrypted_key: encryptedKey };
}

function serviceEvmWalletFromDocument(
  document: Document,
  exchange: string,
  serviceName: string,
  environment: string,
): ServiceEvmWallet {
  const walletLabelValue = document.walletLabel;
  if (typeof walletLabelValue !== "string") {
    throw new ServiceWalletDataError(
      `Invalid walletLabel for ${serviceName} (${environment}).`,
    );
  }
  const walletLabel = walletLabelValue;

  const evmWallet = nestedRecord(document, ["wallets", "evm"], walletLabel);
  const address = evmWallet.address;
  if (typeof address !== "string") {
    throw new ServiceWalletDataError(
      `Invalid or missing EVM address for wallet ${walletLabel}.`,
    );
  }

  const privateKey = encryptedSecretFromValue(evmWallet.privateKey, walletLabel);
  const exchangeDeposits = nestedRecord(
    document,
    ["exchangeDeposits", exchange],
    walletLabel,
  );
  const exchangeDepositAddress = exchangeDeposits.evm;
  if (typeof exchangeDepositAddress !== "string") {
    throw new ServiceWalletDataError(
      `Invalid or missing ${exchange} EVM target for wallet ${walletLabel}.`,
    );
  }

  return {
    walletLabel,
    address,
    privateKey: decodeSecret(
      toBuffer(privateKey.encrypted_key),
      toBuffer(privateKey.salt),
    ),
    exchangeDepositAddress,
  };
}

export async function getServiceEvmWallets(
  serviceName: string,
  environment: string,
  exchange: string,
): Promise<ServiceEvmWallet[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(exchange)) {
    throw new ServiceWalletDataError(
      "exchange must contain only letters, numbers, underscores, or hyphens",
    );
  }

  const client = new MongoDBClient(
    undefined,
    undefined,
    undefined,
    undefined,
    getenv("MONGO_DB_NAME_PRIVATE"),
  );
  await client.connect();

  const documents = await client.readDocument(
    "wallets",
    {
      documentType: "walletAccount",
      serviceName,
      environment,
      isActive: true,
      "wallets.evm.privateKey": { $exists: true },
      [`exchangeDeposits.${exchange}.evm`]: { $exists: true },
    },
    { walletLabel: 1 },
  );

  if (!documents.length) {
    throw new ServiceWalletNotFoundError(
      `No active ${serviceName} EVM wallets found for exchange=${exchange}, ` +
        `environment=${environment}. Please add them to codys-private.wallets first.`,
    );
  }

  return documents.map((document) =>
    serviceEvmWalletFromDocument(document, exchange, serviceName, environment),
  );
}
