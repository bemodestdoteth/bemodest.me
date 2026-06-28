import assert from 'node:assert/strict';
import test from 'node:test';

import { runChainForwardingHarness } from './harness.js';

const WALLET_ADDRESS = '0x0000000000000000000000000000000000000001';
const DESTINATION_ADDRESS = '0x0000000000000000000000000000000000000002';
const TOKEN_ADDRESS = '0x0000000000000000000000000000000000000003';
const PRIVATE_KEY = 'abc123secret';
const TX_HASH = '0xabc';

function input(overrides = {}) {
  return {
    walletLabel: 'service-wallet-1',
    caip2: 'eip155:1',
    assetKind: 'native',
    destinationExchange: 'okx',
    serviceName: 'forwarder',
    environment: 'dev',
    ...overrides,
  };
}

function chainConfig(overrides = {}) {
  return {
    name: 'Ethereum',
    symbol: 'ETH',
    caip2: 'eip155:1',
    chainId: 1,
    status: 'active',
    rpc: ['https://rpc.example'],
    forwarding: {
      gasReserveWei: '100',
      dustThresholdWei: '10',
    },
    annotation: { okx: 'ETH-ERC20' },
    ...overrides,
  };
}

function wallet(overrides = {}) {
  return {
    walletLabel: 'service-wallet-1',
    address: WALLET_ADDRESS,
    privateKey: PRIVATE_KEY,
    exchangeDepositAddress: DESTINATION_ADDRESS,
    ...overrides,
  };
}

function token(overrides = {}) {
  return {
    symbol: 'USDT',
    decimals: 6,
    caip2: 'eip155:1',
    tokenAddress: TOKEN_ADDRESS,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = [];
  const publicClient = {
    getBalance: async () => 1_000n,
    readContract: async () => 500n,
    waitForTransactionReceipt: async ({ hash }) => ({
      status: 'success',
      transactionHash: hash,
      blockNumber: 123n,
    }),
  };

  const walletClient = {
    sendTransaction: async payload => {
      calls.push(['sendTransaction', payload]);
      return TX_HASH;
    },
    writeContract: async payload => {
      calls.push(['writeContract', payload]);
      return TX_HASH;
    },
  };

  const deps = {
    calls,
    getEvmChainConfig: async lookup => {
      calls.push(['getEvmChainConfig', lookup]);
      return chainConfig();
    },
    createEvmPublicClient: config => {
      calls.push(['createEvmPublicClient', config.caip2]);
      return publicClient;
    },
    getServiceEvmWallets: async (serviceName, environment, exchange) => {
      calls.push(['getServiceEvmWallets', serviceName, environment, exchange]);
      return [wallet()];
    },
    validateKnownErc20TokenAddress: async lookup => {
      calls.push(['validateKnownErc20TokenAddress', lookup]);
      return token();
    },
    createOkxAdapter: options => {
      calls.push(['createOkxAdapter', options]);
      return {
        verifyDepositAddress: async payload => {
          calls.push(['verifyDepositAddress', payload.currency, payload.wallet]);
          return { currency: payload.currency, network: 'ETH-ERC20', walletLabel: payload.wallet.walletLabel };
        },
      };
    },
    privateKeyToAccount: privateKey => {
      calls.push(['privateKeyToAccount', privateKey]);
      return { address: WALLET_ADDRESS };
    },
    createWalletClient: payload => {
      calls.push(['createWalletClient', payload.account.address]);
      return walletClient;
    },
    createOrLockForwardRequest: async request => {
      calls.push(['createOrLockForwardRequest', request]);
      return { outcome: 'created', operation: { status: 'pending', operationId: request.operationId } };
    },
    markForwardRequestSubmitted: async request => {
      calls.push(['markForwardRequestSubmitted', request]);
      return { status: 'submitted', txHash: request.txHash };
    },
    markForwardRequestConfirmed: async request => {
      calls.push(['markForwardRequestConfirmed', request]);
      return { status: 'confirmed', receipt: request.receipt };
    },
    markForwardRequestFailed: async request => {
      calls.push(['markForwardRequestFailed', request]);
      return { status: 'failed', failureReason: request.failureReason };
    },
  };

  return { ...deps, ...overrides, calls };
}

function callNames(calls) {
  return calls.map(call => call[0]);
}

test('native dry-run calculates sendable amount without signer or state mutation', async () => {
  const deps = dependencies();

  const report = await runChainForwardingHarness(input(), deps);

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.ready, true);
  assert.equal(report.plan.amount, '900');
  assert.equal(report.operationId, 'chain-forward:dev:forwarder:okx:service-wallet-1:eip155:1:native');
  assert.equal(report.target.walletAddress, WALLET_ADDRESS);
  assert.equal(report.target.destinationAddress, DESTINATION_ADDRESS);
  assert.deepEqual(callNames(deps.calls).filter(name => [
    'privateKeyToAccount',
    'createWalletClient',
    'createOrLockForwardRequest',
    'sendTransaction',
    'markForwardRequestSubmitted',
  ].includes(name)), []);
});

test('native dry-run blocks when balance is below gas reserve plus dust threshold', async () => {
  const deps = dependencies({
    createEvmPublicClient: () => ({
      getBalance: async () => 110n,
      readContract: async () => 0n,
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    }),
  });

  const report = await runChainForwardingHarness(input(), deps);

  assert.equal(report.ready, false);
  assert.equal(report.plan.amount, '0');
  assert.deepEqual(report.errors, ['native balance is not above gas reserve plus dust threshold']);
  assert.equal(callNames(deps.calls).includes('sendTransaction'), false);
});

