import { validateApiConfig } from '@bemodest/config';
import { getDBClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';

const ACTIVE_STATUSES = new Set(['pending', 'submitted']);
const TERMINAL_STATUSES = new Set(['confirmed', 'failed']);
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

export class ChainForwardRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChainForwardRequestError';
  }
}

export class ChainForwardRequestLockedError extends ChainForwardRequestError {
  constructor(operation) {
    super(`Chain forward request ${operation.operationId} is locked by another owner.`);
    this.name = 'ChainForwardRequestLockedError';
    this.operation = operation;
  }
}

export class ChainForwardRequestTransitionError extends ChainForwardRequestError {
  constructor(message, operation = null) {
    super(message);
    this.name = 'ChainForwardRequestTransitionError';
    this.operation = operation;
  }
}

export async function createOrLockForwardRequest(input, dependencies = {}) {
  const now = isoNow(dependencies.now);
  const lockOwner = requiredString(input.lockOwner, 'lockOwner');
  const lockExpiresAt = addMs(now, input.lockTtlMs ?? DEFAULT_LOCK_TTL_MS);
  const collectionName = chainForwardRequestsCollection(dependencies.config);
  const operationId = requiredString(input.operationId, 'operationId');
  const request = buildRequestSnapshot(input);
  const db = await chainForwardRequestsDb(dependencies);

  const operation = await db.findOneAndUpdate(
    collectionName,
    { _id: operationId },
    [
      {
        $set: {
          _id: { $ifNull: ['$_id', operationId] },
          operationId: { $ifNull: ['$operationId', operationId] },
          request: { $ifNull: ['$request', request] },
          status: { $ifNull: ['$status', 'pending'] },
          createdAt: { $ifNull: ['$createdAt', now] },
          lock: {
            $cond: [
              {
                $or: [
                  { $in: ['$status', ['confirmed', 'failed']] },
                  {
                    $and: [
                      { $in: ['$status', ['pending', 'submitted']] },
                      { $ne: ['$lock.owner', lockOwner] },
                      { $gt: ['$lock.expiresAt', now] },
                    ],
                  },
                ],
              },
              '$lock',
              { owner: lockOwner, expiresAt: lockExpiresAt },
            ],
          },
          updatedAt: {
            $cond: [
              {
                $or: [
                  { $in: ['$status', ['confirmed', 'failed']] },
                  {
                    $and: [
                      { $in: ['$status', ['pending', 'submitted']] },
                      { $ne: ['$lock.owner', lockOwner] },
                      { $gt: ['$lock.expiresAt', now] },
                    ],
                  },
                ],
              },
              '$updatedAt',
              now,
            ],
          },
        },
      },
    ],
    { upsert: true, returnDocument: 'after' },
  );

  if (!operation) {
    throw new ChainForwardRequestError(`Failed to create or lock chain forward request ${operationId}.`);
  }

  if (TERMINAL_STATUSES.has(operation.status)) return { outcome: 'terminal', operation };
  if (operation.lock?.owner !== lockOwner) return { outcome: 'locked', operation };

  logger.info('Chain forward request lock acquired: {}', operationId);
  return { outcome: operation.createdAt === now ? 'created' : 'locked_by_caller', operation };
}

export async function markForwardRequestSubmitted(input, dependencies = {}) {
  const now = isoNow(dependencies.now);
  const operation = await transitionForwardRequest(
    input,
    dependencies,
    { status: 'pending' },
    {
      status: 'submitted',
      txHash: requiredString(input.txHash, 'txHash'),
      submittedAt: now,
      updatedAt: now,
    },
    now,
  );
  logger.info('Chain forward request submitted: {}', input.operationId);
  return operation;
}

export async function markForwardRequestConfirmed(input, dependencies = {}) {
  const now = isoNow(dependencies.now);
  const operation = await transitionForwardRequest(
    input,
    dependencies,
    { status: 'submitted' },
    {
      status: 'confirmed',
      receipt: input.receipt ?? null,
      confirmedAt: now,
      updatedAt: now,
    },
    now,
  );
  logger.info('Chain forward request confirmed: {}', input.operationId);
  return operation;
}

export async function markForwardRequestFailed(input, dependencies = {}) {
  const now = isoNow(dependencies.now);
  const operation = await transitionForwardRequest(
    input,
    dependencies,
    { status: { $in: ['pending', 'submitted'] } },
    {
      status: 'failed',
      failureReason: sanitizeFailureReason(requiredString(input.failureReason, 'failureReason')),
      failedAt: now,
      updatedAt: now,
    },
    now,
  );
  logger.info('Chain forward request failed: {}', input.operationId);
  return operation;
}

async function transitionForwardRequest(input, dependencies, statusFilter, patch, now) {
  const operationId = requiredString(input.operationId, 'operationId');
  const lockOwner = requiredString(input.lockOwner, 'lockOwner');
  const collectionName = chainForwardRequestsCollection(dependencies.config);
  const db = await chainForwardRequestsDb(dependencies);

  const operation = await db.findOneAndUpdate(
    collectionName,
    {
      operationId,
      ...statusFilter,
      'lock.owner': lockOwner,
      'lock.expiresAt': { $gt: now },
    },
    { $set: patch },
    { returnDocument: 'after' },
  );

  if (operation) return operation;

  const current = await db.readOne(collectionName, { operationId });
  throw new ChainForwardRequestTransitionError(
    `Invalid chain forward request transition for ${operationId}.`,
    current,
  );
}

function buildRequestSnapshot(input) {
  const request = {
    walletLabel: requiredString(input.walletLabel, 'walletLabel'),
    caip2: requiredString(input.caip2, 'caip2'),
    assetKind: requiredAssetKind(input.assetKind),
    destinationExchange: requiredString(input.destinationExchange, 'destinationExchange'),
    destinationAddress: requiredString(input.destinationAddress, 'destinationAddress'),
  };

  if (input.tokenAddress !== undefined && input.tokenAddress !== null) {
    request.tokenAddress = requiredString(input.tokenAddress, 'tokenAddress');
  }

  return request;
}

async function chainForwardRequestsDb(dependencies) {
  if (dependencies.db) return dependencies.db;
  return getDBClient();
}

function chainForwardRequestsCollection(config) {
  if (config?.COLLECTION_CHAIN_FORWARD_REQUESTS) return config.COLLECTION_CHAIN_FORWARD_REQUESTS;
  return validateApiConfig().COLLECTION_CHAIN_FORWARD_REQUESTS;
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChainForwardRequestError(`${fieldName} is required.`);
  }
  return value;
}

function requiredAssetKind(value) {
  if (value === 'native' || value === 'erc20') return value;
  throw new ChainForwardRequestError('assetKind must be native or erc20.');
}

function isoNow(now) {
  const value = now ? now() : new Date();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new ChainForwardRequestError('now must return a valid Date.');
  }
  return value.toISOString();
}

function addMs(isoTimestamp, ms) {
  return new Date(new Date(isoTimestamp).getTime() + ms).toISOString();
}

function sanitizeFailureReason(reason) {
  return reason.slice(0, 500);
}

export const __test__ = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  DEFAULT_LOCK_TTL_MS,
};
