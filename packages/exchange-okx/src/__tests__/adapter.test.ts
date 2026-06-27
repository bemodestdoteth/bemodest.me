import { describe, expect, it, vi } from "vitest";
import { createOkxAdapter } from "../adapter.js";

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

describe("createOkxAdapter", () => {
  it("loads OKX credentials through the injected core credential loader", async () => {
    const getServiceApiCredentials = vi.fn().mockResolvedValue({
      apiKey: "api-key",
      secretKey: "secret-key",
      passphrase: "passphrase",
    });
    const adapter = createOkxAdapter({
      serviceName: "OKX",
      environment: "dev",
      dependencies: { getServiceApiCredentials },
    });

    await expect(adapter.getCredentials()).resolves.toEqual({
      apiKey: "api-key",
      secretKey: "secret-key",
      passphrase: "passphrase",
    });
    expect(getServiceApiCredentials).toHaveBeenCalledWith("OKX", "dev");
  });

  it("verifies deposit addresses through the adapter public interface", async () => {
    const client = {
      getDepositAddresses: vi.fn().mockResolvedValue([
        { ccy: "USDT", chain: "USDT-ERC20", addr: "0xDeposit" },
      ]),
    };
    const adapter = createOkxAdapter({
      environment: "dev",
      credentials: {
        apiKey: "api-key",
        secretKey: "secret-key",
        passphrase: "passphrase",
      },
      dependencies: { client },
    });

    await expect(
      adapter.verifyDepositAddress({ currency: "USDT", wallet, chainConfig }),
    ).resolves.toEqual({
      currency: "USDT",
      network: "USDT-ERC20",
      address: "0xDeposit",
      walletLabel: "primary",
    });
    expect(client.getDepositAddresses).toHaveBeenCalledWith("USDT");
  });
});
