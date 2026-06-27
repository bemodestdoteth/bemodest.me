import { describe, it, expect } from "vitest";
import {
  getenv,
  chunks,
  findTextBetweenParentheses,
  retry,
  wait,
  waitSync,
} from "../tasks.js";

describe("tasks", () => {
  it("getenv returns existing var", () => {
    process.env.TEST_VAR = "hello";
    expect(getenv("TEST_VAR")).toBe("hello");
    delete process.env.TEST_VAR;
  });

  it("getenv throws on missing var without default", () => {
    expect(() => getenv("MISSING_VAR_XYZ")).toThrow("not found");
  });

  it("getenv returns default on missing var", () => {
    expect(getenv("MISSING_VAR_XYZ", "default")).toBe("default");
  });

  it("getenv validates uppercase", () => {
    expect(() => getenv("lowercase")).toThrow("uppercase");
  });

  it("getenv validates string key", () => {
    expect(() => getenv(123 as unknown as string)).toThrow("string");
  });

  it("chunks splits iterable", () => {
    const result = [...chunks([1, 2, 3, 4, 5], 2)];
    expect(result).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("findTextBetweenParentheses", () => {
    expect(findTextBetweenParentheses("(ABC123)")).toBe("ABC123");
    expect(findTextBetweenParentheses("no match")).toBe("");
  });

  it("wait resolves", async () => {
    const start = Date.now();
    await wait(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  it("waitSync blocks", () => {
    const start = Date.now();
    waitSync(1);
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  it("retry succeeds on first try", async () => {
    const fn = async () => "ok";
    const wrapped = retry(fn);
    expect(await wrapped()).toBe("ok");
  });
});
