import { validateApiConfig } from '@bemodest/config';
import { logger } from '@bemodest/utils';

const config = validateApiConfig();

const SUPPORTED_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};
const SUPPORTED_KOREAN_EXCHANGES = new Set(['bithumb', 'upbit']);
const FOREIGN_EXCHANGE_METADATA = {
  binance: { displayName: 'Binance Spot', market: 'spot', quote: 'USDT' },
  bybit: { displayName: 'Bybit Spot', market: 'spot', quote: 'USDT' },
  bitget: { displayName: 'Bitget Spot', market: 'spot', quote: 'USDT' },
  mexc: { displayName: 'MEXC Spot', market: 'spot', quote: 'USDT' },
  gateio: { displayName: 'Gate.io Spot', market: 'spot', quote: 'USDT' },
  kucoin: { displayName: 'KuCoin Spot', market: 'spot', quote: 'USDT' },
  cryptocom: { displayName: 'Crypto.com Spot', market: 'spot', quote: 'USDT' },
  huobi: { displayName: 'Huobi Spot', market: 'spot', quote: 'USDT' },
  coinbase: { displayName: 'Coinbase Spot', market: 'spot', quote: 'USD' },
  kraken: { displayName: 'Kraken Spot', market: 'spot', quote: 'USD' },
  bybit_f: { displayName: 'Bybit Futures', market: 'futures', quote: 'USDT' },
  binance_f: { displayName: 'Binance Futures', market: 'futures', quote: 'USDT' },
  bitget_f: { displayName: 'Bitget Futures', market: 'futures', quote: 'USDT' },
  okx_f: { displayName: 'OKX Futures', market: 'futures', quote: 'USDT' },
  hyperliquid_f: { displayName: 'Hyperliquid Futures', market: 'futures', quote: 'USDT' },
};
const SUPPORTED_FOREIGN_EXCHANGES = new Set(Object.keys(FOREIGN_EXCHANGE_METADATA));
const LOOKBACK_PRESETS = new Set([300, 500, 1000, 2000]);
const MAX_LOOKBACK_BARS = 5000;
const UPBIT_USDT_MARKET = 'KRW-USDT';
const ENTRY_TARGET_CACHE_TTL_MS = 30000;
const EXCHANGE_DISPLAY_NAMES = {
  bithumb: 'Bithumb',
  upbit: 'Upbit',
  ...Object.fromEntries(Object.entries(FOREIGN_EXCHANGE_METADATA).map(([key, metadata]) => [key, metadata.displayName])),
};

let entryTargetCache = null;

