function _getenv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

export class HTTPConfig {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  retryBackoffFactor: number;
  maxRetryDelay: number;
  connectionPoolSize: number;
  curlImpersonate: string;

  constructor(overrides?: Partial<HTTPConfig>) {
    this.timeout =
      overrides?.timeout ??
      parseInt(_getenv("EXCHANGE_TIMEOUT", "15")!, 10);
    this.maxRetries =
      overrides?.maxRetries ??
      parseInt(_getenv("EXCHANGE_MAX_RETRIES", "3")!, 10);
    this.retryDelay =
      overrides?.retryDelay ??
      parseFloat(_getenv("EXCHANGE_RETRY_DELAY", "1.0")!);
    this.retryBackoffFactor =
      overrides?.retryBackoffFactor ??
      parseFloat(_getenv("EXCHANGE_RETRY_BACKOFF", "2.0")!);
    this.maxRetryDelay =
      overrides?.maxRetryDelay ??
      parseFloat(_getenv("EXCHANGE_MAX_RETRY_DELAY", "10.0")!);
    this.connectionPoolSize =
      overrides?.connectionPoolSize ??
      parseInt(_getenv("EXCHANGE_POOL_SIZE", "100")!, 10);
    this.curlImpersonate =
      overrides?.curlImpersonate ??
      _getenv("EXCHANGE_CURL_IMPERSONATE", "chrome120")!;
  }
}

export class MongoConfig {
  maxRetries: number;
  retryDelay: number;
  serverSelectionTimeoutMs: number;
  socketTimeoutMs: number;
  connectTimeoutMs: number;
  maxPoolSize: number;
  minPoolSize: number;
  maxIdleTimeMs: number;
  waitQueueTimeoutMs: number;
  queryMaxTimeMs: number;

  constructor(overrides?: Partial<MongoConfig>) {
    this.maxRetries =
      overrides?.maxRetries ??
      parseInt(_getenv("MONGO_MAX_RETRIES", "5")!, 10);
    this.retryDelay =
      overrides?.retryDelay ??
      parseInt(_getenv("MONGO_RETRY_DELAY", "5")!, 10);
    this.serverSelectionTimeoutMs =
      overrides?.serverSelectionTimeoutMs ??
      parseInt(_getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000")!, 10);
    this.socketTimeoutMs =
      overrides?.socketTimeoutMs ??
      parseInt(_getenv("MONGO_SOCKET_TIMEOUT_MS", "30000")!, 10);
    this.connectTimeoutMs =
      overrides?.connectTimeoutMs ??
      parseInt(_getenv("MONGO_CONNECT_TIMEOUT_MS", "10000")!, 10);
    this.maxPoolSize =
      overrides?.maxPoolSize ??
      parseInt(_getenv("MONGO_MAX_POOL_SIZE", "100")!, 10);
    this.minPoolSize =
      overrides?.minPoolSize ??
      parseInt(_getenv("MONGO_MIN_POOL_SIZE", "10")!, 10);
    this.maxIdleTimeMs =
      overrides?.maxIdleTimeMs ??
      parseInt(_getenv("MONGO_MAX_IDLE_TIME_MS", "600000")!, 10);
    this.waitQueueTimeoutMs =
      overrides?.waitQueueTimeoutMs ??
      parseInt(_getenv("MONGO_WAIT_QUEUE_TIMEOUT_MS", "5000")!, 10);
    this.queryMaxTimeMs =
      overrides?.queryMaxTimeMs ??
      parseInt(_getenv("MONGO_QUERY_MAX_TIME_MS", "30000")!, 10);
  }
}

export class RateLimitConfig {
  publicCapacity: number;
  publicRefillPeriod: number;
  publicRefillAmount: number;
  privateCapacity: number;
  privateRefillPeriod: number;
  privateRefillAmount: number;
  waitOnLimit: boolean;

