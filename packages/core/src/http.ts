/**
 * Centralized HTTP session management for my_exchanges library.
 *
 * Provides singleton session managers with connection pooling,
 * proper lifecycle management, and configuration integration.
 * Native fetch is used for now, with a seam for TLS impersonation later.
 */

import { Agent } from "undici";
import { logger } from "./logger.js";
import { config } from "./config.js";

export class SessionManager {
  private static _agent: Agent | null = null;
  private static _connectingPromise: Promise<Agent> | null = null;

  /**
   * Returns the shared undici Agent with connection pooling.
   *
   * @param poolSize - Connection pool size (defaults to config.http.connectionPoolSize)
   * @returns Configured undici Agent instance
   */
  static async getAgent(poolSize?: number): Promise<Agent> {
    if (SessionManager._agent) {
      return SessionManager._agent;
    }

    if (!SessionManager._connectingPromise) {
      SessionManager._connectingPromise = SessionManager._createAgent(poolSize);
    }

    try {
      const agent = await SessionManager._connectingPromise;
      SessionManager._agent = agent;
      return agent;
    } finally {
      SessionManager._connectingPromise = null;
    }
  }

  private static async _createAgent(poolSize?: number): Promise<Agent> {
    const size = poolSize ?? config.http.connectionPoolSize;

    const agent = new Agent({
      connect: {
        rejectUnauthorized: true,
      },
      connections: size,
      keepAliveTimeout: 30000,
      keepAliveMaxTimeout: 60000,
    });

    logger.debug(`Initialized shared undici Agent (pool=${size})`);
    return agent;
  }

  /**
   * Closes all shared sessions.
   *
   * Should be called on application shutdown to ensure proper
   * cleanup of connection pools and prevent resource leaks.
   */
  static async closeAll(): Promise<void> {
    if (SessionManager._agent) {
      await SessionManager._agent.close();
      SessionManager._agent = null;
      logger.info("Closed shared undici Agent");
    }
  }

  /**
   * Reset and recreate the agent.
   *
   * Useful when session state becomes corrupted or after errors.
   *
   * @param poolSize - Connection pool size
   * @returns New undici Agent instance
   */
  static async resetAgent(poolSize?: number): Promise<Agent> {
    await SessionManager.closeAll();
    return SessionManager.getAgent(poolSize);
  }
}

/** Backward-compatible singleton-like access */
export const httpSessionMgr = SessionManager;
