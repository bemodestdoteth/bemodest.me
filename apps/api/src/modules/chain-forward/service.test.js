import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChainForwardRequestTransitionError,
  createOrLockForwardRequest,
  markForwardRequestConfirmed,
  markForwardRequestFailed,
  markForwardRequestSubmitted,
} from './service.js';

const CONFIG = { COLLECTION_CHAIN_FORWARD_REQUESTS: 'chainForwardRequests' };
const NOW = new Date('2026-06-28T00:00:00.000Z');
const LATER = new Date('2026-06-28T00:01:00.000Z');

function forwardRequest(overrides = {}) {
  return {
    operationId: 'op-1',
    lockOwner: 'worker-a',
    walletLabel: 'service-wallet-1',
    caip2: 'eip155:1',
    assetKind: 'native',
    destinationExchange: 'OKX',
    destinationAddress: '0x0000000000000000000000000000000000000001',
    lockTtlMs: 300000,
    ...overrides,
  };
}

function dependencies(db, now = () => NOW) {
  return { db, now, config: CONFIG };
}

test('createOrLockForwardRequest creates a locked pending operation', async () => {
  const db = new FakeForwardRequestDb();

  const result = await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  assert.equal(result.outcome, 'created');
  assert.equal(result.operation.operationId, 'op-1');
  assert.equal(result.operation.status, 'pending');
  assert.deepEqual(result.operation.lock, {
    owner: 'worker-a',
    expiresAt: '2026-06-28T00:05:00.000Z',
  });
  assert.equal(result.operation.request.walletLabel, 'service-wallet-1');
  assert.equal(result.operation.request.assetKind, 'native');
});

test('createOrLockForwardRequest returns an existing terminal operation unchanged', async () => {
  const terminal = {
    operationId: 'op-1',
    status: 'confirmed',
    txHash: '0xabc',
    lock: { owner: 'worker-a', expiresAt: '2026-06-28T00:05:00.000Z' },
  };
  const db = new FakeForwardRequestDb([terminal]);

  const result = await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  assert.equal(result.outcome, 'terminal');
  assert.equal(result.operation.status, 'confirmed');
  assert.equal(result.operation.txHash, '0xabc');
});

test('createOrLockForwardRequest reports a non-expired active lock held by another owner', async () => {
  const active = {
    operationId: 'op-1',
    status: 'pending',
    lock: { owner: 'worker-b', expiresAt: '2026-06-28T00:05:00.000Z' },
  };
  const db = new FakeForwardRequestDb([active]);

  const result = await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  assert.equal(result.outcome, 'locked');
  assert.deepEqual(result.operation.lock, active.lock);
});

test('createOrLockForwardRequest acquires an expired active lock', async () => {
  const db = new FakeForwardRequestDb([
    {
      operationId: 'op-1',
      status: 'pending',
      createdAt: '2026-06-27T23:55:00.000Z',
      lock: { owner: 'worker-b', expiresAt: '2026-06-27T23:59:59.000Z' },
    },
  ]);

  const result = await createOrLockForwardRequest(forwardRequest(), dependencies(db, () => LATER));

  assert.equal(result.outcome, 'locked_by_caller');
  assert.deepEqual(result.operation.lock, {
    owner: 'worker-a',
    expiresAt: '2026-06-28T00:06:00.000Z',
  });
});

test('submitted, confirmed, and failed transitions require valid prior state and active lock owner', async () => {
  const db = new FakeForwardRequestDb();
  await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  const submitted = await markForwardRequestSubmitted(
    { operationId: 'op-1', lockOwner: 'worker-a', txHash: '0xabc' },
    dependencies(db),
  );
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.txHash, '0xabc');
  assert.equal(submitted.submittedAt, '2026-06-28T00:00:00.000Z');

  await assert.rejects(
    () => markForwardRequestSubmitted(
      { operationId: 'op-1', lockOwner: 'worker-a', txHash: '0xdef' },
      dependencies(db),
    ),
    ChainForwardRequestTransitionError,
  );

  const confirmed = await markForwardRequestConfirmed(
    { operationId: 'op-1', lockOwner: 'worker-a', receipt: { status: 'success' } },
    dependencies(db),
  );
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.receipt, { status: 'success' });

  await assert.rejects(
    () => markForwardRequestFailed(
      { operationId: 'op-1', lockOwner: 'worker-a', failureReason: 'already terminal' },
      dependencies(db),
    ),
    ChainForwardRequestTransitionError,
  );
});

test('markForwardRequestFailed terminalizes pending operations with sanitized reason', async () => {
  const db = new FakeForwardRequestDb();
  await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  const failed = await markForwardRequestFailed(
    { operationId: 'op-1', lockOwner: 'worker-a', failureReason: `secret-free ${'x'.repeat(600)}` },
    dependencies(db),
  );

  assert.equal(failed.status, 'failed');
  assert.equal(failed.failureReason.length, 500);
  assert.equal(failed.failedAt, '2026-06-28T00:00:00.000Z');
});

test('state transitions reject callers that do not hold the active lock', async () => {
  const db = new FakeForwardRequestDb();
  await createOrLockForwardRequest(forwardRequest(), dependencies(db));

  await assert.rejects(
    () => markForwardRequestSubmitted(
      { operationId: 'op-1', lockOwner: 'worker-b', txHash: '0xabc' },
      dependencies(db),
    ),
    ChainForwardRequestTransitionError,
  );
});

