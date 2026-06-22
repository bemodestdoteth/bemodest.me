import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-chars';

const { getHynixSnapshot, __test__ } = await import('./service.js');
const {
  buildSpreadGroup,
  cacheKisNxtQuote,
  defaultKisApiStoreDb,
  calculatePercentSpread,
  fetchKisAccessToken,
  fetchKisApprovalKey,
  fetchKisEtfQuote,
  fetchHyperliquidSidecar,
  fetchSidecarTicker,
  setHynixTestOverrides,
  freshKisNxtQuote,
  normalizeHyperliquidSidecarTicker,
  normalizeKisEtfQuote,
  buildEtfUnderlyingLikeQuote,
  getKisAccessToken,
  getKisApprovalKey,
  getLatestKisNxtQuote,
  hasKisCredentials,
  loadKisCredentials,
  normalizeKisCredentials,
  normalizeKisQuote,
  parseKisNxtFrame,
  parseKisTokenExpiry,
  resetKisApprovalKeyCache,
  resetKisCredentialsCache,
  resetKisNxtCache,
  resetKisTokenCache,
  resolveKisNxtWsUrl,
  setKisCredentialTestOverrides,
} = __test__;

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

function encryptedField(value) {
  return {
    buffer: Buffer.from(value),
  };
}

function mockKisCredentials() {
  setKisCredentialTestOverrides({
    reader: async () => ({
      serviceName: 'KIS',
      environment: 'dev',
      apiKey: 'mongo-key',
      secretKey: {
        encrypted_key: encryptedField('encrypted-secret'),
        salt: encryptedField('salt'),
      },
    }),
    decoder: (encryptedSecret, salt) => `${encryptedSecret.toString('utf8')}:${salt.toString('utf8')}:decoded`,
  });
}

function resetKisCredentialTestState() {
  setKisCredentialTestOverrides();
  resetKisCredentialsCache();
}

test('defaultKisApiStoreDb selects prod and dev credential stores', () => {
  assert.equal(defaultKisApiStoreDb('prod'), 'codys-private');
  assert.equal(defaultKisApiStoreDb('dev'), 'codys-private-dev');
  assert.equal(defaultKisApiStoreDb('test'), 'codys-private-dev');
});

test('loadKisCredentials uses environment-specific API-store default', async () => {
  const seen = [];
  setHynixTestOverrides({ KIS_API_STORE_DB: undefined, KIS_API_ENVIRONMENT: 'prod' });
  setKisCredentialTestOverrides({
    reader: async (storeConfig) => {
      seen.push(storeConfig);
      return {
        apiKey: 'mongo-key',
        secretKey: {
          encrypted_key: encryptedField('encrypted-secret'),
          salt: encryptedField('salt'),
        },
      };
    },
    decoder: (encryptedSecret, salt) => `${encryptedSecret.toString('utf8')}:${salt.toString('utf8')}:decoded`,
  });

  try {
    const credentials = await loadKisCredentials();

    assert.equal(credentials.appKey, 'mongo-key');
    assert.equal(seen[0].databaseName, 'codys-private');
    assert.equal(seen[0].collectionName, 'APIs');
    assert.equal(seen[0].serviceName, 'KIS');
    assert.equal(seen[0].environment, 'prod');
  } finally {
    setHynixTestOverrides(null);
    resetKisCredentialTestState();
  }
});

function makeNxtFrame(symbol = '000660', price = '101000') {
  const fields = Array.from({ length: 46 }, () => '');
  fields[0] = symbol;
  fields[1] = '093015';
  fields[2] = price;
  fields[4] = '1000';
  fields[5] = '1.00';
  fields[7] = '100000';
  fields[8] = '102000';
  fields[9] = '99000';
  fields[13] = '12345';
  fields[33] = '20260615';
  return `0|H0NXCNT0|001|${fields.join('^')}`;
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  send(payload) {
    this.sent.push(payload);
    queueMicrotask(() => this.emit('message', makeNxtFrame()));
  }

  close() {
    this.emit('close');
  }

  emit(event, payload) {
    const handler = this.handlers.get(event);
    if (handler) handler(payload);
  }
}
FakeWebSocket.instances = [];

