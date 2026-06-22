import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { validateApiConfig } from '@bemodest/config';
import { getDBClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';
import { decodeSecret } from '@my-exchanges/core';

const config = validateApiConfig();
let hynixTestOverrides = null;

function serviceConfig() {
  return hynixTestOverrides ? { ...config, ...hynixTestOverrides } : config;
}

const DEFAULT_KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const KIS_TOKEN_PATH = '/oauth2/tokenP';
const KIS_APPROVAL_PATH = '/oauth2/Approval';
const KIS_DOMESTIC_PRICE_PATH = '/uapi/domestic-stock/v1/quotations/inquire-price';
const KIS_ETF_PRICE_PATH = '/uapi/etfetn/v1/quotations/inquire-price';
const KIS_TR_ID_REAL = 'FHKST01010100';
const KIS_ETF_TR_ID_REAL = 'FHPST02400000';
const KIS_NXT_TR_ID = 'H0NXCNT0';
const KIS_FID_COND_MRKT_DIV_CODE = 'J';
const HYNIX_ETF_LEVERAGE = 2;
const KIS_TOKEN_EXPIRY_BUFFER_MS = 60_000;
const KIS_APPROVAL_KEY_TTL_MS = 20 * 60 * 60 * 1000;
const UPBIT_USDT_MARKET_URL = 'https://api.upbit.com/v1/ticker?markets=KRW-USDT';
const HYNIX_HYPERLIQUID_SYMBOL = 'xyz:SKHX';
const DEFAULT_SYMBOLS = {
  skHynix: '000660',
};

function nowIso() {
  return new Date().toISOString();
}

function unavailable(reason, detail = null) {
  return {
    status: 'unavailable',
    reason,
    detail,
    fetchedAt: nowIso(),
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function parseKisTimestamp(payload) {
  const date = payload.stck_bsop_date;
  const time = payload.stck_cntg_hour;
  if (!/^\d{8}$/.test(String(date)) || !/^\d{6}$/.test(String(time))) return null;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`;
}

function normalizeKisQuote(symbol, label, payload) {
  const output = payload?.output;
  if (!output || typeof output !== 'object') {
    return unavailable('kis_response_missing_output');
  }

  const price = parseNumber(output.stck_prpr);
  if (price === null) {
    return unavailable('kis_response_missing_price');
  }

  return {
    status: 'ok',
    source: 'kis',
    symbol,
    label,
    currency: 'KRW',
    price,
    timestamp: parseKisTimestamp(output),
    fetchedAt: nowIso(),
    raw: {
      change: parseNumber(output.prdy_vrss),
      changeRatePct: parseNumber(output.prdy_ctrt),
      open: parseNumber(output.stck_oprc),
      high: parseNumber(output.stck_hgpr),
      low: parseNumber(output.stck_lwpr),
      volume: parseNumber(output.acml_vol),
    },
  };
}

function normalizeKisEtfQuote(symbol, label, payload) {
  const output = payload?.output;
  if (!output || typeof output !== 'object') {
    return unavailable('kis_etf_response_missing_output');
  }

  const price = parseNumber(output.stck_prpr);
  if (price === null) {
    return unavailable('kis_etf_response_missing_price');
  }

  return {
    status: 'ok',
    source: 'kis_etf',
    symbol,
    label,
    currency: 'KRW',
    price,
    timestamp: parseKisTimestamp(output),
    fetchedAt: nowIso(),
    raw: {
      nav: parseNumber(output.nav),
      previousFinalNav: parseNumber(output.prdy_last_nav),
      navChange: parseNumber(output.nav_prdy_vrss),
      navChangeSign: output.nav_prdy_vrss_sign || null,
      navChangeRatePct: parseNumber(output.nav_prdy_ctrt),
      discountPremiumRatePct: parseNumber(output.dprt),
      trackingErrorRatePct: parseNumber(output.trc_errt),
      netAssetTotal: parseNumber(output.etf_ntas_ttam),
      circulatedNetAssetTotal: parseNumber(output.etf_crcl_ntas_ttam),
      change: parseNumber(output.prdy_vrss),
      changeRatePct: parseNumber(output.prdy_ctrt),
      open: parseNumber(output.stck_oprc),
      high: parseNumber(output.stck_hgpr),
      low: parseNumber(output.stck_lwpr),
      volume: parseNumber(output.acml_vol),
    },
  };
}

let kisTokenCache = null;
let kisTokenPromise = null;
let kisApprovalKeyCache = null;
let kisApprovalKeyPromise = null;
let kisCredentialsCache = null;
let kisCredentialsPromise = null;
let kisCredentialReader = null;
let kisSecretDecoder = null;
const kisNxtState = {
  socket: null,
  connectingPromise: null,
  latestBySymbol: new Map(),
  waitersBySymbol: new Map(),
  subscriptionBySymbol: new Map(),
};

function parseBool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function kisApiEnvironment(config) {
  return config.KIS_API_ENVIRONMENT || config.NODE_ENV || 'dev';
}

function defaultKisApiStoreDb(environment) {
  return environment === 'prod' ? 'codys-private' : 'codys-private-dev';
}

function kisApiStoreConfig() {
  const currentConfig = serviceConfig();
  const environment = kisApiEnvironment(currentConfig);
  return {
    databaseName: currentConfig.KIS_API_STORE_DB || defaultKisApiStoreDb(environment),
    collectionName: currentConfig.KIS_API_STORE_COLLECTION || 'APIs',
    serviceName: currentConfig.KIS_API_SERVICE_NAME || 'KIS',
    environment,
  };
}

function kisConfig(credentials = null) {
  const currentConfig = serviceConfig();
  return {
    baseUrl: currentConfig.KIS_BASE_URL || DEFAULT_KIS_BASE_URL,
    appKey: credentials?.appKey,
    appSecret: credentials?.appSecret,
  };
}

function kisWsConfig(credentials = null) {
  const currentConfig = serviceConfig();
  const useMock = parseBool(currentConfig.KIS_WS_USE_MOCK);
  return {
    approvalBaseUrl: currentConfig.KIS_NXT_APPROVAL_BASE_URL || currentConfig.KIS_BASE_URL || DEFAULT_KIS_BASE_URL,
    appKey: credentials?.appKey,
    appSecret: credentials?.appSecret,
    wsUrl: useMock ? currentConfig.KIS_WS_MOCK_URL : currentConfig.KIS_WS_URL,
    allowInsecure: parseBool(currentConfig.KIS_WS_ALLOW_INSECURE),
    tickTimeoutMs: parsePositiveInteger(currentConfig.HYNIX_NXT_TICK_TIMEOUT_MS, 800),
    tickMaxAgeMs: parsePositiveInteger(currentConfig.HYNIX_NXT_TICK_MAX_AGE_MS, 10_000),
  };
}

function hasKisCredentials(sourceConfig) {
  return Boolean(sourceConfig?.appKey && sourceConfig?.appSecret);
}

function binaryToBuffer(value, fieldName) {
  if (Buffer.isBuffer(value)) return value;
  if (value?.buffer) return Buffer.from(value.buffer);
  if (value?.$binary?.base64) return Buffer.from(value.$binary.base64, 'base64');
  throw new Error(`KIS credential ${fieldName} missing binary value`);
}

function decryptKisSecret(secretKey, decoder = kisSecretDecoder || decodeSecret) {
  if (!secretKey || typeof secretKey !== 'object') {
    throw new Error('KIS credential secretKey missing');
  }
  const encryptedSecret = binaryToBuffer(secretKey.encrypted_key, 'secretKey.encrypted_key');
  const salt = binaryToBuffer(secretKey.salt, 'secretKey.salt');
  return decoder(encryptedSecret, salt, serviceConfig().DB_PASSPHRASE);
}

function normalizeKisCredentials(document, decoder = kisSecretDecoder || decodeSecret) {
  if (!document?.apiKey) throw new Error('KIS credential apiKey missing');
  return {
    appKey: document.apiKey,
    appSecret: decryptKisSecret(document.secretKey, decoder),
  };
}

async function readKisCredentialDocument(storeConfig = kisApiStoreConfig()) {
  if (kisCredentialReader) return kisCredentialReader(storeConfig);
  const db = await getDBClient();
  return db.readOneFromDatabase(storeConfig.databaseName, storeConfig.collectionName, {
    serviceName: storeConfig.serviceName,
    environment: storeConfig.environment,
  });
}

async function loadKisCredentials() {
  if (kisCredentialsCache) return kisCredentialsCache;
  if (!kisCredentialsPromise) {
    kisCredentialsPromise = readKisCredentialDocument()
      .then(document => {
        if (!document) {
          const storeConfig = kisApiStoreConfig();
          throw new Error(`KIS credential not found for ${storeConfig.serviceName}/${storeConfig.environment}`);
        }
        kisCredentialsCache = normalizeKisCredentials(document);
        return kisCredentialsCache;
      })
      .finally(() => {
        kisCredentialsPromise = null;
      });
  }
  return kisCredentialsPromise;
}

function resetKisCredentialsCache() {
  kisCredentialsCache = null;
  kisCredentialsPromise = null;
}

function parseKisTokenExpiry(payload, now = Date.now) {
  const absoluteExpiry = payload?.access_token_token_expired;
  if (absoluteExpiry) {
    const parsed = new Date(absoluteExpiry).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  const expiresInSeconds = parseNumber(payload?.expires_in);
  if (expiresInSeconds !== null) return now() + expiresInSeconds * 1000;

  return null;
}

function isKisTokenUsable(token, now = Date.now) {
  return Boolean(token?.value && Number.isFinite(token.expiresAt) && token.expiresAt - now() > KIS_TOKEN_EXPIRY_BUFFER_MS);
}

async function fetchKisAccessToken(sourceConfig, fetchImpl = fetch, now = Date.now) {
  const url = new URL(KIS_TOKEN_PATH, sourceConfig.baseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: sourceConfig.appKey,
      appsecret: sourceConfig.appSecret,
    }),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`KIS token response invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok || !payload?.access_token) {
    const message = payload?.error_description || payload?.msg1 || text || `HTTP ${response.status}`;
    throw new Error(`KIS token request failed: ${message}`);
  }

  const expiresAt = parseKisTokenExpiry(payload, now);
  if (expiresAt === null) {
    throw new Error('KIS token response missing expiry');
  }

  return {
    value: payload.access_token,
    expiresAt,
  };
}

async function getKisAccessToken(sourceConfig = kisConfig(), fetchImpl = fetch, now = Date.now) {
  if (isKisTokenUsable(kisTokenCache, now)) return kisTokenCache.value;

  if (!kisTokenPromise) {
    kisTokenPromise = fetchKisAccessToken(sourceConfig, fetchImpl, now)
      .then(token => {
        kisTokenCache = token;
        return token.value;
      })
      .finally(() => {
        kisTokenPromise = null;
      });
  }

  return kisTokenPromise;
}

function resetKisTokenCache() {
  kisTokenCache = null;
  kisTokenPromise = null;
}

function isKisApprovalKeyUsable(key, now = Date.now) {
  return Boolean(key?.value && Number.isFinite(key.expiresAt) && key.expiresAt > now());
}

async function fetchKisApprovalKey(sourceConfig, fetchImpl = fetch, now = Date.now) {
  const url = new URL(KIS_APPROVAL_PATH, sourceConfig.approvalBaseUrl);
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      accept: 'text/plain',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: sourceConfig.appKey,
      secretkey: sourceConfig.appSecret,
    }),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`KIS approval response invalid JSON: ${text.slice(0, 200)}`);
    }
  }

  if (!response.ok || !payload?.approval_key) {
    const message = payload?.error_description || payload?.msg1 || text || `HTTP ${response.status}`;
    throw new Error(`KIS approval request failed: ${message}`);
  }

  return {
    value: payload.approval_key,
    expiresAt: now() + KIS_APPROVAL_KEY_TTL_MS,
  };
}