function requireString(body, key) {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing field: ${key}`);
  }
  return value;
}

function parseLookbackBars(body) {
  const value = body.lookbackBars;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LOOKBACK_BARS) {
    throw new Error('lookbackBars must be an integer between 1 and 5000');
  }
  return value;
}

function parseOptionalTimeRange(body) {
  const hasFromTime = body.fromTime !== null && body.fromTime !== undefined;
  const hasToTime = body.toTime !== null && body.toTime !== undefined;
  if (!hasFromTime && !hasToTime) return {};

  const timeRange = {};
  if (hasFromTime) {
    const fromTime = Number(body.fromTime);
    if (!Number.isFinite(fromTime)) {
      throw new Error('fromTime must be a finite number');
    }
    timeRange.fromTime = fromTime;
  }
  if (hasToTime) {
    const toTime = Number(body.toTime);
    if (!Number.isFinite(toTime)) {
      throw new Error('toTime must be a finite number');
    }
    timeRange.toTime = toTime;
  }
  if (hasFromTime && hasToTime && timeRange.fromTime >= timeRange.toTime) {
    throw new Error('fromTime must be less than toTime');
  }

  return timeRange;
}

export function validatePremiumRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('request body must be an object');
  }

  const koreanExchange = requireString(body, 'koreanExchange');
  const foreignExchange = requireString(body, 'foreignExchange');
  const symbol = requireString(body, 'symbol').toUpperCase();
  const interval = requireString(body, 'interval');
  const lookbackBars = parseLookbackBars(body);
  const timeRange = parseOptionalTimeRange(body);
  const exitTargetPct = body.exitTargetPct === null || body.exitTargetPct === undefined
    ? null
    : Number(body.exitTargetPct);

  if (!SUPPORTED_KOREAN_EXCHANGES.has(koreanExchange)) {
    throw new Error(`unsupported koreanExchange: ${koreanExchange}`);
  }
  if (!SUPPORTED_FOREIGN_EXCHANGES.has(foreignExchange)) {
    throw new Error(`unsupported foreignExchange: ${foreignExchange}`);
  }
  if (!SUPPORTED_INTERVALS.has(interval)) {
    throw new Error(`unsupported interval: ${interval}`);
  }
  if (!LOOKBACK_PRESETS.has(lookbackBars)) {
    throw new Error('lookbackBars must be one of: 300, 500, 1000, 2000');
  }
  if (exitTargetPct !== null && !Number.isFinite(exitTargetPct)) {
    throw new Error('exitTargetPct must be a finite number or null');
  }

  return {
    koreanExchange,
    foreignExchange,
    symbol,
    interval,
    lookbackBars,
    ...timeRange,
    exitTargetPct,
  };
}

function buildBatchCandleRequestItem(request, item) {
  return {
    ...item,
    interval: request.interval,
    lookbackBars: request.lookbackBars,
    ...(request.fromTime !== undefined ? { fromTime: request.fromTime } : {}),
    ...(request.toTime !== undefined ? { toTime: request.toTime } : {}),
  };
}

function buildBatchCandleRequests(request) {
  const foreignMetadata = FOREIGN_EXCHANGE_METADATA[request.foreignExchange];

  return [
    buildBatchCandleRequestItem(request, {
      key: 'assetA',
      exchange: request.koreanExchange,
      market: 'spot',
      symbol: request.symbol,
      quote: 'KRW',
    }),
    buildBatchCandleRequestItem(request, {
      key: 'fx',
      exchange: request.koreanExchange,
      market: 'spot',
      symbol: 'USDT',
      quote: 'KRW',
    }),
    buildBatchCandleRequestItem(request, {
      key: 'assetB',
      exchange: request.foreignExchange,
      market: foreignMetadata.market,
      symbol: request.symbol,
      quote: foreignMetadata.quote,
    }),
  ];
}

async function fetchBatchCandles(request) {
  if (!config.PREMIUM_CANDLES_URL) {
    throw new Error('PREMIUM_CANDLES_URL is required');
  }

  const response = await fetch(`${config.PREMIUM_CANDLES_URL}/batch-candles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: buildBatchCandleRequests(request),
    }),
  });

  const bodyText = await response.text();
  let payload = null;
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.error || bodyText || 'premium candle service request failed';
    const listedMessage = notListedMessage(request, String(message));
    throw new Error(listedMessage || `premium candle service request failed: ${response.status} ${message}`);
  }
  if (!payload?.results) {
    throw new Error('premium candle service response is missing results');
  }
  return payload.results;
}

function timeIndex(candles) {
  const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
  return {
    candles: sortedCandles,
    times: sortedCandles.map(candle => candle.time),
  };
}

function findNearestPreviousCandle(index, anchorTime, maxDriftSeconds) {
  let left = 0;
  let right = index.times.length - 1;
  let matchIndex = -1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (index.times[mid] <= anchorTime) {
      matchIndex = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  if (matchIndex === -1) {
    return null;
  }

  const candle = index.candles[matchIndex];
  if (anchorTime - candle.time > maxDriftSeconds) {
    return null;
  }
  return candle;
}

function premiumValue(assetKrw, fxKrw, referenceUsdt) {
  return ((assetKrw / fxKrw - referenceUsdt) / referenceUsdt) * 100;
}

function buildPremiumSeries(assetA, fx, assetB, interval) {
  const maxDriftSeconds = INTERVAL_SECONDS[interval];
  if (!maxDriftSeconds) {
    throw new Error(`unsupported interval: ${interval}`);
  }

  const fxIndex = timeIndex(fx.candles);
  const assetBIndex = timeIndex(assetB.candles);
  const premiumCandles = [];
  const premiumLine = [];
  const topAssetA = [];
  const topAssetB = [];

  for (const a of assetA.candles) {
    const fxCandle = findNearestPreviousCandle(fxIndex, a.time, maxDriftSeconds);
    const b = findNearestPreviousCandle(assetBIndex, a.time, maxDriftSeconds);
    if (!fxCandle || !b) {
      continue;
    }

    const premiumCandle = {
      time: a.time,
      open: premiumValue(a.open, fxCandle.open, b.open),
      high: premiumValue(a.high, fxCandle.high, b.high),
      low: premiumValue(a.low, fxCandle.low, b.low),
      close: premiumValue(a.close, fxCandle.close, b.close),
    };

    premiumCandles.push(premiumCandle);
    premiumLine.push({ time: a.time, value: premiumCandle.close });
    topAssetA.push(a);
    topAssetB.push(b);
  }

  return { premiumCandles, premiumLine, topAssetA, topAssetB };
}

function parseFiniteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function formatExchangeName(exchange) {
  return EXCHANGE_DISPLAY_NAMES[exchange] || exchange;
}

function notListedMessage(request, upstreamMessage) {
  if (!upstreamMessage.includes('Code not found')) {
    return null;
  }

  if (upstreamMessage.includes('Upbit get_ohlcv')) {
    return `${request.symbol} is not listed on ${formatExchangeName(request.koreanExchange)}`;
  }

  if (upstreamMessage.includes('Bithumb get_ohlcv')) {
    return `${request.symbol} is not listed on ${formatExchangeName(request.koreanExchange)}`;
  }

  if (SUPPORTED_FOREIGN_EXCHANGES.has(request.foreignExchange)) {
    return `${request.symbol} is not listed on ${formatExchangeName(request.foreignExchange)}`;
  }

  return null;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`request failed: ${url}`);
  }
  return payload;
}

