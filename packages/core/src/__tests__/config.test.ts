import { describe, it, expect } from "vitest";
import {
  Config,
  HTTPConfig,
  MongoConfig,
  RateLimitConfig,
  Web3Config,
  ExchangeDefaults,
  config,
} from "../config.js";

describe("config", () => {
  it("HTTPConfig has defaults", () => {
    const c = new HTTPConfig();
    expect(c.timeout).toBe(15);
    expect(c.maxRetries).toBe(3);
    expect(c.retryDelay).toBe(1.0);
    expect(c.retryBackoffFactor).toBe(2.0);
    expect(c.maxRetryDelay).toBe(10.0);
    expect(c.connectionPoolSize).toBe(100);
    expect(c.curlImpersonate).toBe("chrome120");
  });

  it("MongoConfig has defaults", () => {
    const c = new MongoConfig();
    expect(c.maxRetries).toBe(5);
    expect(c.retryDelay).toBe(5);
    expect(c.serverSelectionTimeoutMs).toBe(5000);
    expect(c.socketTimeoutMs).toBe(30000);
    expect(c.connectTimeoutMs).toBe(10000);
    expect(c.maxPoolSize).toBe(100);
    expect(c.minPoolSize).toBe(10);
    expect(c.maxIdleTimeMs).toBe(600000);
    expect(c.waitQueueTimeoutMs).toBe(5000);
    expect(c.queryMaxTimeMs).toBe(30000);
  });

  it("RateLimitConfig has defaults", () => {
    const c = new RateLimitConfig();
    expect(c.publicCapacity).toBe(6000);
    expect(c.publicRefillPeriod).toBe(60);
    expect(c.publicRefillAmount).toBe(6000);
    expect(c.privateCapacity).toBe(6000);
    expect(c.privateRefillPeriod).toBe(60);
    expect(c.privateRefillAmount).toBe(6000);
    expect(c.waitOnLimit).toBe(true);
  });

  it("Web3Config has defaults", () => {
    const c = new Web3Config();
    expect(c.providerTimeout).toBe(15);
    expect(c.batchRequestSize).toBe(10);
    expect(c.batchRequestDelay).toBe(1);
    expect(c.maxGasPriceGwei).toBe(500);
    expect(c.confirmationBlocks).toBe(1);
  });

  it("ExchangeDefaults has defaults", () => {
    const c = new ExchangeDefaults();
    expect(c.dbName).toBe("codys-private");
    expect(c.dbEnvironment).toBe("prod");
    expect(c.dbAccountType).toBe("main");
    expect(c.delay).toBe(0.5);
    expect(c.verbose).toBe(false);
    expect(c.proxy).toBe(false);
  });

  it("Config reload works", () => {
    const c = new Config();
    c.reload();
    expect(c.http.timeout).toBe(15);
  });

  it("global config exists", () => {
    expect(config).toBeInstanceOf(Config);
  });
});
