import type { ServiceEvmWallet } from "@bemodest/core";

export interface OkxCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export interface OkxAuthHeaderInput {
  credentials: OkxCredentials;
  timestamp: string;
  method: string;
  requestPath: string;
  body?: string;
}

export interface OkxDepositAddress {
  ccy: string;
  chain: string;
  addr: string;
  tag?: string;
  memo?: string;
  pmtId?: string;
  addrEx?: Record<string, unknown>;
  selected?: boolean;
  to?: string;
  ctAddr?: string;
  verifiedName?: string;
}

export interface OkxResponse<T> {
  code: string;
  msg?: string;
  data: T;
}

export interface OkxRestClientOptions {
  credentials: OkxCredentials;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface OkxDepositClient {
  getDepositAddresses(currency: string): Promise<OkxDepositAddress[]>;
}

export interface OkxAnnotatedChainConfig {
  caip2: string;
  annotation: Record<string, unknown>;
}

export interface VerifyOkxDepositAddressInput {
  currency: string;
  wallet: ServiceEvmWallet;
  chainConfig: OkxAnnotatedChainConfig;
  client: OkxDepositClient;
}

export interface VerifiedOkxDepositAddress {
  currency: string;
  network: string;
  address: string;
  walletLabel: string;
}