async function fetchUsdKrw() {
  if (!config.UPBIT_FOREX_URL) {
    throw new Error('UPBIT_FOREX_URL is required');
  }

  const payload = await fetchJson(config.UPBIT_FOREX_URL);
  if (!Array.isArray(payload) || !payload[0]) {
    throw new Error('UPBIT_FOREX_URL response must contain at least one rate');
  }

  return parseFiniteNumber(payload[0].basePrice, 'USD/KRW basePrice');
}

async function fetchUpbitUsdtKrw() {
  const payload = await fetchJson('https://api.upbit.com/v1/ticker?markets=KRW-USDT');
  if (!Array.isArray(payload)) {
    throw new Error('Upbit ticker response must be an array');
  }

  const ticker = payload.find(item => item && item.market === UPBIT_USDT_MARKET);
  if (!ticker) {
    throw new Error('Upbit KRW-USDT ticker is missing');
  }

  return parseFiniteNumber(ticker.trade_price, 'Upbit USDT/KRW trade_price');
}

function getRecommendedAction(currentUsdtSpreadPct, entryTargetPct) {
  if (!Number.isFinite(currentUsdtSpreadPct) || !Number.isFinite(entryTargetPct)) {
    return null;
  }

  const deltaPct = currentUsdtSpreadPct - entryTargetPct;
  if (deltaPct > 0) {
    return {
      side: 'long_hyperliquid',
      status: 'long',
      label: 'Long Hyperliquid',
      detail: 'Current USDT spread is above target.',
      deltaPct,
    };
  }
  if (deltaPct < 0) {
    return {
      side: 'short_hyperliquid',
      status: 'short',
      label: 'Short Hyperliquid',
      detail: 'Current USDT spread is below target.',
      deltaPct,
    };
  }
  return {
    side: 'neutral',
    status: 'neutral',
    label: 'Neutral/Wait',
    detail: 'Current USDT spread matches target.',
    deltaPct,
  };
}

async function getEntryTargetSnapshot() {
  const now = Date.now();
  if (entryTargetCache && entryTargetCache.expiresAt > now) {
    return entryTargetCache.value;
  }

  const [usdKrw, upbitUsdtKrw] = await Promise.all([fetchUsdKrw(), fetchUpbitUsdtKrw()]);
  const value = {
    entryTargetPct: ((upbitUsdtKrw - usdKrw) / usdKrw) * 100,
  };
  entryTargetCache = { value, expiresAt: now + ENTRY_TARGET_CACHE_TTL_MS };
  return value;
}

function buildTargets(series, exitTargetPct, targetSnapshot) {
  const entryTargetPct = targetSnapshot?.entryTargetPct ?? null;
  const currentUsdtSpreadPct = series.premiumLine.at(-1)?.value ?? null;
  const recommendedAction = getRecommendedAction(currentUsdtSpreadPct, entryTargetPct);

  return {
    entryTargetPct,
    currentUsdtSpreadPct,
    exitTargetPct,
    recommendedAction,
  };
}

export const __test__ = {
  buildBatchCandleRequests,
  buildPremiumSeries,
  buildTargets,
  findNearestPreviousCandle,
  getRecommendedAction,
  timeIndex,
  validatePremiumRequest,
};

export async function getPremiumCandles(body) {
  const request = validatePremiumRequest(body);
  const results = await fetchBatchCandles(request);
  const series = buildPremiumSeries(results.assetA, results.fx, results.assetB, request.interval);
  let targetSnapshot = null;
  try {
    targetSnapshot = await getEntryTargetSnapshot();
  } catch (error) {
    logger.warn('[Premium] Failed to fetch entry target', error);
  }
  const targets = buildTargets(series, request.exitTargetPct, targetSnapshot);

  return {
    request,
    top: {
      assetA: series.topAssetA,
      assetB: series.topAssetB,
    },
    premium: {
      candles: series.premiumCandles,
      line: series.premiumLine,
    },
    targets,
    meta: {
      alignedBars: series.premiumCandles.length,
      degraded: series.premiumCandles.length === 0,
    },
  };
}
