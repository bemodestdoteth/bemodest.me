import {
  createEvmPublicClient,
  createEvmRpcFallbackTransport,
  defineEvmViemChain,
  getEvmChainConfig,
  getServiceEvmWallets,
  validateKnownErc20TokenAddress,
} from '@bemodest/core';
import { createOkxAdapter } from '@bemodest/exchange-okx';
import { createWalletClient, getAddress, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  createOrLockForwardRequest,
  markForwardRequestConfirmed,
  markForwardRequestFailed,
  markForwardRequestSubmitted,
} from './service.js';

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
];

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },
];

export class ChainForwardHarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChainForwardHarnessError';
  }
}

export async function runChainForwardingHarness(input, dependencies = {}) {
  const options = normalizeInput(input);
  const deps = harnessDependencies(dependencies);
  const destinationExchange = options.destinationExchange.toLowerCase();
  const lockOwner = options.lockOwner ?? `chain-forward-cli:${process.pid}`;

  const chainConfig = await deps.getEvmChainConfig({ caip2: options.caip2 });
  const publicClient = deps.createEvmPublicClient(chainConfig);
  const walletRecord = await resolveSingleWallet(options, destinationExchange, deps);
  const safeWallet = safeWalletView(walletRecord);
  const token = options.assetKind === 'erc20'
    ? await deps.validateKnownErc20TokenAddress({
      caip2: options.caip2,
      tokenAddress: options.tokenAddress,
    })
    : null;
  const operationId = options.operationId ?? buildOperationId({
    ...options,
    destinationExchange,
    tokenAddress: token?.tokenAddress,
  });
  const plan = await buildForwardingPlan({
    options,
    chainConfig,
    publicClient,
    wallet: safeWallet,
    token,
  });

  const baseReport = {
    mode: options.apply ? 'apply' : 'dry-run',
    ready: plan.ready,
    operationId,
    target: {
      walletLabel: safeWallet.walletLabel,
      walletAddress: safeWallet.address,
      caip2: chainConfig.caip2,
      chainId: chainConfig.chainId,
      chainName: chainConfig.name,
      assetKind: options.assetKind,
      destinationExchange,
      destinationAddress: safeWallet.exchangeDepositAddress,
      tokenAddress: token?.tokenAddress,
      tokenSymbol: token?.symbol,
      tokenDecimals: token?.decimals,
    },
    plan,
    state: null,
    txHash: null,
    receipt: null,
    errors: [...plan.blockers],
  };

  if (!options.apply) return baseReport;
  if (!plan.ready) return { ...baseReport, ready: false };

  await verifyApplyDestination(options, safeWallet, chainConfig, deps);

  const lockResult = await deps.createOrLockForwardRequest({
    operationId,
    lockOwner,
    walletLabel: safeWallet.walletLabel,
    caip2: chainConfig.caip2,
    assetKind: options.assetKind,
    destinationExchange,
    destinationAddress: safeWallet.exchangeDepositAddress,
    tokenAddress: token?.tokenAddress,
  });

  const lockedReport = {
    ...baseReport,
    state: {
      outcome: lockResult.outcome,
      status: lockResult.operation?.status,
    },
  };

  if (lockResult.outcome === 'locked') {
    return {
      ...lockedReport,
      ready: false,
      errors: ['operation is locked by another owner'],
    };
  }

  if (lockResult.outcome === 'terminal') {
    return {
      ...lockedReport,
      ready: false,
      errors: [`operation is terminal: ${lockResult.operation.status}`],
    };
  }

  if (lockResult.operation.status === 'submitted') {
    return handleSubmittedOperation({
      report: lockedReport,
      operation: lockResult.operation,
      operationId,
      lockOwner,
      waitReceipt: options.waitReceipt,
      publicClient,
      deps,
    });
  }

  try {
    const txHash = await submitForwardingTransaction({
      options,
      chainConfig,
      walletRecord,
      safeWallet,
      token,
      plan,
      deps,
    });
    await deps.markForwardRequestSubmitted({ operationId, lockOwner, txHash });

    const submittedReport = {
      ...lockedReport,
      state: { ...lockedReport.state, status: 'submitted' },
      txHash,
    };

    if (!options.waitReceipt) return submittedReport;
    return confirmSubmittedTransaction({
      report: submittedReport,
      operationId,
      lockOwner,
      txHash,
      publicClient,
      deps,
    });
  } catch (error) {
    const failureReason = safeFailureReason(error, walletRecord.privateKey);
    await deps.markForwardRequestFailed({ operationId, lockOwner, failureReason });
    return {
      ...lockedReport,
      ready: false,
      errors: [failureReason],
      state: { ...lockedReport.state, status: 'failed' },
    };
  }
}

