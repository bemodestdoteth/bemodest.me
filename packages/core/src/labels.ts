import crypto from "crypto";
import { findTextBetweenParentheses, getenv } from "./tasks.js";

function _validateUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid protocol: ${parsed.protocol}`);
    }
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

export function hashString(inputStr: string): string {
  return crypto.createHash("sha256").update(inputStr, "utf-8").digest("hex");
}

export async function fetchDataFromServer(
  labelHash: string
): Promise<Record<string, Record<string, string | boolean>> | null> {
  const serverUrl = getenv("SERVER_URL");
  _validateUrl(serverUrl);

  const currentTimestamp = String(Math.floor(Date.now() / 1000));
  const signature = hashString(labelHash + currentTimestamp);

  const serverResponse = await fetch(serverUrl, {
    headers: {
      "X-Signature": signature,
      "X-Timestamp": currentTimestamp,
    },
  });

  if (serverResponse.status !== 200) {
    throw new Error(
      `Looks like there was a problem when downloading data from the server. Status Code: ${serverResponse.status}`
    );
  }

  const result = (await serverResponse.json()) as { url: string };
  _validateUrl(result.url);

  const signedUrlResponse = await fetch(result.url);
  if (signedUrlResponse.status !== 200) {
    console.error(
      `Looks like there was a problem when accessing signed url. Status Code: ${signedUrlResponse.status}`
    );
    return null;
  }

  const labelsAddrKey = getenv("LABELS_ADDR_KEY");
  const data = (await signedUrlResponse.json()) as Record<string, unknown>;
  return data[labelsAddrKey] as Record<string, Record<string, string | boolean>>;
}

export async function fetchLabelsWithEntity(
  entity: string,
  labelHash: string,
  preloadedLabels?: Record<string, Record<string, string | boolean>> | null
): Promise<Record<string, Record<string, string[]>>> {
  const labels = preloadedLabels ?? (await fetchDataFromServer(labelHash));
  if (!labels) {
    return {};
  }

  const result: Record<string, Record<string, string[]>> = {};
  for (const [addr, values] of Object.entries(labels)) {
    if (values.entity === entity) {
      const chain = values.code as string;
      const coinName = findTextBetweenParentheses(values.label as string);

      if (!result[chain]) {
        result[chain] = {};
      }
      if (coinName === "") {
        if (!result[chain].general) {
          result[chain].general = [];
        }
        result[chain].general.push(addr);
      } else {
        if (!result[chain][coinName]) {
          result[chain][coinName] = [];
        }
        result[chain][coinName].push(addr);
      }
    }
  }
  return result;
}

export async function fetchNetworksWithEntity(
  entity: string,
  labelHash: string,
  preloadedLabels?: Record<string, Record<string, string | boolean>> | null
): Promise<Record<string, string>> {
  const labels = preloadedLabels ?? (await fetchDataFromServer(labelHash));
  if (!labels) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [_addr, values] of Object.entries(labels)) {
    if (values.entity === entity) {
      const chain = values.code as string;
      const coinName = findTextBetweenParentheses(values.label as string);

      if (!(coinName in result)) {
        result[coinName] = chain;
      }
    }
  }
  return result;
}

export async function findLabelsWithAddress(
  labelHash: string,
  address: string,
  addressBack?: string | null,
  preloadedLabels?: Record<string, Record<string, string | boolean>> | null,
  fullMatch = true
): Promise<Record<string, string | boolean> | Record<string, Record<string, string | boolean>> | null> {
  const labels = preloadedLabels ?? (await fetchDataFromServer(labelHash));
  if (!labels) {
    return null;
  }

  if (fullMatch) {
    return labels[address] ?? null;
  } else {
    const result: Record<string, Record<string, string | boolean>> = {};
    for (const [addr, values] of Object.entries(labels)) {
      if (
        addr.startsWith(address) &&
        (addressBack === undefined || addressBack === null || addr.endsWith(addressBack))
      ) {
        result[addr] = values;
      }
    }
    return result;
  }
}
