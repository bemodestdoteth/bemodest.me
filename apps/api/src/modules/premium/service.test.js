import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-chars';
process.env.PREMIUM_CANDLES_URL = 'https://premium-candles.test';

const { __test__, getPremiumCandles } = await import('./service.js');
const { buildBatchCandleRequests, buildPremiumSeries, buildTargets, getRecommendedAction, notListedMessage, validatePremiumRequest } = __test__;

function candle(time, close = 10) {
  return {
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  };
}

function source(candles) {
  return { candles };
}

test('buildPremiumSeries aligns exact timestamps', () => {
  const result = buildPremiumSeries(
    source([candle(120, 120)]),
    source([candle(120, 12)]),
    source([candle(120, 10)]),
    '1m',
  );

  assert.equal(result.premiumCandles.length, 1);
  assert.equal(result.topAssetB[0].time, 120);
});

test('buildPremiumSeries uses nearest previous candles within one interval', () => {
  const result = buildPremiumSeries(
    source([candle(120, 120)]),
    source([candle(119, 12)]),
    source([candle(118, 10)]),
    '1m',
  );

  assert.equal(result.premiumCandles.length, 1);
  assert.equal(result.topAssetB[0].time, 118);
});

test('buildPremiumSeries skips stale previous candles older than one interval', () => {
  const result = buildPremiumSeries(
    source([candle(180, 120)]),
    source([candle(180, 12)]),
    source([candle(119, 10)]),
    '1m',
  );

  assert.equal(result.premiumCandles.length, 0);
  assert.equal(result.topAssetA.length, 0);
  assert.equal(result.topAssetB.length, 0);
});

test('buildPremiumSeries never uses future candles', () => {
  const result = buildPremiumSeries(
    source([candle(120, 120)]),
    source([candle(120, 12)]),
    source([candle(121, 10)]),
    '1m',
  );

  assert.equal(result.premiumCandles.length, 0);
});

test('buildPremiumSeries emits only anchors with bounded previous matches', () => {
  const result = buildPremiumSeries(
    source([candle(120, 120), candle(180, 180), candle(240, 240)]),
    source([candle(119, 12), candle(180, 18), candle(300, 30)]),
    source([candle(118, 10), candle(119, 11), candle(240, 24)]),
    '1m',
  );

  assert.deepEqual(result.topAssetA.map(item => item.time), [120, 240]);
  assert.deepEqual(result.topAssetB.map(item => item.time), [119, 240]);
  assert.equal(result.premiumCandles.length, 2);
});

function premiumRequest(overrides = {}) {
  return {
    sourceExchange: 'bithumb',
    counterpartExchange: 'bybit_f',
    symbol: 'btc',
    interval: '1m',
    lookbackBars: 500,
    exitTargetPct: null,
    ...overrides,
  };
}

test('validatePremiumRequest preserves optional time range', () => {
  const result = validatePremiumRequest(premiumRequest({ fromTime: 120, toTime: 240 }));

  assert.equal(result.symbol, 'BTC');
  assert.equal(result.fromTime, 120);
  assert.equal(result.toTime, 240);
});

test('validatePremiumRequest accepts foreign spot source exchanges', () => {
  const result = validatePremiumRequest(premiumRequest({ sourceExchange: 'binance' }));

  assert.equal(result.sourceExchange, 'binance');
});

test('validatePremiumRequest rejects futures source exchanges', () => {
  assert.throws(
    () => validatePremiumRequest(premiumRequest({ sourceExchange: 'bybit_f' })),
    /unsupported sourceExchange: bybit_f/,
  );
});

test('validatePremiumRequest accepts toTime without fromTime for visible reload lookback', () => {
  const result = validatePremiumRequest(premiumRequest({ toTime: 240 }));

  assert.equal(result.fromTime, undefined);
  assert.equal(result.toTime, 240);
});

test('validatePremiumRequest accepts requests without time range', () => {
  const result = validatePremiumRequest(premiumRequest());

  assert.equal(result.fromTime, undefined);
  assert.equal(result.toTime, undefined);
});

test('validatePremiumRequest accepts fromTime without toTime', () => {
  const result = validatePremiumRequest(premiumRequest({ fromTime: 120 }));

  assert.equal(result.fromTime, 120);
  assert.equal(result.toTime, undefined);
});