class FakeNxtAckWebSocket extends FakeWebSocket {
  send(payload) {
    this.sent.push(payload);
    queueMicrotask(() => this.emit('message', JSON.stringify(FakeNxtAckWebSocket.response)));
  }
}
FakeNxtAckWebSocket.instances = FakeWebSocket.instances;
FakeNxtAckWebSocket.response = {
  header: { tr_id: 'H0NXCNT0', tr_key: '000660', encrypt: 'N' },
  body: { rt_cd: '0', msg_cd: 'OPSP0000', msg1: 'SUBSCRIBE SUCCESS' },
};

class FakeSidecarWebSocket extends FakeWebSocket {
  send(payload) {
    this.sent.push(payload);
    if (payload === 'test-token') {
      queueMicrotask(() => this.emit('message', 'AUTH_OK'));
      return;
    }

    const command = JSON.parse(payload);
    FakeSidecarWebSocket.commands.push(command);
    queueMicrotask(() => this.emit('message', JSON.stringify(FakeSidecarWebSocket.response)));
  }
}
FakeSidecarWebSocket.commands = [];
FakeSidecarWebSocket.response = {
  type: 'api',
  cmd: 'ticker',
  data: {
    base: 'xyz:SKHX',
    quote: 'USDC',
    c: 1582.5,
    timestamp_ms: 1781500000000,
  },
};

test('calculatePercentSpread compares KRW price with USD price converted by FX rate', () => {
  assert.equal(calculatePercentSpread(100000, 80, 1300), 4);
});

test('calculatePercentSpread rejects invalid inputs', () => {
  assert.equal(calculatePercentSpread(0, 80, 1300), null);
  assert.equal(calculatePercentSpread(100000, Number.NaN, 1300), null);
});

test('buildSpreadGroup compares ETF using underlying-like quote', () => {
  const prices = {
    regularMarket: { status: 'ok', price: 100000 },
    nxt: { status: 'ok', price: 101000 },
    etf: { status: 'ok', price: 50000 },
    etfUnderlyingLike: { status: 'ok', price: 102000 },
    hyperliquid: { status: 'ok', price: 80 },
  };
  const spreads = buildSpreadGroup('current_forex', prices, { status: 'ok', price: 1300 });

  assert.equal(spreads.regularMarket.status, 'ok');
  assert.equal(spreads.regularMarket.percent, 4);
  assert.equal(spreads.nxt.status, 'ok');
  assert.equal(Number(spreads.nxt.percent.toFixed(6)), 2.970297);
  assert.equal(spreads.etf.status, 'ok');
  assert.equal(Number(spreads.etf.percent.toFixed(6)), 1.960784);
  assert.equal(spreads.etf.koreanPriceKrw, 102000);
});

test('getHynixSnapshot uses fresh cached NXT quote', async () => {
  resetKisCredentialsCache();
  resetKisNxtCache();
  mockKisCredentials();
  cacheKisNxtQuote('000660', { status: 'ok', source: 'kis_nxt_ws', symbol: '000660', label: 'SK hynix NXT', currency: 'KRW', price: 101000, timestamp: null, fetchedAt: new Date().toISOString() });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/oauth2/tokenP')) return jsonResponse({ access_token: 'kis-token', expires_in: 3600 });
    if (String(url).includes('/uapi/domestic-stock/v1/quotations/inquire-price')) return jsonResponse({ output: { stck_prpr: '100000' } });
    if (String(url).includes('/uapi/etfetn/v1/quotations/inquire-price')) return jsonResponse({ output: { stck_prpr: '25000', nav: '10200', prdy_last_nav: '10000' } });
    return jsonResponse([{ trade_price: 1300, trade_timestamp: 1781500000000 }]);
  };

  try {
    const snapshot = await getHynixSnapshot();

    assert.equal(snapshot.prices.nxt.status, 'ok');
    assert.equal(snapshot.prices.nxt.source, 'kis_nxt_ws');
    assert.equal(snapshot.prices.nxt.price, 101000);
  } finally {
    globalThis.fetch = originalFetch;
    resetKisNxtCache();
    resetKisTokenCache();
    resetKisCredentialTestState();
  }
});

