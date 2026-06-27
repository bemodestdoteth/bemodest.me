import { createHmac } from "node:crypto";
import type { OkxAuthHeaderInput } from "./types.js";

export type OkxAuthHeaders = Record<string, string> & {
  "OK-ACCESS-KEY": string;
  "OK-ACCESS-SIGN": string;
  "OK-ACCESS-TIMESTAMP": string;
  "OK-ACCESS-PASSPHRASE": string;
  "content-type": "application/json";
};

export function createOkxAuthHeaders(input: OkxAuthHeaderInput): OkxAuthHeaders {
  const method = input.method.toUpperCase();
  const body = input.body ?? "";
  const prehash = `${input.timestamp}${method}${input.requestPath}${body}`;
  const signature = createHmac("sha256", input.credentials.secretKey)
    .update(prehash)
    .digest("base64");

  return {
    "OK-ACCESS-KEY": input.credentials.apiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": input.timestamp,
    "OK-ACCESS-PASSPHRASE": input.credentials.passphrase,
    "content-type": "application/json",
  };
}
