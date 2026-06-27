import { createPublicClient, http, formatGwei, decodeAbiParameters, getAddress } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount, signMessage as viemSignMessage } from "viem/accounts";
import { logger } from "./logger.js";
import { wait, getenv } from "./tasks.js";
import { loadLines } from "./storage.js";

const BLOCK_PARAMS = ["latest", "earliest", "pending", "safe", "finalized"] as const;

export async function getEthGas(): Promise<string | undefined> {
  try {
    const w3 = createPublicClient({
      chain: mainnet,
      transport: http(
        `https://eth-mainnet.g.alchemy.com/v2/${getenv("ALCHEMY_API_KEY")}`
      ),
    });
    const gasPrice = await w3.getGasPrice();
    return formatGwei(gasPrice);
  } catch (error) {
    logger.error(`getEthGas error: ${error}`);
  }
}

export async function waitGas(maxGas: number, timeout = 60): Promise<void> {
  const startTime = Date.now();
  while (true) {
    const gas = await getEthGas();
    if (gas === undefined) {
      await wait(15);
      continue;
    }
    const gasNum = parseFloat(gas);
    if (gasNum <= maxGas) {
      logger.info(`GWEI is normal | current: ${gas} < ${maxGas}`);
      return;
    } else {
      logger.warn(`GWEI is too high | current: ${gas} > ${maxGas}`);
      await wait(15);
    }
    if (Date.now() - startTime > timeout * 1000) {
      throw new Error(`Gas price is too high: ${gas} gwei`);
    }
  }
}

export function checkGas(
  func: (...args: any[]) => Promise<any>
): (...args: any[]) => Promise<any> {
  return async (...args: any[]) => {
    await waitGas(50); // default max_gas from Python
    return func(...args);
  };
}

export async function signMessage(message: string, privateKey: string): Promise<string> {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return account.signMessage({ message });
}

export function decodeStringOrBytes32(data: string): string {
  try {
    return decodeAbiParameters([{ type: "string" }], data as `0x${string}`)[0];
  } catch {
    const bytes32 = decodeAbiParameters([{ type: "bytes32" }], data as `0x${string}`)[0];
    const buf = Buffer.from(bytes32.slice(2), "hex");
    const endPos = buf.indexOf(0);
    if (endPos === -1) {
      return buf.toString("utf-8");
    }
    return buf.slice(0, endPos).toString("utf-8");
  }
}

export function toChecksumAddresses(addresses: string[]): string[] {
  return addresses.map((addr) => getAddress(addr));
}

export function addressesFromFile(filepath: string): string[] {
  return toChecksumAddresses(loadLines(filepath));
}

const GAS_CALL_DATA_ZERO_BYTE = 4;
const GAS_CALL_DATA_BYTE = 16;

export function estimateDataGas(data: string | Uint8Array): number {
  let bytes: Uint8Array;
  if (typeof data === "string") {
    bytes = Buffer.from(data.replace(/^0x/, ""), "hex");
  } else {
    bytes = data;
  }

  let gas = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      gas += GAS_CALL_DATA_ZERO_BYTE;
    } else {
      gas += GAS_CALL_DATA_BYTE;
    }
  }
  return gas;
}

export function hexBlockIdentifier(
  blockIdentifier: number | string | Uint8Array
): string {
  if (
    typeof blockIdentifier === "string" &&
    BLOCK_PARAMS.includes(blockIdentifier as any)
  ) {
    return blockIdentifier;
  } else if (typeof blockIdentifier === "number") {
    return `0x${blockIdentifier.toString(16)}`;
  } else if (blockIdentifier instanceof Uint8Array) {
    return `0x${Buffer.from(blockIdentifier).toString("hex")}`;
  }
  return blockIdentifier as string;
}

export function linkByTxHash(explorerUrl: string, txHash: string): string {
  return `${explorerUrl}/tx/${txHash}`;
}