test('normalizeHyperliquidSidecarTicker maps sidecar ticker to Hynix quote shape', () => {
  const quote = normalizeHyperliquidSidecarTicker({
    base: 'xyz:SKHX',
    quote: 'USDC',
    c: 1582.5,
    timestamp_ms: 1781500000000,
  }, 'xyz:SKHX');

  assert.equal(quote.status, 'ok');
  assert.equal(quote.source, 'hyperliquid_f_sidecar');
  assert.equal(quote.symbol, 'xyz:SKHX');
  assert.equal(quote.currency, 'USD');
  assert.equal(quote.price, 1582.5);
  assert.equal(quote.timestamp, new Date(1781500000000).toISOString());
});

test('fetchSidecarTicker sends Hyperliquid futures ticker command', async () => {
  FakeWebSocket.instances = [];
  FakeSidecarWebSocket.commands = [];
  FakeSidecarWebSocket.response = {
    type: 'api',
    cmd: 'ticker',
    data: { base: 'xyz:SKHX', quote: 'USDC', c: 1582.5, timestamp_ms: 1781500000000 },
  };

  const quote = await fetchSidecarTicker({
    cmd: 'ticker',
    exchange: 'hyperliquid_f',
    base: 'xyz:SKHX',
    quote: 'USDC',
  }, {
    WebSocketImpl: FakeSidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 50 },
  });

  assert.equal(quote.status, 'ok');
  assert.equal(quote.price, 1582.5);
  assert.equal(FakeWebSocket.instances[0].url, 'wss://sidecar.test');
  assert.deepEqual(FakeSidecarWebSocket.commands[0], {
    cmd: 'ticker',
    exchange: 'hyperliquid_f',
    base: 'xyz:SKHX',
    quote: 'USDC',
  });
});

test('fetchSidecarTicker retries null ticker until sidecar returns data', async () => {
  FakeWebSocket.instances = [];
  FakeSidecarWebSocket.commands = [];
  const responses = [
    { type: 'api', cmd: 'ticker', data: null },
    { type: 'api', cmd: 'ticker', data: { base: 'xyz:SKHX', quote: 'USDC', c: 1582.5, timestamp_ms: 1781500000000 } },
  ];
  class RetrySidecarWebSocket extends FakeSidecarWebSocket {
    send(payload) {
      this.sent.push(payload);
      if (payload === 'test-token') {
        queueMicrotask(() => this.emit('message', 'AUTH_OK'));
        return;
      }

      const command = JSON.parse(payload);
      FakeSidecarWebSocket.commands.push(command);
      queueMicrotask(() => this.emit('message', JSON.stringify(responses.shift())));
    }
  }

  const quote = await fetchSidecarTicker({ cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' }, {
    WebSocketImpl: RetrySidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 100 },
  });

  assert.equal(quote.status, 'ok');
  assert.equal(quote.price, 1582.5);
  assert.equal(FakeSidecarWebSocket.commands.length > 1, true);
});

test('fetchSidecarTicker returns unavailable for null ticker and api errors', async () => {
  FakeWebSocket.instances = [];
  FakeSidecarWebSocket.commands = [];
  FakeSidecarWebSocket.response = { type: 'api', cmd: 'ticker', data: null };
  const missing = await fetchSidecarTicker({ cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' }, {
    WebSocketImpl: FakeSidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 50 },
  });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.reason, 'hyperliquid_sidecar_ticker_missing');
  assert.equal(FakeSidecarWebSocket.commands.length > 1, true);

  FakeSidecarWebSocket.response = { type: 'api_error', cmd: 'ticker', error: 'unknown exchange: hyperliquid_f' };
  const apiError = await fetchSidecarTicker({ cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' }, {
    WebSocketImpl: FakeSidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 50 },
  });
  assert.equal(apiError.status, 'unavailable');
  assert.equal(apiError.reason, 'hyperliquid_sidecar_api_error');
  assert.equal(apiError.detail, 'unknown exchange: hyperliquid_f');
});

class ErrorSidecarWebSocket extends FakeSidecarWebSocket {
  constructor(url) {
    super(url);
    queueMicrotask(() => this.emit('error', new Error('sidecar refused')));
  }
}