export function buildOperationId(input) {
  const parts = [
    'chain-forward',
    requiredString(input.environment, 'environment'),
    requiredString(input.serviceName, 'serviceName'),
    requiredString(input.destinationExchange, 'destinationExchange').toLowerCase(),
    requiredString(input.walletLabel, 'walletLabel'),
    requiredString(input.caip2, 'caip2'),
    requiredAssetKind(input.assetKind),
  ];
  if (input.assetKind === 'erc20') parts.push(requiredString(input.tokenAddress, 'tokenAddress'));
  return parts.join(':');
}

function normalizeInput(input) {
  const options = {
    walletLabel: requiredString(input.walletLabel, 'walletLabel'),
    caip2: requiredCaip2(input.caip2),
    assetKind: requiredAssetKind(input.assetKind),
    destinationExchange: requiredString(input.destinationExchange, 'destinationExchange'),
    serviceName: requiredString(input.serviceName, 'serviceName'),
    environment: requiredString(input.environment, 'environment'),
    operationId: input.operationId ? requiredString(input.operationId, 'operationId') : undefined,
    tokenAddress: input.tokenAddress,
    currency: input.currency,
    lockOwner: input.lockOwner,
    apply: input.apply === true,
    waitReceipt: input.waitReceipt !== false,
  };

  if (options.assetKind === 'erc20') {
    options.tokenAddress = requiredAddress(input.tokenAddress, 'tokenAddress');
  } else if (input.tokenAddress !== undefined && input.tokenAddress !== null) {
    throw new ChainForwardHarnessError('tokenAddress is only valid with assetKind=erc20.');
  }

  if (options.apply) {
    requiredString(options.operationId, 'operationId');
    requiredString(options.currency, 'currency');
    if (options.destinationExchange.toLowerCase() !== 'okx') {
      throw new ChainForwardHarnessError('apply mode currently requires destinationExchange=okx.');
    }
  }

  return options;
}

function harnessDependencies(dependencies) {
  return {
    getEvmChainConfig: dependencies.getEvmChainConfig ?? getEvmChainConfig,
    createEvmPublicClient: dependencies.createEvmPublicClient ?? createEvmPublicClient,
    getServiceEvmWallets: dependencies.getServiceEvmWallets ?? getServiceEvmWallets,
    validateKnownErc20TokenAddress: dependencies.validateKnownErc20TokenAddress ?? validateKnownErc20TokenAddress,
    createOkxAdapter: dependencies.createOkxAdapter ?? createOkxAdapter,
    createWalletClient: dependencies.createWalletClient ?? createDefaultWalletClient,
    privateKeyToAccount: dependencies.privateKeyToAccount ?? privateKeyToAccount,
    createOrLockForwardRequest: dependencies.createOrLockForwardRequest ?? createOrLockForwardRequest,
    markForwardRequestSubmitted: dependencies.markForwardRequestSubmitted ?? markForwardRequestSubmitted,
    markForwardRequestConfirmed: dependencies.markForwardRequestConfirmed ?? markForwardRequestConfirmed,
    markForwardRequestFailed: dependencies.markForwardRequestFailed ?? markForwardRequestFailed,
  };
}

async function resolveSingleWallet(options, destinationExchange, deps) {
  const wallets = await deps.getServiceEvmWallets(
    options.serviceName,
    options.environment,
    destinationExchange,
  );
  const matches = wallets.filter(wallet => wallet.walletLabel === options.walletLabel);
  if (matches.length === 0) throw new ChainForwardHarnessError(`No wallet found for walletLabel=${options.walletLabel}.`);
  if (matches.length > 1) throw new ChainForwardHarnessError(`Multiple wallets found for walletLabel=${options.walletLabel}.`);

  const wallet = matches[0];
  return {
    walletLabel: requiredString(wallet.walletLabel, 'walletLabel'),
    address: requiredAddress(wallet.address, 'wallet.address'),
    privateKey: requiredString(wallet.privateKey, 'wallet.privateKey'),
    exchangeDepositAddress: requiredAddress(wallet.exchangeDepositAddress, 'wallet.exchangeDepositAddress'),
  };
}

function safeWalletView(wallet) {
  return {
    walletLabel: wallet.walletLabel,
    address: wallet.address,
    exchangeDepositAddress: wallet.exchangeDepositAddress,
  };
}

