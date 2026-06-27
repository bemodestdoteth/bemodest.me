/**
 * Logging infrastructure for my_exchanges library.
 *
 * Provides standardized pino configuration with file rotation,
 * console output, and intercept handler for standard library logging.
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { PathLike } from "node:fs";
import path from "node:path";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import pino, { Logger } from "pino";

export type LoggingLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LOG_DIR: PathLike = "log";

function _getenv(key: string, defaultValue: string = ""): string {
  return process.env[key] ?? defaultValue;
}

function getRotationInterval(tz: string | undefined): number {
  // Calculate milliseconds until next midnight in the given timezone
  const now = new Date();
  const tzOffset = tz ? getTimezoneOffset(now, tz) : 0;
  const localNow = new Date(now.getTime() + tzOffset);
  const nextMidnight = new Date(localNow);
  nextMidnight.setHours(24, 0, 0, 0);
  return nextMidnight.getTime() - localNow.getTime();
}

function getTimezoneOffset(date: Date, timeZone: string): number {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return utcDate.getTime() - tzDate.getTime();
}

/**
 * Intercepts standard library console logging and routes to pino.
 * Equivalent to Python's InterceptHandler for logging.Handler.
 */
export class InterceptHandler {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  private mapLevel(level: string): LoggingLevel {
    switch (level) {
      case "error":
        return "error";
      case "warn":
        return "warn";
      case "info":
        return "info";
      case "debug":
        return "debug";
      default:
        return "info";
    }
  }

  intercept(): void {
    const originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug,
    };

    console.log = (...args: unknown[]) => {
      this.logger.info(this.formatArgs(args));
    };
    console.error = (...args: unknown[]) => {
      this.logger.error(this.formatArgs(args));
    };
    console.warn = (...args: unknown[]) => {
      this.logger.warn(this.formatArgs(args));
    };
    console.info = (...args: unknown[]) => {
      this.logger.info(this.formatArgs(args));
    };
    console.debug = (...args: unknown[]) => {
      this.logger.debug(this.formatArgs(args));
    };

    // Store originals for restoration if needed
    (this as unknown as Record<string, unknown>)["__originalConsole"] = originalConsole;
  }

  private formatArgs(args: unknown[]): string {
    return args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
  }
}

let _logger: Logger | null = null;

/**
 * Initialize pino with file rotation and console output.
 *
 * @param logDir - Directory for log files
 * @param level - Minimum logging level
 */
export function setupLogger(logDir: PathLike = LOG_DIR, level: LoggingLevel = "debug"): void {
  mkdirSync(logDir, { recursive: true });

  const tz = _getenv("TZ", "UTC");

  const fileStream = createWriteStream(path.join(String(logDir), `${new Date().toISOString().split("T")[0]}.log`), {
    flags: "a",
  });

  // Use rotating-file-stream for daily rotation
  const rotatingStream = createStream(
    (time: Date | number, index?: number) => {
      const date = time instanceof Date ? time : new Date(time);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(date.getMonth() + 1)}.${pad(date.getDate())}.${date.getFullYear()}.log`;
    },
    {
      path: String(logDir),
      interval: "1d",
      maxFiles: 6,
    }
  );

  _logger = pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label: string) => ({ level: label.toUpperCase() }),
      },
    },
    pino.multistream([
      { stream: process.stdout, level },
      { stream: rotatingStream as unknown as NodeJS.WritableStream, level },
    ])
  );

  // Intercept console methods
  const interceptHandler = new InterceptHandler(_logger);
  interceptHandler.intercept();
}

/**
 * Global logger singleton.
 * Returns a pino Logger instance. If setupLogger has not been called,
 * returns a default pino logger.
 */
export function getLogger(): Logger {
  if (_logger === null) {
    _logger = pino({
      level: "debug",
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return _logger;
}

// Default export for direct import
export const logger: Logger = getLogger();

export const __all__ = ["logger", "setupLogger", "LoggingLevel", "InterceptHandler"];