class SilentSidecarWebSocket extends FakeSidecarWebSocket {
  send(payload) {
    this.sent.push(payload);
  }
}

test('fetchSidecarTicker reports websocket errors', async () => {
  const quote = await fetchSidecarTicker({ cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' }, {
    WebSocketImpl: ErrorSidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 50 },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'hyperliquid_sidecar_error');
  assert.equal(quote.detail, 'sidecar refused');
});

test('fetchSidecarTicker reports no-response timeout', async () => {
  const quote = await fetchSidecarTicker({ cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' }, {
    WebSocketImpl: SilentSidecarWebSocket,
    token: 'test-token',
    sourceConfig: { sidecarUrl: 'wss://sidecar.test', timeoutMs: 1 },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'hyperliquid_sidecar_timeout');
});

test('getHynixSnapshot uses Mongo KIS credentials and sidecar Hyperliquid without direct /info allMids fetch', async () => {
  resetKisApprovalKeyCache();
  resetKisCredentialsCache();
  resetKisNxtCache();
  mockKisCredentials();
  cacheKisNxtQuote('000660', { status: 'ok', source: 'kis_nxt_ws', symbol: '000660', label: 'SK hynix NXT', currency: 'KRW', price: 101000, timestamp: null, fetchedAt: new Date().toISOString() });
  FakeWebSocket.instances = [];
  FakeSidecarWebSocket.commands = [];
  FakeSidecarWebSocket.response = {
    type: 'api',
    cmd: 'ticker',
    data: { base: 'xyz:SKHX', quote: 'USDC', c: 1582.5, timestamp_ms: 1781500000000 },
  };
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/oauth2/tokenP')) {
      return jsonResponse({ access_token: 'kis-token', expires_in: 3600 });
    }
    if (String(url).includes('/uapi/domestic-stock/v1/quotations/inquire-price')) {
      return jsonResponse({ output: { stck_prpr: '100000', stck_bsop_date: '20260615', stck_cntg_hour: '093015' } });
    }
    if (String(url).includes('/uapi/etfetn/v1/quotations/inquire-price')) {
      return jsonResponse({ output: { stck_prpr: '25000', stck_bsop_date: '20260615', stck_cntg_hour: '093016', nav: '10200', prdy_last_nav: '10000' } });
    }
    return jsonResponse([{ basePrice: 1300, trade_price: 1300, trade_timestamp: 1781500000000 }]);
  };
  setHynixTestOverrides({
    SIDECAR_URL: 'wss://sidecar.test',
    UPBIT_FOREX_URL: 'https://forex.test/current',
    HYNIX_ETF_SYMBOL: '0193T0',
    HYNIX_ETF_NAME: 'KODEX SK hynix leverage',
  });

  try {
    const snapshot = await getHynixSnapshot({ WebSocketImpl: FakeSidecarWebSocket, sidecarToken: 'test-token' });

    assert.equal(snapshot.prices.regularMarket.status, 'ok');
    assert.equal(snapshot.prices.etf.status, 'ok');
    assert.equal(snapshot.prices.etf.source, 'kis_etf');
    assert.equal(snapshot.prices.etf.price, 25000);
    assert.equal(snapshot.prices.etf.raw.nav, 10200);
    assert.equal(snapshot.prices.etfUnderlyingLike.status, 'ok');
    assert.equal(snapshot.prices.etfUnderlyingLike.price, 101000);
    assert.equal(snapshot.spreads.currentForex.etf.koreanPriceKrw, 101000);
    assert.equal(snapshot.prices.hyperliquid.status, 'ok');
    const etfCall = calls.find(call => call.url.includes('/uapi/etfetn/v1/quotations/inquire-price'));
    assert.equal(etfCall.options.headers.tr_id, 'FHPST02400000');
    assert.equal(new URL(etfCall.url).searchParams.get('FID_COND_MRKT_DIV_CODE'), 'J');
    assert.equal(new URL(etfCall.url).searchParams.get('FID_INPUT_ISCD'), '0193T0');
    assert.deepEqual(JSON.parse(calls.find(call => call.url.includes('/oauth2/tokenP')).options.body), {
      grant_type: 'client_credentials',
      appkey: 'mongo-key',
      appsecret: 'encrypted-secret:salt:decoded',
    });
    assert.deepEqual(FakeSidecarWebSocket.commands[0], { cmd: 'ticker', exchange: 'hyperliquid_f', base: 'xyz:SKHX', quote: 'USDC' });
    assert.equal(calls.some(call => call.options?.method === 'POST' && call.url.endsWith('/info') && String(call.options.body || '').includes('allMids')), false);
  } finally {
    setHynixTestOverrides(null);
    globalThis.fetch = originalFetch;
    resetKisNxtCache();
    resetKisApprovalKeyCache();
    resetKisTokenCache();
    resetKisCredentialTestState();
  }
});