  constructor(overrides?: Partial<RateLimitConfig>) {
    this.publicCapacity =
      overrides?.publicCapacity ??
      parseInt(_getenv("RATE_LIMIT_PUBLIC_CAPACITY", "6000")!, 10);
    this.publicRefillPeriod =
      overrides?.publicRefillPeriod ??
      parseInt(_getenv("RATE_LIMIT_PUBLIC_REFILL_PERIOD", "60")!, 10);
    this.publicRefillAmount =
      overrides?.publicRefillAmount ??
      parseInt(_getenv("RATE_LIMIT_PUBLIC_REFILL_AMOUNT", "6000")!, 10);
    this.privateCapacity =
      overrides?.privateCapacity ??
      parseInt(_getenv("RATE_LIMIT_PRIVATE_CAPACITY", "6000")!, 10);
    this.privateRefillPeriod =
      overrides?.privateRefillPeriod ??
      parseInt(_getenv("RATE_LIMIT_PRIVATE_REFILL_PERIOD", "60")!, 10);
    this.privateRefillAmount =
      overrides?.privateRefillAmount ??
      parseInt(_getenv("RATE_LIMIT_PRIVATE_REFILL_AMOUNT", "6000")!, 10);
    this.waitOnLimit =
      overrides?.waitOnLimit ??
      _getenv("RATE_LIMIT_WAIT_ON_LIMIT", "true")!.toLowerCase() === "true";
  }
}

export class Web3Config {
  providerTimeout: number;
  batchRequestSize: number;
  batchRequestDelay: number;
  maxGasPriceGwei: number;
  confirmationBlocks: number;

  constructor(overrides?: Partial<Web3Config>) {
    this.providerTimeout =
      overrides?.providerTimeout ??
      parseInt(_getenv("WEB3_PROVIDER_TIMEOUT", "15")!, 10);
    this.batchRequestSize =
      overrides?.batchRequestSize ??
      parseInt(_getenv("WEB3_BATCH_SIZE", "10")!, 10);
    this.batchRequestDelay =
      overrides?.batchRequestDelay ??
      parseInt(_getenv("WEB3_BATCH_DELAY", "1")!, 10);
    this.maxGasPriceGwei =
      overrides?.maxGasPriceGwei ??
      parseInt(_getenv("WEB3_MAX_GAS_PRICE_GWEI", "500")!, 10);
    this.confirmationBlocks =
      overrides?.confirmationBlocks ??
      parseInt(_getenv("WEB3_CONFIRMATION_BLOCKS", "1")!, 10);
  }
}

export class ExchangeDefaults {
  dbName: string;
  dbEnvironment: string;
  dbAccountType: string;
  delay: number;
  verbose: boolean;
  proxy: boolean;

  constructor(overrides?: Partial<ExchangeDefaults>) {
    this.dbName =
      overrides?.dbName ?? _getenv("EXCHANGE_DB_NAME", "codys-private")!;
    this.dbEnvironment =
      overrides?.dbEnvironment ?? _getenv("EXCHANGE_DB_ENVIRONMENT", "prod")!;
    this.dbAccountType =
      overrides?.dbAccountType ?? _getenv("EXCHANGE_DB_ACCOUNT_TYPE", "main")!;
    this.delay =
      overrides?.delay ?? parseFloat(_getenv("EXCHANGE_DELAY", "0.5")!);
    this.verbose =
      overrides?.verbose ??
      _getenv("EXCHANGE_VERBOSE", "false")!.toLowerCase() === "true";
    this.proxy =
      overrides?.proxy ??
      _getenv("EXCHANGE_PROXY", "false")!.toLowerCase() === "true";
  }
}

export class Config {
  http: HTTPConfig;
  mongo: MongoConfig;
  rateLimit: RateLimitConfig;
  web3: Web3Config;
  exchangeDefaults: ExchangeDefaults;

  constructor(
    http?: HTTPConfig,
    mongo?: MongoConfig,
    rateLimit?: RateLimitConfig,
    web3?: Web3Config,
    exchangeDefaults?: ExchangeDefaults
  ) {
    this.http = http ?? new HTTPConfig();
    this.mongo = mongo ?? new MongoConfig();
    this.rateLimit = rateLimit ?? new RateLimitConfig();
    this.web3 = web3 ?? new Web3Config();
    this.exchangeDefaults = exchangeDefaults ?? new ExchangeDefaults();
  }

  reload(): void {
    this.http = new HTTPConfig();
    this.mongo = new MongoConfig();
    this.rateLimit = new RateLimitConfig();
    this.web3 = new Web3Config();
    this.exchangeDefaults = new ExchangeDefaults();
  }
}

export const config = new Config();
