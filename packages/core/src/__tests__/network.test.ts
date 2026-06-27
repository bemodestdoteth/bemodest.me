import { describe, it, expect } from "vitest";
import { NetworkManager, networkManager } from "../network.js";
import { NetworkAnnotation } from "../models.js";

describe("network", () => {
  it("NetworkManager is singleton", () => {
    const nm1 = NetworkManager.getInstance();
    const nm2 = NetworkManager.getInstance();
    expect(nm1).toBe(nm2);
  });

  it("networkManager is singleton instance", () => {
    expect(networkManager).toBeInstanceOf(NetworkManager);
  });

  it("codeToCaip2 returns original if missing", () => {
    const nm = new NetworkManager();
    expect(nm.codeToCaip2("UNKNOWN")).toBe("UNKNOWN");
  });

  it("caip2ToCode returns original if missing", () => {
    const nm = new NetworkManager();
    expect(nm.caip2ToCode("eip155:999")).toBe("eip155:999");
  });

  it("caip2ToExchange returns original if missing", () => {
    const nm = new NetworkManager();
    expect(nm.caip2ToExchange("eip155:999", "binance")).toBe("eip155:999");
  });

  it("exchangeToCaip2 returns original if missing", () => {
    const nm = new NetworkManager();
    expect(nm.exchangeToCaip2("UNKNOWN", "binance")).toBe("UNKNOWN");
  });

  it("init with networks populates mappings", async () => {
    const nm = new NetworkManager();
    const networks: NetworkAnnotation[] = [
      {
        annotation: { code: "ETH", binance: "ETH", kucoin: "ERC20" },
        caip2: "eip155:1",
      },
    ];
    await nm.init(networks);
    expect(nm.codeToCaip2("ETH")).toBe("eip155:1");
    expect(nm.caip2ToCode("eip155:1")).toBe("ETH");
    expect(nm.caip2ToExchange("eip155:1", "binance")).toBe("ETH");
    expect(nm.exchangeToCaip2("ETH", "binance")).toBe("eip155:1");
  });

  it("updateExchangeMappings works", () => {
    const nm = new NetworkManager();
    nm.updateExchangeMappings(
      "test",
      { "eip155:1": "ETH" },
      { ETH: "eip155:1" }
    );
    expect(nm.caip2ToExchange("eip155:1", "test")).toBe("ETH");
    expect(nm.exchangeToCaip2("ETH", "test")).toBe("eip155:1");
  });

  it("caip2ToExchange with object mapping and no coin returns caip2", async () => {
    const nm = new NetworkManager();
    const networks: NetworkAnnotation[] = [
      {
        annotation: {
          code: "ETH",
          binance: { default: "ETH", usdt: "ETHUSDT" },
        },
        caip2: "eip155:1",
      },
    ];
    await nm.init(networks);
    expect(nm.caip2ToExchange("eip155:1", "binance")).toBe("eip155:1");
    expect(nm.caip2ToExchange("eip155:1", "binance", "usdt")).toBe("ETHUSDT");
    expect(nm.caip2ToExchange("eip155:1", "binance", "default")).toBe("ETH");
  });
});