test('normalizeKisQuote extracts current price and timestamp', () => {
  const result = normalizeKisQuote('000660', 'SK hynix', {
    output: {
      stck_prpr: '123,000',
      stck_bsop_date: '20260615',
      stck_cntg_hour: '093015',
      prdy_vrss: '1000',
      prdy_ctrt: '0.82',
      acml_vol: '12345',
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.price, 123000);
  assert.equal(result.timestamp, '2026-06-15T09:30:15+09:00');
});

test('normalizeKisEtfQuote extracts ETF market price and NAV fields', () => {
  const result = normalizeKisEtfQuote('0193T0', 'KODEX SK hynix leverage', {
    output: {
      stck_prpr: '25,000',
      stck_bsop_date: '20260615',
      stck_cntg_hour: '093015',
      nav: '10,200',
      prdy_last_nav: '10,000',
      nav_prdy_vrss: '200',
      nav_prdy_ctrt: '2.00',
      dprt: '-0.10',
      trc_errt: '0.02',
    },
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'kis_etf');
  assert.equal(result.price, 25000);
  assert.equal(result.timestamp, '2026-06-15T09:30:15+09:00');
  assert.equal(result.raw.nav, 10200);
  assert.equal(result.raw.previousFinalNav, 10000);
  assert.equal(result.raw.navChangeRatePct, 2);
  assert.equal(result.raw.discountPremiumRatePct, -0.1);
});

test('buildEtfUnderlyingLikeQuote derives SK Hynix spot-equivalent price from ETF NAV', () => {
  const etf = normalizeKisEtfQuote('0193T0', 'KODEX SK hynix leverage', {
    output: { stck_prpr: '25,000', stck_bsop_date: '20260615', stck_cntg_hour: '093015', nav: '10,200', prdy_last_nav: '10,000' },
  });
  const regularMarket = { status: 'ok', price: 100000, timestamp: '2026-06-15T09:29:59+09:00' };

  const result = buildEtfUnderlyingLikeQuote(etf, regularMarket);

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'kis_etf_nav_derived');
  assert.equal(result.price, 101000);
  assert.equal(result.timestamp, '2026-06-15T09:30:15+09:00');
  assert.equal(result.raw.nav, 10200);
  assert.equal(result.raw.previousFinalNav, 10000);
  assert.equal(result.raw.leverage, 2);
  assert.equal(Number(result.raw.navReturn.toFixed(6)), 0.02);
  assert.equal(Number(result.raw.underlyingReturn.toFixed(6)), 0.01);
  assert.equal(result.raw.unroundedPrice, 101000);
  assert.equal(result.raw.anchorPrice, 100000);
  assert.equal(result.raw.anchorTimestamp, '2026-06-15T09:29:59+09:00');
});

test('buildEtfUnderlyingLikeQuote does not fall back when inputs are unavailable', () => {
  const etf = normalizeKisEtfQuote('0193T0', 'KODEX SK hynix leverage', {
    output: { stck_prpr: '25,000', nav: '', prdy_last_nav: '10,000' },
  });
  const invalid = buildEtfUnderlyingLikeQuote(etf, { status: 'ok', price: 100000 });
  const missingAnchor = buildEtfUnderlyingLikeQuote(etf, { status: 'unavailable', reason: 'kis_token_request_failed' });

  assert.equal(invalid.status, 'unavailable');
  assert.equal(invalid.reason, 'etf_underlying_like_invalid_inputs');
  assert.equal(missingAnchor.status, 'unavailable');
  assert.equal(missingAnchor.reason, 'etf_underlying_like_anchor_unavailable');
});

test('parseKisNxtFrame extracts NXT trade fields', () => {
  const result = parseKisNxtFrame(makeNxtFrame(), '000660');

  assert.equal(result.status, 'ok');
  assert.equal(result.source, 'kis_nxt_ws');
  assert.equal(result.symbol, '000660');
  assert.equal(result.price, 101000);
  assert.equal(result.timestamp, '2026-06-15T09:30:15+09:00');
  assert.equal(result.raw.volume, 12345);
});

test('parseKisNxtFrame rejects mismatched symbols and invalid prices', () => {
  assert.equal(parseKisNxtFrame(makeNxtFrame('005930'), '000660'), null);
  assert.equal(parseKisNxtFrame(makeNxtFrame('000660', '0'), '000660'), null);
  assert.equal(parseKisNxtFrame('{"header":{"tr_id":"PINGPONG"}}', '000660'), null);
});

test('freshKisNxtQuote rejects stale cached ticks', () => {
  resetKisNxtCache();
  const quote = { status: 'ok', source: 'kis_nxt_ws', symbol: '000660', price: 101000 };
  cacheKisNxtQuote('000660', quote, () => 1000);

  assert.equal(freshKisNxtQuote('000660', { tickMaxAgeMs: 1000 }, () => 1500), quote);
  assert.equal(freshKisNxtQuote('000660', { tickMaxAgeMs: 1000 }, () => 2501), null);
  resetKisNxtCache();
});

test('resolveKisNxtWsUrl requires secure transport unless explicitly allowed', () => {
  assert.equal(resolveKisNxtWsUrl({ wsUrl: 'wss://example.com/tryitout' }), 'wss://example.com/tryitout');
  assert.throws(
    () => resolveKisNxtWsUrl({ wsUrl: `${'ws'}://example.com/tryitout`, allowInsecure: false }),
    /secure transport/,
  );
  assert.equal(resolveKisNxtWsUrl({ wsUrl: `${'ws'}://example.com/tryitout`, allowInsecure: true }), `${'ws'}://example.com/tryitout`);
});

test('normalizeKisCredentials decrypts Mongo API-store fields', () => {
  const credentials = normalizeKisCredentials({
    apiKey: 'mongo-key',
    secretKey: {
      encrypted_key: encryptedField('encrypted-secret'),
      salt: encryptedField('salt'),
    },
  }, (encryptedSecret, salt, passphrase) => `${encryptedSecret.toString('utf8')}:${salt.toString('utf8')}:${passphrase}`);

  assert.equal(credentials.appKey, 'mongo-key');
  assert.equal(credentials.appSecret, 'encrypted-secret:salt:undefined');
  assert.equal(hasKisCredentials(credentials), true);
});

test('parseKisTokenExpiry supports KIS absolute expiry and expires_in', () => {
  assert.equal(
    parseKisTokenExpiry({ access_token_token_expired: '2026-06-15 12:34:56' }),
    new Date('2026-06-15 12:34:56').getTime(),
  );
  assert.equal(parseKisTokenExpiry({ expires_in: '3600' }, () => 1000), 3601000);
  assert.equal(parseKisTokenExpiry({}), null);
});

test('fetchKisApprovalKey posts app credentials to approval endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ approval_key: 'approval-key' });
  };

  const key = await fetchKisApprovalKey({
    approvalBaseUrl: 'https://openapi.koreainvestment.com:9443',
    appKey: 'key',
    appSecret: 'secret',
  }, fetchImpl, () => 1000);

  assert.equal(key.value, 'approval-key');
  assert.equal(String(calls[0].url), 'https://openapi.koreainvestment.com:9443/oauth2/Approval');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant_type: 'client_credentials',
    appkey: 'key',
    secretkey: 'secret',
  });
});

