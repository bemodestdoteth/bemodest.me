/** Redis client for my_exchanges library.
 *
 * Provides a singleton ioredis client configured from environment variables.
 */

import { Redis } from "ioredis";
import { logger } from "./logger.js";
import { getenv } from "./tasks.js";

let _redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (_redisClient === null) {
    const host = getenv("REDIS_HOST", "localhost");
    const port = parseInt(getenv("REDIS_PORT", "6379"), 10);
    const password = getenv("REDIS_PASSWORD", null);

    logger.info(
      `Initializing Redis client at ${host}:${port} (Password: ${password ? "Set" : "Not Set"})`,
    );

    _redisClient = new Redis({
      host,
      port,
      password: password ?? undefined,
      // Keep raw buffers for stream compatibility if needed
      // ioredis returns strings by default; set reply transformers if needed
    });
  }
  return _redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (_redisClient !== null) {
    await _redisClient.quit();
    _redisClient = null;
  }
}
