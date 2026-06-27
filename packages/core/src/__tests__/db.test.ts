import { beforeEach, describe, expect, it, vi } from "vitest";
import { Document } from "mongodb";
import {
  getServiceApiCredentials,
  getServiceEvmWallets,
  MongoDBClient,
  ServiceWalletDataError,
  ServiceWalletNotFoundError,
} from "../db.js";
import { decodeSecret } from "../requests.js";

vi.mock("../requests.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    decodeSecret: vi.fn(),
  };
});

const decodeSecretMock = vi.mocked(decodeSecret);

describe("getServiceEvmWallets", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    decodeSecretMock.mockReset();
    process.env.MONGO_USERNAME = "user";
    process.env.MONGO_PASSWORD = "pass";
    process.env.MONGO_HOST = "localhost";
    process.env.MONGO_PORT = "27017";
    process.env.MONGO_DB_NAME_PRIVATE = "codys-private";
  });

  it("queries active walletAccount documents and maps service EVM wallets", async () => {
    const encryptedKey = Buffer.from("encrypted-key");
    const salt = new Uint8Array([1, 2, 3]);
    const document: Document = {
      walletLabel: "primary",
      wallets: {
        evm: {
          address: "0xwallet",
          privateKey: {
            salt,
            encrypted_key: encryptedKey,
          },
        },
      },
      exchangeDeposits: {
        binance: {
          evm: "0xdeposit",
        },
      },
    };
    const connect = vi
      .spyOn(MongoDBClient.prototype, "connect")
      .mockResolvedValue(undefined);
    const readDocument = vi
      .spyOn(MongoDBClient.prototype, "readDocument")
      .mockResolvedValue([document]);
    decodeSecretMock.mockReturnValue("decoded-private-key");

    const wallets = await getServiceEvmWallets("svc", "prod", "binance");

    expect(connect).toHaveBeenCalledOnce();
    expect(readDocument).toHaveBeenCalledWith(
      "wallets",
      {
        documentType: "walletAccount",
        serviceName: "svc",
        environment: "prod",
        isActive: true,
        "wallets.evm.privateKey": { $exists: true },
        "exchangeDeposits.binance.evm": { $exists: true },
      },
      { walletLabel: 1 },
    );
    expect(decodeSecretMock).toHaveBeenCalledWith(
      encryptedKey,
      Buffer.from(salt),
    );
    expect(wallets).toEqual([
      {
        walletLabel: "primary",
        address: "0xwallet",
        privateKey: "decoded-private-key",
        exchangeDepositAddress: "0xdeposit",
      },
    ]);
  });

  it("rejects invalid exchange names before querying", async () => {
    const connect = vi.spyOn(MongoDBClient.prototype, "connect");
    const readDocument = vi.spyOn(MongoDBClient.prototype, "readDocument");

    await expect(
      getServiceEvmWallets("svc", "prod", "bad.exchange"),
    ).rejects.toThrow(
      "exchange must contain only letters, numbers, underscores, or hyphens",
    );
    await expect(
      getServiceEvmWallets("svc", "prod", "bad.exchange"),
    ).rejects.toBeInstanceOf(ServiceWalletDataError);
    expect(connect).not.toHaveBeenCalled();
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("throws ServiceWalletNotFoundError when no wallets match", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([]);

    await expect(
      getServiceEvmWallets("svc", "prod", "binance"),
    ).rejects.toThrow(ServiceWalletNotFoundError);
    await expect(
      getServiceEvmWallets("svc", "prod", "binance"),
    ).rejects.toThrow(
      "No active svc EVM wallets found for exchange=binance, environment=prod. Please add them to codys-private.wallets first.",
    );
  });

  it.each([
    ["walletLabel", { walletLabel: 123 }],
    [
      "address",
      {
        walletLabel: "primary",
        wallets: { evm: { address: 123, privateKey: validPrivateKey() } },
        exchangeDeposits: { binance: { evm: "0xdeposit" } },
      },
    ],
    [
      "privateKey container",
      {
        walletLabel: "primary",
        wallets: { evm: { address: "0xwallet", privateKey: "secret" } },
        exchangeDeposits: { binance: { evm: "0xdeposit" } },
      },
    ],
    [
      "privateKey bytes",
      {
        walletLabel: "primary",
        wallets: {
          evm: {
            address: "0xwallet",
            privateKey: { salt: "salt", encrypted_key: Buffer.from("key") },
          },
        },
        exchangeDeposits: { binance: { evm: "0xdeposit" } },
      },
    ],
    [
      "deposit",
      {
        walletLabel: "primary",
        wallets: { evm: { address: "0xwallet", privateKey: validPrivateKey() } },
        exchangeDeposits: { binance: { evm: 123 } },
      },
    ],
  ])("throws ServiceWalletDataError for malformed %s", async (_caseName, document) => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      document as Document,
    ]);

    await expect(
      getServiceEvmWallets("svc", "prod", "binance"),
    ).rejects.toThrow(ServiceWalletDataError);
  });
});