test('getKisApprovalKey caches approval key and retries after failure', async () => {
  resetKisApprovalKeyCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ msg1: 'approval failed' }, false, 401);
    return jsonResponse({ approval_key: 'cached-approval' });
  };
  const sourceConfig = { approvalBaseUrl: 'https://example.com', appKey: 'key', appSecret: 'secret' };

  await assert.rejects(getKisApprovalKey(sourceConfig, fetchImpl, () => 1000), /KIS approval request failed: approval failed/);
  assert.equal(await getKisApprovalKey(sourceConfig, fetchImpl, () => 1000), 'cached-approval');
  assert.equal(await getKisApprovalKey(sourceConfig, fetchImpl, () => 1000), 'cached-approval');
  assert.equal(calls, 2);
  resetKisApprovalKeyCache();
});

test('getLatestKisNxtQuote subscribes and resolves from websocket tick', async () => {
  resetKisApprovalKeyCache();
  resetKisNxtCache();
  FakeWebSocket.instances = [];
  const fetchImpl = async () => jsonResponse({ approval_key: 'approval-key' });
  const quote = await getLatestKisNxtQuote('000660', {
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    sourceConfig: {
      approvalBaseUrl: 'https://example.com',
      appKey: 'key',
      appSecret: 'secret',
      wsUrl: 'wss://example.com/tryitout',
      allowInsecure: false,
      tickTimeoutMs: 50,
      tickMaxAgeMs: 1000,
    },
  });

  assert.equal(quote.status, 'ok');
  assert.equal(quote.price, 101000);
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.deepEqual(JSON.parse(FakeWebSocket.instances[0].sent[0]).body.input, { tr_id: 'H0NXCNT0', tr_key: '000660' });
  resetKisNxtCache();
  resetKisApprovalKeyCache();
});

