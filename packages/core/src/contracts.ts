import { getAddress, isAddress } from "viem";
import type { Document } from "mongodb";
import { MongoDBClient } from "./db.js";
import { KnownErc20ContractSchema } from "./models.js";
import type { KnownErc20Contract } from "./models.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class KnownContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnownContractError";
  }
}

export class KnownContractNotFoundError extends KnownContractError {
  constructor(message: string) {
    super(message);
    this.name = "KnownContractNotFoundError";
  }
}

export class KnownContractDataError extends KnownContractError {
  constructor(message: string) {
    super(message);
    this.name = "KnownContractDataError";
  }
}

export interface KnownErc20ContractLookup {
  caip2: string;
  tokenAddress: string;
}

function normalizedEvmTokenAddress(tokenAddress: string): string {
  if (!isAddress(tokenAddress, { strict: false })) {
    throw new KnownContractDataError("tokenAddress must be a valid EVM address.");
  }

  const normalized = getAddress(tokenAddress);
  if (normalized === ZERO_ADDRESS) {
    throw new KnownContractDataError("tokenAddress must not be the zero address.");
  }
  return normalized;
}

function parseKnownErc20Contract(document: Document): KnownErc20Contract {
  const result = KnownErc20ContractSchema.safeParse(document);
  if (!result.success) {
    throw new KnownContractDataError(result.error.message);
  }
  return result.data;
}

export async function validateKnownErc20TokenAddress(
  input: KnownErc20ContractLookup,
): Promise<KnownErc20Contract> {
  if (!/^eip155:\d+$/.test(input.caip2)) {
    throw new KnownContractDataError("caip2 must be an EVM CAIP-2 identifier.");
  }

  const tokenAddress = normalizedEvmTokenAddress(input.tokenAddress);
  const client = new MongoDBClient();
  await client.connect();

  const query = {
    status: "active",
    contractType: "erc20",
    caip2: input.caip2,
    tokenAddress,
  };

  const documents = await client.readDocument("knownContracts", query, null, null, 2);

  if (documents.length === 0) {
    throw new KnownContractNotFoundError(
      `No active ERC20 known contract found for caip2=${input.caip2}, tokenAddress=${tokenAddress}.`,
    );
  }

  if (documents.length > 1) {
    throw new KnownContractDataError(
      `Multiple active ERC20 known contracts found for caip2=${input.caip2}, tokenAddress=${tokenAddress}.`,
    );
  }

  return parseKnownErc20Contract(documents[0]);
}
