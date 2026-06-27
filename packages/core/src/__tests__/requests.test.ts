import { describe, it, expect, vi } from "vitest";
import {
  TokenBucket,
  randomUserAgent,
  setupRequestProxy,
  requestWithRetry,
  graphqlRequestWithRetry,
  getExchangeRate,
} from "../requests.js";

describe("requests", () => {
  it("TokenBucket consume works", () => {
    const bucket = new TokenBucket(10, 60, 10);
    expect(bucket.consume(5)).toBe(true);
    expect(bucket.tokens).toBeLessThanOrEqual(10);
  });

  it("TokenBucket consume fails when empty", () => {
    const bucket = new TokenBucket(1, 60, 1);
    expect(bucket.consume(1)).toBe(true);
    expect(bucket.consume(1)).toBe(false);
  });

  it("TokenBucket throws on over-capacity request", () => {
    const bucket = new TokenBucket(1, 60, 1);
    expect(() => bucket.consume(2)).toThrow("exceeds bucket capacity");
  });

  it("TokenBucket toString", () => {
    const bucket = new TokenBucket(10, 60, 10);
    expect(bucket.toString()).toContain("TokenBucket");
  });

  it("setupRequestProxy", () => {
    const proxy = setupRequestProxy("http://proxy:8080");
    expect(proxy).toEqual({ http: "http://proxy:8080", https: "http://proxy:8080" });
  });

  it("randomUserAgent returns string", () => {
    const ua = randomUserAgent();
    expect(typeof ua).toBe("string");
    expect(ua.length).toBeGreaterThan(0);
  });

  it("requestWithRetry retries on failure and succeeds", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ data: "ok" }),
      } as Response);

    const result = await requestWithRetry("https://example.com", 2, 0.01);
    expect(result).toEqual({ data: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requestWithRetry respects non-retry status codes", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    fetchMock.mockResolvedValue({
      status: 404,
      json: async () => ({ error: "not found" }),
    } as Response);

    await expect(
      requestWithRetry("https://example.com", 2, 0.01, true, false, new Set([500]))
    ).rejects.toThrow("404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("graphqlRequestWithRetry retries on GraphQL errors", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ errors: [{ message: "bad" }] }),
      } as Response)
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({ data: { ok: true } }),
      } as Response);

    const result = await graphqlRequestWithRetry(
      "https://example.com/graphql",
      "{ ok }",
      null,
      2,
      0.01
    );
    expect(result).toEqual({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getExchangeRate parses fetch response", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => [{ basePrice: "1300.5" }],
    } as Response);

    const rate = await getExchangeRate();
    expect(rate).toBe(1300.5);
  });
});
