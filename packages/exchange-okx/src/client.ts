import { OkxApiError, OkxHttpError } from "./errors.js";
import { createOkxAuthHeaders } from "./signer.js";
import type { OkxDepositAddress, OkxResponse, OkxRestClientOptions } from "./types.js";

const DEFAULT_OKX_BASE_URL = "https://www.okx.com";

export class OkxRestClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: OkxRestClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_OKX_BASE_URL;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async getDepositAddresses(currency: string): Promise<OkxDepositAddress[]> {
    return this.request<OkxDepositAddress[]>("GET", "/api/v5/asset/deposit-address", {
      ccy: currency,
    });
  }

  private async request<T>(
    method: "GET",
    path: string,
    query: Record<string, string>,
  ): Promise<T> {
    const params = new URLSearchParams(query);
    const requestPath = `${path}?${params.toString()}`;
    const url = `${this.baseUrl}${requestPath}`;
    const timestamp = this.now().toISOString();
    const headers = createOkxAuthHeaders({
      credentials: this.options.credentials,
      timestamp,
      method,
      requestPath,
    });

    const response = await this.fetchImpl(url, { method, headers });
    const text = await response.text();
    if (!response.ok) {
      throw new OkxHttpError(response.status, `OKX HTTP error ${response.status}: ${safeMessage(text)}`);
    }

    const payload = parseOkxJson<T>(text);
    if (payload.code !== "0") {
      throw new OkxApiError(payload.code, `OKX API error ${payload.code}: ${payload.msg ?? "Unknown error"}`);
    }
    return payload.data;
  }
}

function parseOkxJson<T>(text: string): OkxResponse<T> {
  try {
    const value: unknown = JSON.parse(text);
    if (!isOkxResponse<T>(value)) {
      throw new Error("Unexpected OKX response shape");
    }
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OkxApiError("invalid_json", `OKX response invalid JSON: ${message}`);
  }
}

function isOkxResponse<T>(value: unknown): value is OkxResponse<T> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "string" && Array.isArray(record.data);
}

function safeMessage(text: string): string {
  return text.slice(0, 200) || "empty response";
}