async function buildForwardingPlan({ options, chainConfig, publicClient, wallet, token }) {
  const gasReserveWei = parseWeiPolicy(chainConfig.forwarding.gasReserveWei, 'gasReserveWei');
  const dustThresholdWei = parseWeiPolicy(chainConfig.forwarding.dustThresholdWei, 'dustThresholdWei');
  const nativeBalance = await publicClient.getBalance({ address: wallet.address });
  const blockers = [];
  let amount = 0n;
  let tokenBalance = null;

  if (options.assetKind === 'native') {
    if (nativeBalance <= gasReserveWei + dustThresholdWei) {
      blockers.push('native balance is not above gas reserve plus dust threshold');
    } else {
      amount = nativeBalance - gasReserveWei;
    }
  } else {
    if (nativeBalance < gasReserveWei) blockers.push('native balance is below configured gas reserve');
    tokenBalance = await publicClient.readContract({
      address: token.tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [wallet.address],
    });
    if (tokenBalance <= 0n) blockers.push('ERC20 token balance is zero');
    else amount = tokenBalance;
  }

  return {
    ready: blockers.length === 0,
    assetKind: options.assetKind,
    amount: amount.toString(),
    nativeBalance: nativeBalance.toString(),
    gasReserveWei: gasReserveWei.toString(),
    dustThresholdWei: dustThresholdWei.toString(),
    tokenBalance: tokenBalance === null ? null : tokenBalance.toString(),
    blockers,
  };
}

async function verifyApplyDestination(options, wallet, chainConfig, deps) {
  const adapter = deps.createOkxAdapter({ environment: options.environment });
  await adapter.verifyDepositAddress({
    currency: options.currency,
    wallet,
    chainConfig,
  });
}

async function submitForwardingTransaction({ options, chainConfig, walletRecord, safeWallet, token, plan, deps }) {
  const account = deps.privateKeyToAccount(normalizePrivateKey(walletRecord.privateKey));
  const walletClient = deps.createWalletClient({ account, chainConfig });
  const amount = BigInt(plan.amount);

  if (options.assetKind === 'native') {
    return walletClient.sendTransaction({
      account,
      chain: defineEvmViemChain(chainConfig),
      to: safeWallet.exchangeDepositAddress,
      value: amount,
    });
  }

  return walletClient.writeContract({
    account,
    chain: defineEvmViemChain(chainConfig),
    address: token.tokenAddress,
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [safeWallet.exchangeDepositAddress, amount],
  });
}

async function handleSubmittedOperation({ report, operation, operationId, lockOwner, waitReceipt, publicClient, deps }) {
  const txHash = operation.txHash ?? null;
  if (!waitReceipt || !txHash) {
    return {
      ...report,
      txHash,
      state: { ...report.state, status: 'submitted' },
    };
  }

  return confirmSubmittedTransaction({
    report: { ...report, txHash, state: { ...report.state, status: 'submitted' } },
    operationId,
    lockOwner,
    txHash,
    publicClient,
    deps,
  });
}

async function confirmSubmittedTransaction({ report, operationId, lockOwner, txHash, publicClient, deps }) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === 'success') {
    await deps.markForwardRequestConfirmed({
      operationId,
      lockOwner,
      receipt: safeReceipt(receipt),
    });
    return {
      ...report,
      receipt: safeReceipt(receipt),
      state: { ...report.state, status: 'confirmed' },
    };
  }

  const failureReason = `transaction receipt status=${receipt.status}`;
  await deps.markForwardRequestFailed({ operationId, lockOwner, failureReason });
  return {
    ...report,
    ready: false,
    receipt: safeReceipt(receipt),
    state: { ...report.state, status: 'failed' },
    errors: [failureReason],
  };
}

function createDefaultWalletClient({ account, chainConfig }) {
  return createWalletClient({
    account,
    chain: defineEvmViemChain(chainConfig),
    transport: createEvmRpcFallbackTransport(chainConfig),
  });
}

function safeReceipt(receipt) {
  return {
    status: receipt.status,
    transactionHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber?.toString(),
  };
}

function safeFailureReason(error, privateKey) {
  let message = error instanceof Error ? error.message : String(error);
  if (privateKey) {
    message = message.split(privateKey).join('[REDACTED_PRIVATE_KEY]');
    message = message.split(normalizePrivateKey(privateKey)).join('[REDACTED_PRIVATE_KEY]');
  }
  return message.slice(0, 500);
}

function parseWeiPolicy(value, fieldName) {
  try {
    return BigInt(requiredString(value, fieldName));
  } catch {
    throw new ChainForwardHarnessError(`${fieldName} must be a bigint-compatible decimal string.`);
  }
}

function normalizePrivateKey(privateKey) {
  return privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
}

function requiredString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ChainForwardHarnessError(`${fieldName} is required.`);
  }
  return value;
}

function requiredCaip2(value) {
  const caip2 = requiredString(value, 'caip2');
  if (!/^eip155:\d+$/.test(caip2)) {
    throw new ChainForwardHarnessError('caip2 must be an EVM CAIP-2 id like eip155:1.');
  }
  return caip2;
}

function requiredAssetKind(value) {
  if (value === 'native' || value === 'erc20') return value;
  throw new ChainForwardHarnessError('assetKind must be native or erc20.');
}

function requiredAddress(value, fieldName) {
  const address = requiredString(value, fieldName);
  if (!isAddress(address, { strict: false })) {
    throw new ChainForwardHarnessError(`${fieldName} must be a valid EVM address.`);
  }
  return getAddress(address);
}