async function getKisApprovalKey(sourceConfig = kisWsConfig(), fetchImpl = fetch, now = Date.now) {
  if (isKisApprovalKeyUsable(kisApprovalKeyCache, now)) return kisApprovalKeyCache.value;

  if (!kisApprovalKeyPromise) {
    kisApprovalKeyPromise = fetchKisApprovalKey(sourceConfig, fetchImpl, now)
      .then(key => {
        kisApprovalKeyCache = key;
        return key.value;
      })
      .finally(() => {
        kisApprovalKeyPromise = null;
      });
  }

  return kisApprovalKeyPromise;
}

function resetKisApprovalKeyCache() {
  kisApprovalKeyCache = null;
  kisApprovalKeyPromise = null;
}

async function withKisConfig(sourceConfig, unavailableReason) {
  if (sourceConfig) return sourceConfig;
  try {
    return kisConfig(await loadKisCredentials());
  } catch (error) {
    logger.warn(`[Hynix] KIS credentials failed: ${error.message}`);
    return unavailable(unavailableReason, error.message);
  }
}

async function fetchKisQuote(symbol, label, sourceConfig = null) {
  const effectiveConfig = await withKisConfig(sourceConfig, 'kis_credentials_missing');
  if (effectiveConfig.status === 'unavailable') return effectiveConfig;

  if (!hasKisCredentials(effectiveConfig)) {
    return unavailable('kis_credentials_missing');
  }

  let accessToken;
  try {
    accessToken = await getKisAccessToken(effectiveConfig);
  } catch (error) {
    logger.warn(`[Hynix] KIS token failed: ${error.message}`);
    return unavailable('kis_token_request_failed', error.message);
  }

  const url = new URL(KIS_DOMESTIC_PRICE_PATH, effectiveConfig.baseUrl);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', KIS_FID_COND_MRKT_DIV_CODE);
  url.searchParams.set('FID_INPUT_ISCD', symbol);

  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${accessToken}`,
      appkey: effectiveConfig.appKey,
      appsecret: effectiveConfig.appSecret,
      tr_id: KIS_TR_ID_REAL,
      custtype: 'P',
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable('kis_response_invalid_json', text.slice(0, 200));
    }
  }

  if (!response.ok || payload?.rt_cd === '1') {
    const message = payload?.msg1 || text || `HTTP ${response.status}`;
    logger.warn(`[Hynix] KIS quote failed for ${symbol}: ${message}`);
    return unavailable('kis_request_failed', message);
  }

  return normalizeKisQuote(symbol, label, payload);
}

async function fetchKisEtfQuote(symbol, label, sourceConfig = null) {
  const effectiveConfig = await withKisConfig(sourceConfig, 'kis_credentials_missing');
  if (effectiveConfig.status === 'unavailable') return effectiveConfig;

  if (!hasKisCredentials(effectiveConfig)) {
    return unavailable('kis_credentials_missing');
  }

  let accessToken;
  try {
    accessToken = await getKisAccessToken(effectiveConfig);
  } catch (error) {
    logger.warn(`[Hynix] KIS token failed: ${error.message}`);
    return unavailable('kis_token_request_failed', error.message);
  }

  const url = new URL(KIS_ETF_PRICE_PATH, effectiveConfig.baseUrl);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', KIS_FID_COND_MRKT_DIV_CODE);
  url.searchParams.set('FID_INPUT_ISCD', symbol);

  const response = await fetch(url, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${accessToken}`,
      appkey: effectiveConfig.appKey,
      appsecret: effectiveConfig.appSecret,
      tr_id: KIS_ETF_TR_ID_REAL,
      custtype: 'P',
    },
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable('kis_etf_response_invalid_json', text.slice(0, 200));
    }
  }

  if (!response.ok || payload?.rt_cd === '1') {
    const message = payload?.msg1 || text || `HTTP ${response.status}`;
    logger.warn(`[Hynix] KIS ETF quote failed for ${symbol}: ${message}`);
    return unavailable('kis_etf_request_failed', message);
  }

  return normalizeKisEtfQuote(symbol, label, payload);
}