test('getLatestKisNxtQuote returns unavailable on missing credentials', async () => {
  const quote = await getLatestKisNxtQuote('000660', {
    sourceConfig: { wsUrl: 'wss://example.com/tryitout', tickTimeoutMs: 1, tickMaxAgeMs: 1000 },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'kis_credentials_missing');
});

test('getLatestKisNxtQuote reports subscribed stream with no trade tick distinctly', async () => {
  resetKisApprovalKeyCache();
  resetKisNxtCache();
  FakeWebSocket.instances = [];
  FakeNxtAckWebSocket.response = {
    header: { tr_id: 'H0NXCNT0', tr_key: '000660', encrypt: 'N' },
    body: { rt_cd: '0', msg_cd: 'OPSP0000', msg1: 'SUBSCRIBE SUCCESS' },
  };
  const quote = await getLatestKisNxtQuote('000660', {
    fetchImpl: async () => jsonResponse({ approval_key: 'approval-key' }),
    WebSocketImpl: FakeNxtAckWebSocket,
    sourceConfig: {
      approvalBaseUrl: 'https://example.com',
      appKey: 'key',
      appSecret: 'secret',
      wsUrl: 'wss://example.com/tryitout',
      allowInsecure: false,
      tickTimeoutMs: 1,
      tickMaxAgeMs: 1000,
    },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'kis_nxt_no_trade_tick');
  assert.equal(quote.detail, 'SUBSCRIBE SUCCESS');
  resetKisNxtCache();
  resetKisApprovalKeyCache();
});

test('getLatestKisNxtQuote reports NXT subscription errors distinctly', async () => {
  resetKisApprovalKeyCache();
  resetKisNxtCache();
  FakeWebSocket.instances = [];
  FakeNxtAckWebSocket.response = {
    header: { tr_id: 'H0NXCNT0', tr_key: '000660', encrypt: 'N' },
    body: { rt_cd: '1', msg_cd: 'OPSP9999', msg1: 'SUBSCRIBE FAILED' },
  };
  const quote = await getLatestKisNxtQuote('000660', {
    fetchImpl: async () => jsonResponse({ approval_key: 'approval-key' }),
    WebSocketImpl: FakeNxtAckWebSocket,
    sourceConfig: {
      approvalBaseUrl: 'https://example.com',
      appKey: 'key',
      appSecret: 'secret',
      wsUrl: 'wss://example.com/tryitout',
      allowInsecure: false,
      tickTimeoutMs: 1,
      tickMaxAgeMs: 1000,
    },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'kis_nxt_subscription_failed');
  assert.equal(quote.detail, 'SUBSCRIBE FAILED');
  resetKisNxtCache();
  resetKisApprovalKeyCache();
});

test('getLatestKisNxtQuote reports approval failures distinctly', async () => {
  resetKisApprovalKeyCache();
  resetKisNxtCache();
  const fetchImpl = async () => jsonResponse({ msg1: 'approval failed' }, false, 401);
  const quote = await getLatestKisNxtQuote('000660', {
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
    sourceConfig: {
      approvalBaseUrl: 'https://example.com',
      appKey: 'key',
      appSecret: 'secret',
      wsUrl: 'wss://example.com/tryitout',
      allowInsecure: false,
      tickTimeoutMs: 1,
      tickMaxAgeMs: 1000,
    },
  });

  assert.equal(quote.status, 'unavailable');
  assert.equal(quote.reason, 'kis_nxt_approval_failed');
  assert.match(quote.detail, /approval failed/);
  resetKisNxtCache();
  resetKisApprovalKeyCache();
});

test('fetchKisAccessToken posts app credentials to token endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({
      access_token: 'generated-token',
      access_token_token_expired: '2026-06-15 12:34:56',
    });
  };

  const token = await fetchKisAccessToken({
    baseUrl: 'https://openapi.koreainvestment.com:9443',
    appKey: 'key',
    appSecret: 'secret',
  }, fetchImpl);

  assert.equal(token.value, 'generated-token');
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), 'https://openapi.koreainvestment.com:9443/oauth2/tokenP');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    grant_type: 'client_credentials',
    appkey: 'key',
    appsecret: 'secret',
  });
});

