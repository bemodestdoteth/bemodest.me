import { OkxDepositVerificationError } from "./errors.js";
import type { VerifyOkxDepositAddressInput, VerifiedOkxDepositAddress } from "./types.js";

export async function verifyOkxDepositAddress(
  input: VerifyOkxDepositAddressInput,
): Promise<VerifiedOkxDepositAddress> {
  const network = okxNetworkFromChainConfig(input.chainConfig.annotation);
  const addresses = await input.client.getDepositAddresses(input.currency);
  const matches = addresses.filter((address) => address.chain === network);

  if (matches.length === 0) {
    throw new OkxDepositVerificationError(
      `No OKX deposit address found for currency=${input.currency}, network=${network}.`,
    );
  }
  if (matches.length > 1) {
    throw new OkxDepositVerificationError(
      `Multiple OKX deposit addresses found for currency=${input.currency}, network=${network}.`,
    );
  }

  const [match] = matches;
  if (match.addr !== input.wallet.exchangeDepositAddress) {
    throw new OkxDepositVerificationError(
      `OKX deposit address mismatch for wallet ${input.wallet.walletLabel} on ${network}.`,
    );
  }

  return {
    currency: input.currency,
    network,
    address: match.addr,
    walletLabel: input.wallet.walletLabel,
  };
}

function okxNetworkFromChainConfig(annotation: Record<string, unknown>): string {
  const network = annotation.okx;
  if (typeof network !== "string" || network.length === 0) {
    throw new OkxDepositVerificationError("chains.annotation.okx must be a string.");
  }
  return network;
}