function normalizeCurrentForex(payload) {
  if (!Array.isArray(payload) || !payload[0]) return unavailable('current_forex_response_missing');
  const price = parseNumber(payload[0].basePrice);
  if (price === null) return unavailable('current_forex_price_missing');
  return {
    status: 'ok',
    source: 'upbit-forex',
    label: 'Current forex',
    currency: 'KRW/USD',
    price,
    timestamp: payload[0].date && payload[0].time ? `${payload[0].date}T${payload[0].time}` : null,
    fetchedAt: nowIso(),
  };
}

async function fetchCurrentForex() {
  if (!serviceConfig().UPBIT_FOREX_URL) return unavailable('current_forex_url_missing');
  const response = await fetch(serviceConfig().UPBIT_FOREX_URL);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable('current_forex_response_invalid_json', text.slice(0, 200));
    }
  }
  if (!response.ok) return unavailable('current_forex_request_failed', text || `HTTP ${response.status}`);
  return normalizeCurrentForex(payload);
}

function normalizeUpbitUsdt(payload) {
  if (!Array.isArray(payload) || !payload[0]) return unavailable('upbit_usdt_response_missing');
  const price = parseNumber(payload[0].trade_price);
  if (price === null) return unavailable('upbit_usdt_price_missing');
  return {
    status: 'ok',
    source: 'upbit',
    label: 'Upbit USDT/KRW',
    currency: 'KRW/USDT',
    price,
    timestamp: payload[0].trade_timestamp ? new Date(payload[0].trade_timestamp).toISOString() : null,
    fetchedAt: nowIso(),
  };
}