test('validatePremiumRequest rejects invalid time ranges', () => {
  assert.throws(
    () => validatePremiumRequest(premiumRequest({ fromTime: Number.NaN, toTime: 240 })),
    /fromTime must be a finite number/,
  );
  assert.throws(
    () => validatePremiumRequest(premiumRequest({ fromTime: 240, toTime: 120 })),
    /fromTime must be less than toTime/,
  );
});

test('buildBatchCandleRequests includes fx for KRW source exchanges', () => {
  const request = validatePremiumRequest(premiumRequest({ fromTime: 120, toTime: 240 }));
  const result = buildBatchCandleRequests(request);

  assert.deepEqual(result.map(item => item.key), ['assetA', 'fx', 'assetB']);
  assert.deepEqual(result.map(item => item.fromTime), [120, 120, 120]);
  assert.deepEqual(result.map(item => item.toTime), [240, 240, 240]);
});

test('buildBatchCandleRequests omits fx for foreign spot source exchanges', () => {
  const request = validatePremiumRequest(premiumRequest({ sourceExchange: 'binance', toTime: 240 }));
  const result = buildBatchCandleRequests(request);

  assert.deepEqual(result.map(item => item.key), ['assetA', 'assetB']);
  assert.deepEqual(result.map(item => item.exchange), ['binance', 'bybit_f']);
  assert.deepEqual(result.map(item => item.fromTime), [undefined, undefined]);
  assert.deepEqual(result.map(item => item.toTime), [240, 240]);
});

test('notListedMessage does not attribute ambiguous foreign spot source failures to counterpart', () => {
  const request = validatePremiumRequest(premiumRequest({ sourceExchange: 'binance', counterpartExchange: 'bybit_f' }));

  assert.equal(notListedMessage(request, 'Code not found'), null);
});

test('notListedMessage attributes KRW source generic failures to counterpart', () => {
  const request = validatePremiumRequest(premiumRequest({ counterpartExchange: 'bybit_f' }));

  assert.equal(notListedMessage(request, 'Code not found'), 'BTC is not listed on Bybit Futures');
});

test('getPremiumCandles reports upstream fetch failures with service context', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      () => getPremiumCandles(premiumRequest({ sourceExchange: 'kraken', counterpartExchange: 'binance_f', symbol: 'M' })),
      /premium candle service request failed: fetch failed/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildTargets compares latest premium spread against entry target', () => {
  const targets = buildTargets(
    {
      premiumLine: [
        { time: 120, value: 0.5 },
        { time: 180, value: 1.25 },
      ],
    },
    null,
    { entryTargetPct: 1 },
  );

  assert.equal(targets.entryTargetPct, 1);
  assert.equal(targets.currentUsdtSpreadPct, 1.25);
  assert.notEqual(targets.currentUsdtSpreadPct, targets.entryTargetPct);
  assert.equal(targets.recommendedAction.status, 'long');
});

test('getRecommendedAction recommends long Hyperliquid above target', () => {
  const action = getRecommendedAction(1.25, 1);

  assert.equal(action.status, 'long');
  assert.equal(action.side, 'long_hyperliquid');
  assert.equal(action.label, 'Long Hyperliquid');
  assert.equal(action.deltaPct, 0.25);
});

test('getRecommendedAction recommends short Hyperliquid below target', () => {
  const action = getRecommendedAction(0.75, 1);

  assert.equal(action.status, 'short');
  assert.equal(action.side, 'short_hyperliquid');
  assert.equal(action.label, 'Short Hyperliquid');
  assert.equal(action.deltaPct, -0.25);
});

test('getRecommendedAction recommends neutral when spread equals target', () => {
  const action = getRecommendedAction(1, 1);

  assert.equal(action.status, 'neutral');
  assert.equal(action.side, 'neutral');
  assert.equal(action.label, 'Neutral/Wait');
  assert.equal(action.deltaPct, 0);
});

test('getRecommendedAction returns null for missing data', () => {
  assert.equal(getRecommendedAction(null, 1), null);
  assert.equal(getRecommendedAction(1, undefined), null);
  assert.equal(getRecommendedAction(Number.NaN, 1), null);
});
