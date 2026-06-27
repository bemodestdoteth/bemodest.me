import { logger } from "./logger.js";

const _MISSING = Symbol("_MISSING");

class KeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}

class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

export function getenv(key: string): string;
export function getenv(key: string, defaultValue: string): string;
export function getenv(key: string, defaultValue: null): string | null;
export function getenv(
  key: string,
  defaultValue?: string | null | typeof _MISSING,
): string | null | undefined {
  if (typeof key !== "string") {
    throw new TypeError("Key must be a string.");
  }
  if (key !== key.toUpperCase()) {
    throw new ValueError("Key must be uppercase.");
  }

  try {
    if (defaultValue === undefined || defaultValue === _MISSING) {
      const value = process.env[key];
      if (value === undefined) {
        throw new KeyError(`Environment variable '${key}' not found.`);
      }
      return value;
    }
    return process.env[key] ?? defaultValue ?? undefined;
  } catch (e) {
    if (e instanceof KeyError) {
      throw e;
    }
    throw new Error(`Unknown error: ${e}`);
  }
}

export function* chunks<T>(elements: Iterable<T>, n: number): Generator<T[]> {
  if (n <= 0) {
    return;
  }
  const it = elements[Symbol.iterator]();
  while (true) {
    const chunk: T[] = [];
    for (let i = 0; i < n; i++) {
      const next = it.next();
      if (next.done) {
        if (chunk.length === 0) return;
        yield chunk;
        return;
      }
      chunk.push(next.value);
    }
    yield chunk;
  }
}

export function findTextBetweenParentheses(text: string): string {
  return (text.match(/\(([A-Z0-9\s]+)\)/g) || [])
    .map((m) => m.slice(1, -1))
    .join("");
}

export function retry<T extends (...args: any[]) => Promise<any>>(
  func: T
): T {
  return (async (...args: any[]) => {
    let retries = 0;
    while (retries <= 5) {
      try {
        return await func(...args);
      } catch (e) {
        logger.error(`Error | ${e}`);
        await wait(Math.floor(Math.random() * 11) + 20);
        retries += 1;
      }
    }
    throw new Error(`Max retries exceeded for ${func.name}`);
  }) as T;
}

export async function wait(_time: number): Promise<void> {
  for (let i = 0; i < _time; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export function waitSync(_time: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, _time * 1000);
}

export function asyncCachedProperty(
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.get;
  const cache = new WeakMap<object, Promise<any>>();
  descriptor.get = function (this: object): Promise<any> {
    if (!cache.has(this)) {
      cache.set(this, Promise.resolve(originalMethod!.call(this)));
    }
    return cache.get(this)!;
  };
  return descriptor;
}