test('getKisAccessToken reuses cached token before expiry', async () => {
  resetKisTokenCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ access_token: 'cached-token', expires_in: 3600 });
  };
  const now = () => 1000;
  const sourceConfig = { baseUrl: 'https://example.com', appKey: 'key', appSecret: 'secret' };

  assert.equal(await getKisAccessToken(sourceConfig, fetchImpl, now), 'cached-token');
  assert.equal(await getKisAccessToken(sourceConfig, fetchImpl, now), 'cached-token');
  assert.equal(calls, 1);
  resetKisTokenCache();
});

test('getKisAccessToken refreshes expired cached token', async () => {
  resetKisTokenCache();
  let calls = 0;
  let nowMs = 1000;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({ access_token: `token-${calls}`, expires_in: 120 });
  };
  const now = () => nowMs;
  const sourceConfig = { baseUrl: 'https://example.com', appKey: 'key', appSecret: 'secret' };

  assert.equal(await getKisAccessToken(sourceConfig, fetchImpl, now), 'token-1');
  nowMs += 61_000;
  assert.equal(await getKisAccessToken(sourceConfig, fetchImpl, now), 'token-2');
  assert.equal(calls, 2);
  resetKisTokenCache();
});

test('getKisAccessToken deduplicates concurrent token requests', async () => {
  resetKisTokenCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return jsonResponse({ access_token: 'shared-token', expires_in: 3600 });
  };
  const sourceConfig = { baseUrl: 'https://example.com', appKey: 'key', appSecret: 'secret' };

  const [first, second] = await Promise.all([
    getKisAccessToken(sourceConfig, fetchImpl, () => 1000),
    getKisAccessToken(sourceConfig, fetchImpl, () => 1000),
  ]);

  assert.equal(first, 'shared-token');
  assert.equal(second, 'shared-token');
  assert.equal(calls, 1);
  resetKisTokenCache();
});

test('getKisAccessToken retries after failed token request', async () => {
  resetKisTokenCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error_description: 'bad credentials' }, false, 401);
    return jsonResponse({ access_token: 'retry-token', expires_in: 3600 });
  };
  const sourceConfig = { baseUrl: 'https://example.com', appKey: 'key', appSecret: 'secret' };

  await assert.rejects(
    getKisAccessToken(sourceConfig, fetchImpl, () => 1000),
    /KIS token request failed: bad credentials/,
  );
  assert.equal(await getKisAccessToken(sourceConfig, fetchImpl, () => 1000), 'retry-token');
  assert.equal(calls, 2);
  resetKisTokenCache();
});
