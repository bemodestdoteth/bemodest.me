import { describe, expect, it } from "vitest";
import { createOkxAuthHeaders } from "../signer.js";

const credentials = {
  apiKey: "okx-key",
  secretKey: "okx-secret",
  passphrase: "okx-passphrase",
};

describe("createOkxAuthHeaders", () => {
  it("signs GET requests with query string in the request path", () => {
    const headers = createOkxAuthHeaders({
      credentials,
      timestamp: "2020-12-08T09:08:57.715Z",
      method: "get",
      requestPath: "/api/v5/asset/deposit-address?ccy=USDT",
    });

    expect(headers).toEqual({
      "OK-ACCESS-KEY": "okx-key",
      "OK-ACCESS-SIGN": "a1ObyIVoGTHtaErXdiAeCvGhn4v864g/If8b0BXyPic=",
      "OK-ACCESS-TIMESTAMP": "2020-12-08T09:08:57.715Z",
      "OK-ACCESS-PASSPHRASE": "okx-passphrase",
      "content-type": "application/json",
    });
  });

  it("signs POST requests with the exact JSON body", () => {
    const headers = createOkxAuthHeaders({
      credentials,
      timestamp: "2020-12-08T09:08:57.715Z",
      method: "POST",
      requestPath: "/api/v5/asset/withdrawal",
      body: '{"ccy":"USDT"}',
    });

    expect(headers["OK-ACCESS-SIGN"]).toBe("OyltEoRw6uvQMP6y2YNmF+TS+NJZdpHRseRA7y6Bbe0=");
  });
});