class FakeForwardRequestDb {
  constructor(initialDocuments = []) {
    this.documents = new Map(initialDocuments.map(document => {
      const stored = { _id: document.operationId, ...clone(document) };
      return [stored.operationId, stored];
    }));
  }

  async readOne(_collectionName, query) {
    for (const document of this.documents.values()) {
      if (matchesQuery(document, query)) return document;
    }
    return null;
  }

  async findOneAndUpdate(_collectionName, query, update, options = {}) {
    let current = null;
    for (const document of this.documents.values()) {
      if (matchesQuery(document, query)) {
        current = document;
        break;
      }
    }

    if (!current && options.upsert) {
      const operationId = query._id ?? query.operationId;
      current = { _id: operationId, operationId };
      this.documents.set(operationId, current);
    }

    if (!current) return null;
    if (Array.isArray(update)) applyPipelineUpdate(current, update);
    else {
      applySetOnInsert(current, update.$setOnInsert ?? {});
      applySet(current, update.$set ?? {});
    }
    return current;
  }
}

function matchesQuery(document, query) {
  return Object.entries(query).every(([field, expected]) => {
    if (field === '$or') return expected.some(branch => matchesQuery(document, branch));
    const actual = getPath(document, field);
    return matchesValue(actual, expected);
  });
}

function matchesValue(actual, expected) {
  if (isOperatorObject(expected)) {
    return Object.entries(expected).every(([operator, value]) => {
      if (operator === '$in') return value.includes(actual);
      if (operator === '$nin') return !value.includes(actual);
      if (operator === '$ne') return actual !== value;
      if (operator === '$gt') return actual > value;
      if (operator === '$lte') return actual <= value;
      if (operator === '$exists') return value ? actual !== undefined : actual === undefined;
      throw new Error(`Unsupported test query operator: ${operator}`);
    });
  }
  return actual === expected;
}

function isOperatorObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some(key => key.startsWith('$'));
}

function getPath(document, path) {
  return path.split('.').reduce((value, segment) => value?.[segment], document);
}

function applyPipelineUpdate(document, pipeline) {
  for (const stage of pipeline) {
    if (stage.$set) {
      const evaluated = {};
      for (const [path, expression] of Object.entries(stage.$set)) {
        evaluated[path] = evaluateExpression(document, expression);
      }
      applySet(document, evaluated);
      continue;
    }
    throw new Error('Unsupported test pipeline stage');
  }
}

function evaluateExpression(document, expression) {
  if (typeof expression === 'string' && expression.startsWith('$')) return getPath(document, expression.slice(1));
  if (!isOperatorObject(expression)) return clone(expression);
  if (Object.hasOwn(expression, '$ifNull')) {
    const [candidate, fallback] = expression.$ifNull;
    const value = evaluateExpression(document, candidate);
    return value === null || value === undefined ? evaluateExpression(document, fallback) : value;
  }
  if (Object.hasOwn(expression, '$cond')) {
    const [condition, truthy, falsy] = expression.$cond;
    return evaluateExpression(document, condition) ? evaluateExpression(document, truthy) : evaluateExpression(document, falsy);
  }
  if (Object.hasOwn(expression, '$or')) return expression.$or.some(item => evaluateExpression(document, item));
  if (Object.hasOwn(expression, '$and')) return expression.$and.every(item => evaluateExpression(document, item));
  if (Object.hasOwn(expression, '$in')) {
    const [candidate, values] = expression.$in;
    return values.includes(evaluateExpression(document, candidate));
  }
  if (Object.hasOwn(expression, '$ne')) {
    const [left, right] = expression.$ne;
    return evaluateExpression(document, left) !== evaluateExpression(document, right);
  }
  if (Object.hasOwn(expression, '$gt')) {
    const [left, right] = expression.$gt;
    return evaluateExpression(document, left) > evaluateExpression(document, right);
  }
  throw new Error('Unsupported test pipeline expression');
}

function applySetOnInsert(document, patch) {
  applySet(document, patch);
}

function applySet(document, patch) {
  for (const [path, value] of Object.entries(patch)) {
    setPath(document, path, clone(value));
  }
}

function setPath(document, path, value) {
  if (path === '_id') {
    document._id = value;
    return;
  }
  if (path === 'lock') {
    document.lock = value;
    return;
  }
  if (path === 'status') {
    document.status = value;
    return;
  }
  if (path === 'txHash') {
    document.txHash = value;
    return;
  }
  if (path === 'receipt') {
    document.receipt = value;
    return;
  }
  if (path === 'failureReason') {
    document.failureReason = value;
    return;
  }
  if (path === 'createdAt') {
    document.createdAt = value;
    return;
  }
  if (path === 'updatedAt') {
    document.updatedAt = value;
    return;
  }
  if (path === 'submittedAt') {
    document.submittedAt = value;
    return;
  }
  if (path === 'confirmedAt') {
    document.confirmedAt = value;
    return;
  }
  if (path === 'failedAt') {
    document.failedAt = value;
    return;
  }
  if (path === 'operationId') {
    document.operationId = value;
    return;
  }
  if (path === 'request') {
    document.request = value;
    return;
  }
  throw new Error(`Unsupported test update path: ${path}`);
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}
