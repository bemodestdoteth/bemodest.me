import { describe, it, expect } from "vitest";
import {
  formatNumber,
  negativePowerOf10,
  num2Hex,
  roundDown,
  parseNumber,
} from "../math.js";

describe("math", () => {
  it("formatNumber", () => {
    expect(formatNumber(33333.33333333333)).toBe("33,333.3333");
  });

  it("negativePowerOf10", () => {
    expect(negativePowerOf10(0)).toBe("Undefined");
    expect(negativePowerOf10(1)).toBe(0.0);
    expect(negativePowerOf10(100)).toBe(-2);
    expect(negativePowerOf10(0.01)).toBe(2);
  });

  it("num2Hex", () => {
    expect(num2Hex(0)).toBe("0");
    expect(num2Hex(10)).toBe("A");
    expect(num2Hex(15)).toBe("F");
  });

  it("num2Hex throws out of bounds", () => {
    expect(() => num2Hex(16)).toThrow(RangeError);
    expect(() => num2Hex(-1)).toThrow(RangeError);
  });

  it("roundDown", () => {
    expect(roundDown(1.2345, 2)).toBe(1.23);
    expect(roundDown(1.2399, 2)).toBe(1.23);
  });

  it("parseNumber zero", () => {
    expect(parseNumber(0)).toBe("$0\\.0000");
  });

  it("parseNumber >= 1000", () => {
    expect(parseNumber(1234.5678)).toBe("1,235");
  });

  it("parseNumber >= 1", () => {
    expect(parseNumber(123.4567)).toContain("\\.");
  });

  it("parseNumber >= 0.01", () => {
    expect(parseNumber(0.05)).toBe("0\\.0500");
  });

  it("parseNumber < 0.01", () => {
    const result = parseNumber(0.00123);
    expect(result).toContain("\\.");
    expect(result).toContain("²");
  });

  it("parseNumber handles tiny numbers", () => {
    const result = parseNumber(1e-20);
    expect(result).toContain("e-");
    expect(result).not.toContain("$0\\.00");
  });
});