describe("getServiceApiCredentials", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    decodeSecretMock.mockReset();
    process.env.MONGO_USERNAME = "user";
    process.env.MONGO_PASSWORD = "pass";
    process.env.MONGO_HOST = "localhost";
    process.env.MONGO_PORT = "27017";
    process.env.MONGO_DB_NAME_PRIVATE = "codys-private";
  });

  it("loads API credentials from the existing APIs store", async () => {
    const secretKey = validPrivateKey();
    const passphrase = {
      salt: new Uint8Array([4, 5, 6]),
      encrypted_key: Buffer.from("encrypted-passphrase"),
    };
    const connect = vi
      .spyOn(MongoDBClient.prototype, "connect")
      .mockResolvedValue(undefined);
    const readDocument = vi
      .spyOn(MongoDBClient.prototype, "readDocument")
      .mockResolvedValue([
        {
          apiKey: "okx-api-key",
          secretKey,
          passphrase,
        },
      ]);
    decodeSecretMock
      .mockReturnValueOnce("decoded-secret-key")
      .mockReturnValueOnce("decoded-passphrase");

    const credentials = await getServiceApiCredentials("OKX", "dev");

    expect(connect).toHaveBeenCalledOnce();
    expect(readDocument).toHaveBeenCalledWith(
      "APIs",
      { serviceName: "OKX", environment: "dev" },
      null,
      null,
      2,
    );
    expect(decodeSecretMock).toHaveBeenNthCalledWith(
      1,
      Buffer.from("key"),
      Buffer.from("salt"),
    );
    expect(decodeSecretMock).toHaveBeenNthCalledWith(
      2,
      Buffer.from("encrypted-passphrase"),
      Buffer.from([4, 5, 6]),
    );
    expect(credentials).toEqual({
      apiKey: "okx-api-key",
      secretKey: "decoded-secret-key",
      passphrase: "decoded-passphrase",
    });
  });

  it("throws ServiceWalletNotFoundError when no API credentials match", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([]);

    await expect(getServiceApiCredentials("OKX", "dev")).rejects.toThrow(
      ServiceWalletNotFoundError,
    );
    await expect(getServiceApiCredentials("OKX", "dev")).rejects.toThrow(
      "No API credentials found for OKX (dev). Please add them to codys-private.APIs first.",
    );
  });

  it("throws ServiceWalletDataError when multiple API credential documents match", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      { apiKey: "one" },
      { apiKey: "two" },
    ]);

    await expect(getServiceApiCredentials("OKX", "dev")).rejects.toThrow(
      ServiceWalletDataError,
    );
    await expect(getServiceApiCredentials("OKX", "dev")).rejects.toThrow(
      "Multiple API credential documents found for OKX (dev).",
    );
  });

  it.each([
    ["apiKey", { apiKey: "" }],
    ["secretKey container", { apiKey: "key", secretKey: "secret", passphrase: validPrivateKey() }],
    [
      "secretKey bytes",
      {
        apiKey: "key",
        secretKey: { salt: "salt", encrypted_key: Buffer.from("key") },
        passphrase: validPrivateKey(),
      },
    ],
    ["passphrase container", { apiKey: "key", secretKey: validPrivateKey(), passphrase: "pass" }],
    [
      "passphrase bytes",
      {
        apiKey: "key",
        secretKey: validPrivateKey(),
        passphrase: { salt: Buffer.from("salt"), encrypted_key: "key" },
      },
    ],
  ])("throws ServiceWalletDataError for malformed %s", async (_caseName, document) => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      document as Document,
    ]);

    await expect(getServiceApiCredentials("OKX", "dev")).rejects.toThrow(
      ServiceWalletDataError,
    );
  });
});

function validPrivateKey(): { salt: Buffer; encrypted_key: Buffer } {
  return {
    salt: Buffer.from("salt"),
    encrypted_key: Buffer.from("key"),
  };
}
