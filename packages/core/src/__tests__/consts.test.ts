import { describe, it, expect } from "vitest";
import {
  CHROME_IMPERSONATIONS,
  EDGE_IMPERSONATIONS,
  FIREFOX_IMPERSONATIONS,
  MAC_IMPERSONATIONS,
  Networks_ETH,
  CHAIN_LIST,
  MEMO_CHAIN,
} from "../consts.js";

describe("consts", () => {
  it("has chrome impersonations", () => {
    expect(CHROME_IMPERSONATIONS).toContain("chrome120");
  });

  it("has ETH network", () => {
    expect(Networks_ETH).toBe("ETH");
  });

  it("CHAIN_LIST contains ETH", () => {
    expect(CHAIN_LIST).toContain("ETH");
  });

  it("MEMO_CHAIN contains XRP", () => {
    expect(MEMO_CHAIN).toContain("XRP");
  });
});
