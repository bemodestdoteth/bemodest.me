import { getServiceApiCredentials } from "@bemodest/core";
import { OkxDepositVerificationError } from "./errors.js";
import { OkxRestClient } from "./client.js";
import { verifyOkxDepositAddress } from "./deposits.js";
import type {
  OkxAnnotatedChainConfig,
  OkxCredentials,
  OkxDepositClient,
  OkxRestClientOptions,
  VerifiedOkxDepositAddress,
  VerifyOkxDepositAddressInput,
} from "./types.js";

export interface OkxAdapterDependencies {
  getServiceApiCredentials?: typeof getServiceApiCredentials;
  client?: OkxDepositClient;
}

export interface OkxAdapterOptions {
  serviceName?: string;
  environment: string;
  credentials?: OkxCredentials;
  rest?: Omit<OkxRestClientOptions, "credentials">;
  dependencies?: OkxAdapterDependencies;
}

export class OkxAdapter {
  constructor(private readonly options: OkxAdapterOptions) {}

  async verifyDepositAddress(
    input: Omit<VerifyOkxDepositAddressInput, "client">,
  ): Promise<VerifiedOkxDepositAddress> {
    return verifyOkxDepositAddress({
      ...input,
      client: await this.depositClient(),
    });
  }

  async getCredentials(): Promise<OkxCredentials> {
    if (this.options.credentials) return this.options.credentials;
    const loader = this.options.dependencies?.getServiceApiCredentials ?? getServiceApiCredentials;
    const credentials = await loader(this.options.serviceName ?? "OKX", this.options.environment);
    return {
      apiKey: credentials.apiKey,
      secretKey: credentials.secretKey,
      passphrase: credentials.passphrase,
    };
  }

  private async depositClient(): Promise<OkxDepositClient> {
    if (this.options.dependencies?.client) return this.options.dependencies.client;
    return new OkxRestClient({
      ...(this.options.rest ?? {}),
      credentials: await this.getCredentials(),
    });
  }
}

export function createOkxAdapter(options: OkxAdapterOptions): OkxAdapter {
  return new OkxAdapter(options);
}

export function okxNetworkFromAnnotation(chainConfig: OkxAnnotatedChainConfig): string {
  const network = chainConfig.annotation.okx;
  if (typeof network !== "string" || network.length === 0) {
    throw new OkxDepositVerificationError("chains.annotation.okx must be a string.");
  }
  return network;
}