test('ERC20 dry-run validates token and plans transfer without signer or state mutation', async () => {
  const deps = dependencies();

  const report = await runChainForwardingHarness(input({
    assetKind: 'erc20',
    tokenAddress: TOKEN_ADDRESS,
  }), deps);

  assert.equal(report.ready, true);
  assert.equal(report.plan.amount, '500');
  assert.equal(report.plan.tokenBalance, '500');
  assert.equal(report.target.tokenAddress, TOKEN_ADDRESS);
  assert.equal(report.target.tokenSymbol, 'USDT');
  assert.equal(callNames(deps.calls).includes('validateKnownErc20TokenAddress'), true);
  assert.equal(callNames(deps.calls).includes('writeContract'), false);
  assert.equal(callNames(deps.calls).includes('createOrLockForwardRequest'), false);
});

test('apply mode verifies OKX destination before lock and signing', async () => {
  const deps = dependencies();

  await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-native-1',
    currency: 'ETH',
  }), deps);

  const names = callNames(deps.calls);
  assert.ok(names.indexOf('verifyDepositAddress') < names.indexOf('createOrLockForwardRequest'));
  assert.ok(names.indexOf('createOrLockForwardRequest') < names.indexOf('privateKeyToAccount'));
  assert.ok(names.indexOf('privateKeyToAccount') < names.indexOf('sendTransaction'));
});

test('apply mode sends native transaction and marks submitted then confirmed', async () => {
  const deps = dependencies();

  const report = await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-native-1',
    currency: 'ETH',
    lockOwner: 'operator-a',
  }), deps);

  assert.equal(report.ready, true);
  assert.equal(report.txHash, TX_HASH);
  assert.equal(report.state.status, 'confirmed');
  assert.deepEqual(callNames(deps.calls).filter(name => name.startsWith('markForwardRequest')), [
    'markForwardRequestSubmitted',
    'markForwardRequestConfirmed',
  ]);
  const sendCall = deps.calls.find(call => call[0] === 'sendTransaction');
  assert.equal(sendCall[1].to, DESTINATION_ADDRESS);
  assert.equal(sendCall[1].value, 900n);
});

test('apply mode sends ERC20 transfer and marks submitted then confirmed', async () => {
  const deps = dependencies();

  const report = await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-erc20-1',
    currency: 'USDT',
    assetKind: 'erc20',
    tokenAddress: TOKEN_ADDRESS,
  }), deps);

  assert.equal(report.ready, true);
  assert.equal(report.state.status, 'confirmed');
  const writeCall = deps.calls.find(call => call[0] === 'writeContract');
  assert.equal(writeCall[1].address, TOKEN_ADDRESS);
  assert.equal(writeCall[1].functionName, 'transfer');
  assert.deepEqual(writeCall[1].args, [DESTINATION_ADDRESS, 500n]);
});

test('active lock by another owner prevents signing and broadcast', async () => {
  const deps = dependencies({
    createOrLockForwardRequest: async request => {
      deps.calls.push(['createOrLockForwardRequest', request]);
      return {
        outcome: 'locked',
        operation: { status: 'pending', operationId: request.operationId, lock: { owner: 'other' } },
      };
    },
  });

  const report = await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-native-1',
    currency: 'ETH',
  }), deps);

  assert.equal(report.ready, false);
  assert.deepEqual(report.errors, ['operation is locked by another owner']);
  assert.equal(callNames(deps.calls).includes('sendTransaction'), false);
});

test('submitted operation does not rebroadcast', async () => {
  const deps = dependencies({
    createOrLockForwardRequest: async request => {
      deps.calls.push(['createOrLockForwardRequest', request]);
      return {
        outcome: 'locked_by_caller',
        operation: { status: 'submitted', operationId: request.operationId, txHash: TX_HASH },
      };
    },
  });

  const report = await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-native-1',
    currency: 'ETH',
  }), deps);

  assert.equal(report.state.status, 'confirmed');
  assert.equal(report.txHash, TX_HASH);
  assert.equal(callNames(deps.calls).includes('sendTransaction'), false);
  assert.equal(callNames(deps.calls).includes('markForwardRequestConfirmed'), true);
});

test('submission failure after lock marks operation failed with redacted reason', async () => {
  const deps = dependencies({
    createWalletClient: () => ({
      sendTransaction: async () => {
        throw new Error(`provider rejected ${PRIVATE_KEY} and 0x${PRIVATE_KEY}`);
      },
      writeContract: async () => TX_HASH,
    }),
  });

  const report = await runChainForwardingHarness(input({
    apply: true,
    operationId: 'op-native-1',
    currency: 'ETH',
  }), deps);

  assert.equal(report.ready, false);
  assert.equal(report.state.status, 'failed');
  assert.equal(JSON.stringify(report).includes(PRIVATE_KEY), false);
  const failedCall = deps.calls.find(call => call[0] === 'markForwardRequestFailed');
  assert.equal(failedCall[1].failureReason.includes(PRIVATE_KEY), false);
  assert.equal(failedCall[1].failureReason.includes('[REDACTED_PRIVATE_KEY]'), true);
});

test('private key never appears in dry-run report output', async () => {
  const deps = dependencies();

  const report = await runChainForwardingHarness(input(), deps);

  assert.equal(JSON.stringify(report).includes(PRIVATE_KEY), false);
});
