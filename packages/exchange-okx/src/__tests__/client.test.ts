import { describe, expect, it, vi } from "vitest";
import { OkxApiError, OkxHttpError } from "../errors.js";
import { OkxRestClient } from "../client.js";

const credentials = {
  apiKey: "okx-key",
  secretKey: "okx-secret",
  passphrase: "okx-passphrase",
};

describe("OkxRestClient", () => {
  it("sends authenticated deposit address requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "0", data: [] }));
    const client = new OkxRestClient({
      credentials,
      fetch: fetchImpl,
      now: () => new Date("2020-12-08T09:08:57.715Z"),
    });

    await client.getDepositAddresses("USDT");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.okx.com/api/v5/asset/deposit-address?ccy=USDT",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "OK-ACCESS-KEY": "okx-key",
          "OK-ACCESS-SIGN": expect.any(String),
          "OK-ACCESS-TIMESTAMP": "2020-12-08T09:08:57.715Z",
          "OK-ACCESS-PASSPHRASE": "okx-passphrase",
        }),
      }),
    );
  });

  it("throws typed HTTP errors without secret values", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("upstream failed", { status: 500 }));
    const client = new OkxRestClient({ credentials, fetch: fetchImpl });
    const request = client.getDepositAddresses("USDT");

    await expect(request).rejects.toThrow(OkxHttpError);
    await expect(request).rejects.not.toThrow("okx-secret");
  });

  it("throws typed OKX API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: "50011",
      msg: "Invalid request",
      data: [],
    }));
    const client = new OkxRestClient({ credentials, fetch: fetchImpl });
    const request = client.getDepositAddresses("USDT");

    await expect(request).rejects.toThrow(OkxApiError);
    await expect(request).rejects.toThrow("OKX API error 50011: Invalid request");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