async function fetchUpbitUsdt() {
  const response = await fetch(UPBIT_USDT_MARKET_URL);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      return unavailable('upbit_usdt_response_invalid_json', text.slice(0, 200));
    }
  }
  if (!response.ok) return unavailable('upbit_usdt_request_failed', text || `HTTP ${response.status}`);
  return normalizeUpbitUsdt(payload);
}

function sidecarToken() {
  return jwt.sign({ userId: 'hynix-service', type: 'extension', sub: 'hynix-service' }, serviceConfig().JWT_SECRET, { expiresIn: '1m' });
}

function normalizeHyperliquidSidecarTicker(ticker, symbol) {
  if (!ticker || typeof ticker !== 'object') return unavailable('hyperliquid_sidecar_ticker_missing');

  const price = parseNumber(ticker.c);
  if (price === null) return unavailable('hyperliquid_price_missing');

  return {
    status: 'ok',
    source: 'hyperliquid_f_sidecar',
    symbol: ticker.base || symbol,
    label: 'Hyperliquid sidecar',
    currency: 'USD',
    price,
    timestamp: Number.isFinite(ticker.timestamp_ms) ? new Date(ticker.timestamp_ms).toISOString() : null,
    fetchedAt: nowIso(),
  };
}

function fetchSidecarTicker(command, options = {}) {
  const sourceConfig = options.sourceConfig || {
    sidecarUrl: serviceConfig().SIDECAR_URL,
    timeoutMs: 800,
  };
  if (!sourceConfig.sidecarUrl) return Promise.resolve(unavailable('sidecar_url_missing'));

  const WebSocketImpl = options.WebSocketImpl || WebSocket;
  const token = options.token || options.sidecarToken || sidecarToken();

  return new Promise(resolve => {
    let settled = false;
    let sawMissingTicker = false;
    let retryTimer = null;
    const socket = new WebSocketImpl(sourceConfig.sidecarUrl);
    const timer = setTimeout(() => settle(sawMissingTicker
      ? unavailable('hyperliquid_sidecar_ticker_missing')
      : unavailable('hyperliquid_sidecar_timeout')), sourceConfig.timeoutMs);

    function sendTickerCommand() {
      if (!settled) socket.send(JSON.stringify(command));
    }

    function scheduleTickerRetry() {
      if (settled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        sendTickerCommand();
      }, 25);
    }

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      if (socket.close) socket.close();
      resolve(result);
    }

    socket.on('open', () => {
      socket.send(token);
    });

    socket.on('message', message => {
      const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
      if (text === 'AUTH_OK') {
        sendTickerCommand();
        return;
      }
      if (text === 'AUTH_FAILED') {
        settle(unavailable('hyperliquid_sidecar_auth_failed'));
        return;
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }

      if (payload.cmd !== command.cmd) return;
      if (payload.type === 'api_error') {
        settle(unavailable('hyperliquid_sidecar_api_error', payload.error || null));
        return;
      }
      if (!payload.data) {
        sawMissingTicker = true;
        scheduleTickerRetry();
        return;
      }
      settle(normalizeHyperliquidSidecarTicker(payload.data, command.base));
    });

    socket.on('error', error => {
      settle(unavailable('hyperliquid_sidecar_error', error.message));
    });
  });
}

