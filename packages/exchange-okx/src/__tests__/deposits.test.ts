import { describe, expect, it, vi } from "vitest";
import { OkxDepositVerificationError } from "../errors.js";
import { verifyOkxDepositAddress } from "../deposits.js";
import type { OkxDepositAddress } from "../types.js";

const wallet = {
  walletLabel: "primary",
  address: "0xwallet",
  privateKey: "0xprivate",
  exchangeDepositAddress: "0xDeposit",
};

const chainConfig = {
  caip2: "eip155:1",
  annotation: { okx: "USDT-ERC20" },
};

describe("verifyOkxDepositAddress", () => {
  it("verifies walletAccount deposit address against OKX chain annotation", async () => {
    const result = await verifyOkxDepositAddress({
      currency: "USDT",
      wallet,
      chainConfig,
      client: clientReturning([{ ccy: "USDT", chain: "USDT-ERC20", addr: "0xDeposit" }]),
    });

    expect(result).toEqual({
      currency: "USDT",
      network: "USDT-ERC20",
      address: "0xDeposit",
      walletLabel: "primary",
    });
  });

  it("rejects missing or non-string OKX network annotations", async () => {
    await expect(
      verifyOkxDepositAddress({
        currency: "USDT",
        wallet,
        chainConfig: { caip2: "eip155:1", annotation: {} },
        client: clientReturning([]),
      }),
    ).rejects.toThrow(OkxDepositVerificationError);

    await expect(
      verifyOkxDepositAddress({
        currency: "USDT",
        wallet,
        chainConfig: { caip2: "eip155:1", annotation: { okx: { network: "USDT-ERC20" } } },
        client: clientReturning([]),
      }),
    ).rejects.toThrow("chains.annotation.okx must be a string");
  });

  it("rejects duplicate matching OKX network rows", async () => {
    await expect(
      verifyOkxDepositAddress({
        currency: "USDT",
        wallet,
        chainConfig,
        client: clientReturning([
          { ccy: "USDT", chain: "USDT-ERC20", addr: "0xDeposit" },
          { ccy: "USDT", chain: "USDT-ERC20", addr: "0xDeposit" },
        ]),
      }),
    ).rejects.toThrow("Multiple OKX deposit addresses found for currency=USDT, network=USDT-ERC20");
  });

  it("rejects mismatched OKX deposit addresses", async () => {
    await expect(
      verifyOkxDepositAddress({
        currency: "USDT",
        wallet,
        chainConfig,
        client: clientReturning([{ ccy: "USDT", chain: "USDT-ERC20", addr: "0xOther" }]),
      }),
    ).rejects.toThrow("OKX deposit address mismatch for wallet primary on USDT-ERC20");
  });
});

function clientReturning(addresses: OkxDepositAddress[]) {
  return {
    getDepositAddresses: vi.fn().mockResolvedValue(addresses),
  };
}
