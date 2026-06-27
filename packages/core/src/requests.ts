/**
 * HTTP request utilities with retry logic for my_exchanges library.
 *
 * Provides rate limiting (TokenBucket), encryption helpers, and retry-enabled
 * HTTP request functions using native fetch.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import UserAgents from "user-agents";
import { logger } from "./logger.js";
import { getenv } from "./tasks.js";

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export class TokenBucket {
  capacity: number;
  private _tokens: number;
  refillPeriod: number;
  refillAmount: number;
  private lastRefillTime: number;
  verbose: boolean;

  constructor(
    capacity: number,
    refillPeriod: number,
    refillAmount?: number,
    verbose = false
  ) {
    this.capacity = capacity;
    this._tokens = capacity;
    this.refillPeriod = refillPeriod;
    this.refillAmount = refillAmount ?? capacity;
    this.lastRefillTime = Date.now();
    this.verbose = verbose;
  }

  consume(tokens: number): boolean {
    if (tokens > this.capacity) {
      throw new Error("Tokens requested exceeds bucket capacity");
    }
    if (tokens > this.tokens) {
      return false;
    }
    this.tokens -= tokens;
    if (this.verbose) {
      console.log(
        `Consumed ${tokens} tokens from bucket. ${this.tokens} tokens remaining.`
      );
    }
    return true;
  }

  refill(): void {
    const now = Date.now();
    if (now - this.lastRefillTime >= this.refillPeriod * 1000) {
      this.tokens = Math.min(this.capacity, this._tokens + this.refillAmount);
      this.lastRefillTime = now;
      if (this.verbose) {
        console.log(`Refilled bucket to capacity. ${this.tokens} tokens available.`);
      }
    }
  }

  toString(): string {
    return `TokenBucket(capacity=${this.capacity}, fill_rate=${this.refillPeriod} seconds, tokens=${this.tokens})`;
  }

  get tokens(): number {
    this.refill();
    return this._tokens;
  }

  set tokens(value: number) {
    this._tokens = value;
  }
}

export function randomUserAgent(): string {
  return new UserAgents().toString();
}

export function randomProxy(proxyFilePath: string): string {
  const proxies = fs.readFileSync(proxyFilePath, "utf-8").split(/\r?\n/).filter((l) => l.trim() !== "");
  return proxies[Math.floor(Math.random() * proxies.length)];
}

export function setupRequestProxy(proxy: string): Record<string, string> {
  return { http: proxy, https: proxy };
}

export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  try {
    return crypto.pbkdf2Sync(passphrase, salt, 100000, 32, "sha256");
  } catch (e: any) {
    throw new Error(`Error deriving key: ${e.message}`);
  }
}

function _fernetEncrypt(plainText: string, key: Buffer): Buffer {
  const signingKey = key.slice(0, 16);
  const encryptionKey = key.slice(16, 32);

  const version = Buffer.from([0x80]);
  const timestamp = Buffer.allocUnsafe(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);

  const payload = Buffer.concat([version, timestamp, iv, encrypted]);
  const hmac = crypto.createHmac("sha256", signingKey).update(payload).digest();

  return Buffer.concat([payload, hmac]);
}

function _fernetDecrypt(token: Buffer, key: Buffer): string {
  const signingKey = key.slice(0, 16);
  const encryptionKey = key.slice(16, 32);

  if (token.length < 57) {
    throw new Error("Invalid token: too short");
  }

  const version = token[0];
  if (version !== 0x80) {
    throw new Error(`Invalid token version: ${version}`);
  }

  const hmacOffset = token.length - 32;
  const payload = token.slice(0, hmacOffset);
  const hmac = token.slice(hmacOffset);

  const expectedHmac = crypto.createHmac("sha256", signingKey).update(payload).digest();
  if (!crypto.timingSafeEqual(hmac, expectedHmac)) {
    throw new Error("Invalid token. The passphrase or encrypted key may be incorrect.");
  }

  const iv = token.slice(9, 25);
  const encrypted = token.slice(25, hmacOffset);

  const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}

export function encodeSecret(secretKey: string, passphrase?: string): { salt: Buffer; encryptedKey: Buffer } {
  try {
    if (!passphrase) {
      passphrase = getenv("DB_PASSPHRASE");
    }

    const salt = crypto.randomBytes(16);
    const key = deriveKey(passphrase!, salt);

    const encryptedKey = _fernetEncrypt(secretKey, key);

    return { salt, encryptedKey };
  } catch (e: any) {
    throw new Error(`Error encoding secret key: ${e.message}`);
  }
}

export function decodeSecret(encryptedSecret: Buffer, salt: Buffer, passphrase?: string): string {
  try {
    if (!passphrase) {
      passphrase = getenv("DB_PASSPHRASE");
    }

    const key = deriveKey(passphrase!, salt);
    return _fernetDecrypt(encryptedSecret, key);
  } catch (e: any) {
    if (e.message?.includes("Invalid token")) {
      throw e;
    }
    throw new Error(`Error decoding secret key: ${e.message}`);
  }
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 10, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout * 1000);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function getExchangeRate(): Promise<number> {
  try {
    const response = await Promise.race([
      fetchWithTimeout(
        "https://crix-api-cdn.upbit.com/v1/forex/recent?codes=FRX.KRWUSD",
        { timeout: 10 }
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Exchange rate fetch timed out after 120s")), 120_000)
      ),
    ]);
    const jsonResp = await response.json() as Array<{ basePrice: string }>;
    return parseFloat(jsonResp[0].basePrice);
  } catch (e: any) {
    throw new Error(`Failed to get exchange rate: ${e.message}`);
  }
}

export async function requestWithRetry(
  url: string,
  retries = 5,
  backoffFactor = 1.0,
  retryOnError = true,
  verbose = false,
  retryStatusCodes: Set<number> | null = null
): Promise<any> {
  if (retryStatusCodes === null) {
    retryStatusCodes = new Set([403, 500, 502, 503, 504]);
  }

  if (retries < -1) {
    throw new Error("retries cannot be less than -1");
  }

  const maxAttempts = retries === -1 ? Infinity : retries + 1;

  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      if (verbose) {
        logger.info(
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}`
        );
      }

      const response = await fetchWithTimeout(url, { timeout: 10 });

      if (response.status < 400) {
        if (verbose) {
          logger.info(`Successfully fetched data from ${url}.`);
        }
        return await response.json();
      }

      let shouldRetry = false;

      if (retryStatusCodes !== null) {
        shouldRetry = retryStatusCodes.has(response.status);
      } else {
        if (response.status >= 500 && response.status < 600) {
          shouldRetry = true;
        } else if (retryOnError) {
          shouldRetry = true;
        }
      }

      if (shouldRetry) {
        logger.warn(
          `HTTP ${response.status} for ${url}. ` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      } else {
        logger.error(`HTTP ${response.status} for ${url}. Not retrying.`);
        throw new NonRetryableError(`${response.status} ${response}, url: ${url}`);
      }
    } catch (e: any) {
      if (e instanceof NonRetryableError) {
        throw e;
      }
      if (e.name === "AbortError") {
        logger.warn(
          `AbortError for ${url}. ` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      } else {
        logger.warn(
          `${e.constructor.name} for ${url}. ` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      }
    }

    if (attempt < maxAttempts) {
      const sleepTime = backoffFactor * 2 ** (attempt - 1);
      logger.info(`Waiting ${sleepTime.toFixed(2)}s before next retry.`);
      await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
    }
  }

  throw new Error(`Failed to fetch data from ${url} after ${attempt} attempts.`);
}

export async function graphqlRequestWithRetry(
  url: string,
  query: string,
  variables?: Record<string, unknown> | null,
  retries = -1,
  backoffFactor = 1.0,
  retryOnError = true,
  verbose = false,
  retryStatusCodes: Set<number> | null = null,
  ...kwargs: any[]
): Promise<any> {
  if (retryStatusCodes === null) {
    retryStatusCodes = new Set([403, 500, 502, 503, 504]);
  }

  if (retries < -1) {
    throw new Error("retries cannot be less than -1");
  }

  const payload: Record<string, any> = { query };
  if (variables) {
    payload.variables = variables;
  }

  const headers: Record<string, string> = (kwargs as any).headers ?? {};
  headers["Content-Type"] = "application/json";

  const maxAttempts = retries === -1 ? Infinity : retries + 1;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      if (verbose) {
        logger.info(
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}`
        );
      }

      const response = await fetchWithTimeout(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers,
        timeout: (kwargs as any).timeout ?? 10,
      });

      if (response.status < 400) {
        const jsonResponse = (await response.json()) as Record<string, any>;
        if (jsonResponse.errors) {
          const errorMessage = `GraphQL query failed with errors: ${JSON.stringify(jsonResponse.errors)}`;
          logger.error(errorMessage);
          throw new Error(errorMessage);
        }

        if (verbose) {
          logger.info(`Successfully sent GraphQL request to ${url}.`);
        }
        return jsonResponse;
      }

      let shouldRetry = false;
      if (retryStatusCodes !== null) {
        shouldRetry = retryStatusCodes.has(response.status);
      } else {
        if (response.status >= 500 && response.status < 600) {
          shouldRetry = true;
        } else if (retryOnError) {
          shouldRetry = true;
        }
      }

      if (shouldRetry) {
        logger.warn(
          `HTTP ${response.status} for ${url}. ` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      } else {
        logger.error(`HTTP ${response.status} for ${url}. Not retrying.`);
        throw new NonRetryableError(`${response.status} ${await response.text()}, url: ${url}`);
      }
    } catch (e: any) {
      if (e instanceof NonRetryableError) {
        throw e;
      }
      if (e.name === "AbortError") {
        logger.warn(
          `AbortError for ${url}: ${e.message}` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      } else {
        logger.warn(
          `${e.constructor.name} for ${url}: ${e.message}` +
          `Attempt ${attempt} of ${retries === -1 ? "infinity" : maxAttempts}. Retrying...`
        );
      }
    }

    if (attempt < maxAttempts) {
      const sleepTime = backoffFactor * 2 ** (attempt - 1);
      logger.info(`Waiting ${sleepTime.toFixed(2)}s before next retry.`);
      await new Promise((resolve) => setTimeout(resolve, sleepTime * 1000));
    }
  }

  throw new Error(`Failed to fetch data from ${url} after ${attempt} attempts.`);
}

export const __all__ = [
  "TokenBucket",
  "randomUserAgent",
  "randomProxy",
  "setupRequestProxy",
  "deriveKey",
  "encodeSecret",
  "decodeSecret",
  "getExchangeRate",
  "requestWithRetry",
  "graphqlRequestWithRetry",
];