async function fetchHyperliquidSidecar(options = {}) {
  return fetchSidecarTicker({
    cmd: 'ticker',
    exchange: 'hyperliquid_f',
    base: HYNIX_HYPERLIQUID_SYMBOL,
    quote: 'USDC',
  }, options);
}

function kisNxtTimestamp(businessDate, tradeTime) {
  const date = String(businessDate || '');
  const time = String(tradeTime || '').slice(0, 6);
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) return null;
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`;
}

function normalizeKisNxtTick(symbol, fields) {
  if (!Array.isArray(fields) || fields[0] !== symbol) return null;
  const price = parseNumber(fields[2]);
  if (price === null || price <= 0) return null;

  return {
    status: 'ok',
    source: 'kis_nxt_ws',
    symbol,
    label: 'SK hynix NXT',
    currency: 'KRW',
    price,
    timestamp: kisNxtTimestamp(fields[33], fields[1]),
    fetchedAt: nowIso(),
    raw: {
      tradeTime: fields[1] || null,
      businessDate: fields[33] || null,
      change: parseNumber(fields[4]),
      changeRatePct: parseNumber(fields[5]),
      open: parseNumber(fields[7]),
      high: parseNumber(fields[8]),
      low: parseNumber(fields[9]),
      volume: parseNumber(fields[13]),
    },
  };
}

function parseKisNxtFrame(message, expectedSymbol) {
  const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
  if (!text || (text[0] !== '0' && text[0] !== '1')) return null;

  const parts = text.split('|');
  if (parts[1] !== KIS_NXT_TR_ID || !parts[3]) return null;

  return normalizeKisNxtTick(expectedSymbol, parts[3].split('^'));
}

function parseKisNxtControlFrame(message, expectedSymbol) {
  const text = Buffer.isBuffer(message) ? message.toString('utf8') : String(message || '');
  if (!text || text[0] === '0' || text[0] === '1') return null;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  if (payload?.header?.tr_id !== KIS_NXT_TR_ID || payload?.header?.tr_key !== expectedSymbol) return null;
  if (payload?.body?.rt_cd === '0') {
    return { status: 'subscribed', message: payload.body.msg1 || null };
  }

  return {
    status: 'error',
    reason: 'kis_nxt_subscription_failed',
    message: payload?.body?.msg1 || text.slice(0, 200),
  };
}

function resolveKisNxtWsUrl(sourceConfig) {
  if (!sourceConfig.wsUrl) return null;
  const url = new URL(sourceConfig.wsUrl);
  if (url.protocol === 'wss:') return String(url);
  if (url.protocol === 'ws:' && sourceConfig.allowInsecure) return String(url);
  throw new Error('KIS NXT websocket URL must use secure transport unless KIS_WS_ALLOW_INSECURE=true');
}

function notifyKisNxtWaiters(symbol, quote) {
  const waiters = kisNxtState.waitersBySymbol.get(symbol);
  if (!waiters) return;
  kisNxtState.waitersBySymbol.delete(symbol);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(quote);
  }
}

function cacheKisNxtQuote(symbol, quote, now = Date.now) {
  kisNxtState.latestBySymbol.set(symbol, { quote, receivedAt: now() });
  notifyKisNxtWaiters(symbol, quote);
}

function freshKisNxtQuote(symbol, sourceConfig = kisWsConfig(), now = Date.now) {
  const cached = kisNxtState.latestBySymbol.get(symbol);
  if (!cached) return null;
  if (now() - cached.receivedAt > sourceConfig.tickMaxAgeMs) return null;
  return cached.quote;
}

function waitForKisNxtTick(symbol, timeoutMs) {
  return new Promise(resolve => {
    const waiter = {
      resolve,
      timer: setTimeout(() => {
        const current = kisNxtState.waitersBySymbol.get(symbol) || [];
        const remaining = current.filter(item => item !== waiter);
        if (remaining.length > 0) {
          kisNxtState.waitersBySymbol.set(symbol, remaining);
        } else {
          kisNxtState.waitersBySymbol.delete(symbol);
        }
        resolve(null);
      }, timeoutMs),
    };
    const waiters = kisNxtState.waitersBySymbol.get(symbol) || [];
    waiters.push(waiter);
    kisNxtState.waitersBySymbol.set(symbol, waiters);
  });
}

async function ensureKisNxtSubscription(symbol, options = {}) {
  let sourceConfig = options.sourceConfig;
  try {
    sourceConfig = sourceConfig || kisWsConfig(await loadKisCredentials());
  } catch (error) {
    logger.warn(`[Hynix] KIS credentials failed: ${error.message}`);
    return unavailable('kis_credentials_missing', error.message);
  }
  if (!hasKisCredentials(sourceConfig)) return unavailable('kis_credentials_missing');
  if (!sourceConfig.wsUrl) return unavailable('kis_nxt_ws_url_missing');
  if (kisNxtState.socket || kisNxtState.connectingPromise) return kisNxtState.connectingPromise || null;

  kisNxtState.connectingPromise = (async () => {
    let approvalKey;
    try {
      approvalKey = await getKisApprovalKey(sourceConfig, options.fetchImpl || fetch, options.now || Date.now);
    } catch (error) {
      return unavailable('kis_nxt_approval_failed', error.message);
    }

    const WebSocketImpl = options.WebSocketImpl || WebSocket;
    const socket = new WebSocketImpl(resolveKisNxtWsUrl(sourceConfig));
    kisNxtState.socket = socket;

    socket.on('open', () => {
      socket.send(JSON.stringify({
        header: {
          approval_key: approvalKey,
          custtype: 'P',
          tr_type: '1',
          'content-type': 'utf-8',
        },
        body: {
          input: {
            tr_id: KIS_NXT_TR_ID,
            tr_key: symbol,
          },
        },
      }));
    });

    socket.on('message', message => {
      const quote = parseKisNxtFrame(message, symbol);
      if (quote) {
        cacheKisNxtQuote(symbol, quote, options.now || Date.now);
        return;
      }

      const control = parseKisNxtControlFrame(message, symbol);
      if (control) kisNxtState.subscriptionBySymbol.set(symbol, control);
    });

    socket.on('error', error => {
      logger.warn(`[Hynix] KIS NXT websocket error: ${error.message}`);
    });

    socket.on('close', () => {
      if (kisNxtState.socket === socket) kisNxtState.socket = null;
    });
  })()
    .catch(error => unavailable('kis_nxt_ws_connect_failed', error.message))
    .finally(() => {
      kisNxtState.connectingPromise = null;
    });

  return kisNxtState.connectingPromise;
}

async function getLatestKisNxtQuote(symbol, options = {}) {
  let sourceConfig = options.sourceConfig;
  try {
    sourceConfig = sourceConfig || kisWsConfig(await loadKisCredentials());
  } catch (error) {
    logger.warn(`[Hynix] KIS credentials failed: ${error.message}`);
    return unavailable('kis_credentials_missing', error.message);
  }
  const now = options.now || Date.now;
  const cached = freshKisNxtQuote(symbol, sourceConfig, now);
  if (cached) return cached;

  const tickPromise = waitForKisNxtTick(symbol, sourceConfig.tickTimeoutMs);
  let connectionResult;
  try {
    connectionResult = await ensureKisNxtSubscription(symbol, { ...options, sourceConfig, now });
  } catch (error) {
    logger.warn(`[Hynix] KIS NXT websocket setup failed: ${error.message}`);
    return unavailable('kis_nxt_ws_connect_failed', error.message);
  }
  if (connectionResult?.status === 'unavailable') return connectionResult;

  const quote = await tickPromise;
  if (quote) return quote;

  const stale = kisNxtState.latestBySymbol.get(symbol);
  if (stale) return unavailable('kis_nxt_tick_stale');

  const subscription = kisNxtState.subscriptionBySymbol.get(symbol);
  if (subscription?.status === 'subscribed') return unavailable('kis_nxt_no_trade_tick', subscription.message);
  if (subscription?.status === 'error') return unavailable(subscription.reason, subscription.message);
  return unavailable('kis_nxt_tick_timeout');
}

function resetKisNxtCache() {
  if (kisNxtState.socket?.close) kisNxtState.socket.close();
  kisNxtState.socket = null;
  kisNxtState.connectingPromise = null;
  kisNxtState.latestBySymbol.clear();
  kisNxtState.waitersBySymbol.clear();
  kisNxtState.subscriptionBySymbol.clear();
}

function calculatePercentSpread(krwPrice, usdPrice, fxRate) {
  if (![krwPrice, usdPrice, fxRate].every(Number.isFinite) || krwPrice === 0) return null;
  return ((usdPrice * fxRate) - krwPrice) / krwPrice * 100;
}

function buildEtfUnderlyingLikeQuote(etfQuote, anchorQuote) {
  if (etfQuote.status !== 'ok') return unavailable('etf_underlying_like_etf_unavailable', etfQuote.reason || null);
  if (anchorQuote.status !== 'ok') return unavailable('etf_underlying_like_anchor_unavailable', anchorQuote.reason || null);

  const nav = etfQuote.raw?.nav;
  const previousFinalNav = etfQuote.raw?.previousFinalNav;
  if (![nav, previousFinalNav, anchorQuote.price].every(Number.isFinite) || nav <= 0 || previousFinalNav <= 0 || anchorQuote.price <= 0) {
    return unavailable('etf_underlying_like_invalid_inputs');
  }

  const navReturn = (nav / previousFinalNav) - 1;
  const underlyingReturn = navReturn / HYNIX_ETF_LEVERAGE;
  const unroundedPrice = anchorQuote.price * (1 + underlyingReturn);
  if (!Number.isFinite(unroundedPrice) || unroundedPrice <= 0) return unavailable('etf_underlying_like_invalid_result');

  return {
    status: 'ok',
    source: 'kis_etf_nav_derived',
    symbol: etfQuote.symbol,
    label: `${etfQuote.label} underlying-like`,
    currency: 'KRW',
    price: Math.round(unroundedPrice),
    timestamp: etfQuote.timestamp,
    fetchedAt: nowIso(),
    raw: {
      nav,
      previousFinalNav,
      leverage: HYNIX_ETF_LEVERAGE,
      navReturn,
      underlyingReturn,
      unroundedPrice,
      anchorPrice: anchorQuote.price,
      anchorTimestamp: anchorQuote.timestamp,
    },
  };
}

function buildSpread(name, koreanQuote, hyperliquidQuote, fxQuote) {
  if (koreanQuote.status !== 'ok') return unavailable(`${name}_korean_price_unavailable`, koreanQuote.reason || null);
  if (hyperliquidQuote.status !== 'ok') return unavailable(`${name}_hyperliquid_unavailable`, hyperliquidQuote.reason || null);
  if (fxQuote.status !== 'ok') return unavailable(`${name}_fx_unavailable`, fxQuote.reason || null);

  const percent = calculatePercentSpread(koreanQuote.price, hyperliquidQuote.price, fxQuote.price);
  if (percent === null) return unavailable(`${name}_spread_invalid_inputs`);

  return {
    status: 'ok',
    name,
    percent,
    koreanPriceKrw: koreanQuote.price,
    hyperliquidPriceUsd: hyperliquidQuote.price,
    fxKrwPerUsd: fxQuote.price,
  };
}

function buildSpreadGroup(fxName, prices, fxQuote) {
  return {
    regularMarket: buildSpread(`${fxName}_regular_market`, prices.regularMarket, prices.hyperliquid, fxQuote),
    nxt: buildSpread(`${fxName}_nxt`, prices.nxt, prices.hyperliquid, fxQuote),
    etf: buildSpread(`${fxName}_etf`, prices.etfUnderlyingLike, prices.hyperliquid, fxQuote),
  };
}

function symbols() {
  const currentConfig = serviceConfig();
  return {
    skHynix: currentConfig.HYNIX_SK_HYNIX_SYMBOL || DEFAULT_SYMBOLS.skHynix,
    etf: currentConfig.HYNIX_ETF_SYMBOL,
    etfName: currentConfig.HYNIX_ETF_NAME || 'KODEX SK하이닉스단일종목레버리지',
  };
}

export async function getHynixSnapshot(options = {}) {
  const selectedSymbols = symbols();
  const [regularMarket, nxt, etf, hyperliquid, currentForex, upbitUsdt] = await Promise.all([
    fetchKisQuote(selectedSymbols.skHynix, 'SK hynix regular market'),
    getLatestKisNxtQuote(selectedSymbols.skHynix),
    selectedSymbols.etf
      ? fetchKisEtfQuote(selectedSymbols.etf, selectedSymbols.etfName)
      : Promise.resolve(unavailable('etf_symbol_missing', 'Set HYNIX_ETF_SYMBOL after verifying the official KRX code')),
    fetchHyperliquidSidecar(options),
    fetchCurrentForex(),
    fetchUpbitUsdt(),
  ]);
  const etfUnderlyingLike = buildEtfUnderlyingLikeQuote(etf, regularMarket);

  return {
    fetchedAt: nowIso(),
    refreshIntervalMs: 2000,
    symbols: selectedSymbols,
    prices: {
      regularMarket,
      nxt,
      etf,
      etfUnderlyingLike,
      hyperliquid,
    },
    forex: {
      current: currentForex,
      upbitUsdt,
    },
    spreads: {
      currentForex: buildSpreadGroup('current_forex', { regularMarket, nxt, etfUnderlyingLike, hyperliquid }, currentForex),
      upbitUsdt: buildSpreadGroup('upbit_usdt', { regularMarket, nxt, etfUnderlyingLike, hyperliquid }, upbitUsdt),
    },
  };
}

function setHynixTestOverrides(overrides) {
  hynixTestOverrides = overrides;
}

function setKisCredentialTestOverrides({ reader = null, decoder = null } = {}) {
  kisCredentialReader = reader;
  kisSecretDecoder = decoder;
  resetKisCredentialsCache();
}

export const __test__ = {
  buildEtfUnderlyingLikeQuote,
  buildSpreadGroup,
  defaultKisApiStoreDb,
  cacheKisNxtQuote,
  calculatePercentSpread,
  fetchKisAccessToken,
  fetchKisApprovalKey,
  fetchKisEtfQuote,
  fetchHyperliquidSidecar,
  fetchSidecarTicker,
  freshKisNxtQuote,
  normalizeHyperliquidSidecarTicker,
  normalizeKisEtfQuote,
  getKisAccessToken,
  loadKisCredentials,
  normalizeKisCredentials,
  getKisApprovalKey,
  getLatestKisNxtQuote,
  hasKisCredentials,
  normalizeKisNxtTick,
  normalizeKisQuote,
  parseKisNxtFrame,
  parseKisTokenExpiry,
  resetKisApprovalKeyCache,
  resetKisCredentialsCache,
  resetKisNxtCache,
  resetKisTokenCache,
  resolveKisNxtWsUrl,
  setHynixTestOverrides,
  setKisCredentialTestOverrides,
};
