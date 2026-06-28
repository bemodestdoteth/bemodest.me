const HELP = `Usage: pnpm --filter @bemodest/api check:chain-forward-readiness -- [options]

Read-only chain forwarding readiness check.

Required:
  --wallet-label <label>           Service wallet label to check
  --caip2 <eip155:n>               EVM CAIP-2 chain id
  --asset-kind <native|erc20>      Asset kind
  --destination-exchange <name>    Destination exchange key, e.g. okx
  --service-name <name>            walletAccount serviceName
  --environment <env>              walletAccount/API credential environment

ERC20:
  --token-address <address>        Required when --asset-kind erc20

Optional probes:
  --probe-rpc                      Call getBlockNumber() on configured RPCs
  --probe-okx                      Verify OKX deposit address via external API
  --currency <symbol>              Required with --probe-okx

Output:
  --json                           Emit JSON report
  --strict                         Treat skipped optional probes as failures
  --help                           Show this message
`;

class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
    strict: false,
    probeRpc: false,
    probeOkx: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--probe-rpc') {
      options.probeRpc = true;
      continue;
    }
    if (arg === '--probe-okx') {
      options.probeOkx = true;
      continue;
    }
    if (arg === '--help') {
      options.help = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new CliError(`${arg} requires a value.`);

    if (arg === '--wallet-label') options.walletLabel = value;
    else if (arg === '--caip2') options.caip2 = value;
    else if (arg === '--asset-kind') options.assetKind = value;
    else if (arg === '--destination-exchange') options.destinationExchange = value;
    else if (arg === '--token-address') options.tokenAddress = value;
    else if (arg === '--currency') options.currency = value;
    else if (arg === '--service-name') options.serviceName = value;
    else if (arg === '--environment') options.environment = value;
    else throw new CliError(`Unknown argument: ${arg}`);

    index += 1;
  }

  return options;
}

function validateOptions(options) {
  if (options.help) return;

  requiredOption(options.walletLabel, '--wallet-label');
  requiredOption(options.caip2, '--caip2');
  requiredOption(options.assetKind, '--asset-kind');
  requiredOption(options.destinationExchange, '--destination-exchange');
  requiredOption(options.serviceName, '--service-name');
  requiredOption(options.environment, '--environment');

  if (!/^eip155:\d+$/.test(options.caip2)) throw new CliError('--caip2 must be an EVM CAIP-2 id like eip155:1.');
  if (options.assetKind !== 'native' && options.assetKind !== 'erc20') {
    throw new CliError('--asset-kind must be native or erc20.');
  }
  if (options.assetKind === 'erc20') requiredOption(options.tokenAddress, '--token-address');
  if (options.assetKind === 'native' && options.tokenAddress) {
    throw new CliError('--token-address is only valid with --asset-kind erc20.');
  }
  if (options.probeOkx) {
    requiredOption(options.currency, '--currency');
    if (options.destinationExchange.toLowerCase() !== 'okx') {
      throw new CliError('--probe-okx requires --destination-exchange okx.');
    }
  }
}

function requiredOption(value, flag) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new CliError(`${flag} is required.`);
}

function createReport(options) {
  return {
    ready: false,
    target: {
      walletLabel: options.walletLabel,
      caip2: options.caip2,
      assetKind: options.assetKind,
      destinationExchange: options.destinationExchange,
    },
    checks: [],
    warnings: [],
    errors: [],
  };
}

function pass(report, name, message, details = undefined) {
  report.checks.push({ status: 'pass', name, message, details });
}

function skip(report, name, message, strict) {
  const item = { status: 'skip', name, message };
  report.checks.push(item);
  report.warnings.push(message);
  if (strict) report.errors.push(message);
}

function fail(report, name, error) {
  const message = error instanceof Error ? error.message : String(error);
  report.checks.push({ status: 'fail', name, message });
  report.errors.push(message);
}

async function runReadinessCheck(options) {
  const { validateApiConfig } = await import('@bemodest/config');
  const { getDBClient } = await import('@bemodest/database');
  const {
    createEvmPublicClient,
    getEvmChainConfig,
    getServiceEvmWallets,
    validateKnownErc20TokenAddress,
  } = await import('@bemodest/core');
  const { createOkxAdapter } = await import('@bemodest/exchange-okx');

  const report = createReport(options);
  let chainConfig = null;
  let wallet = null;

  try {
    chainConfig = await getEvmChainConfig({ caip2: options.caip2 });
    pass(report, 'chain_config', `chain config resolved: ${chainConfig.name} chainId=${chainConfig.chainId}`, {
      name: chainConfig.name,
      caip2: chainConfig.caip2,
      chainId: chainConfig.chainId,
      rpcCount: chainConfig.rpc.length,
    });
    pass(
      report,
      'forwarding_policy',
      `forwarding policy present: gasReserveWei=${chainConfig.forwarding.gasReserveWei} dustThresholdWei=${chainConfig.forwarding.dustThresholdWei}`,
      chainConfig.forwarding,
    );
  } catch (error) {
    fail(report, 'chain_config', error);
  }

  if (chainConfig && options.probeRpc) {
    try {
      const blockNumber = await createEvmPublicClient(chainConfig).getBlockNumber();
      pass(report, 'rpc_probe', `RPC probe succeeded: blockNumber=${blockNumber.toString()}`, {
        blockNumber: blockNumber.toString(),
      });
    } catch (error) {
      fail(report, 'rpc_probe', error);
    }
  } else if (!options.probeRpc) {
    skip(report, 'rpc_probe', 'RPC probe skipped: pass --probe-rpc to check live RPC', options.strict);
  }

  try {
    const wallets = await getServiceEvmWallets(
      options.serviceName,
      options.environment,
      options.destinationExchange,
    );
    const matches = wallets.filter(candidate => candidate.walletLabel === options.walletLabel);
    if (matches.length === 0) {
      throw new Error(`No wallet found for walletLabel=${options.walletLabel}.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple wallets found for walletLabel=${options.walletLabel}.`);
    }

    const selected = matches[0];
    wallet = {
      walletLabel: selected.walletLabel,
      address: selected.address,
      exchangeDepositAddress: selected.exchangeDepositAddress,
    };
    pass(report, 'service_wallet', `service wallet resolved: ${wallet.walletLabel} ${wallet.address}`, {
      walletLabel: wallet.walletLabel,
      address: wallet.address,
    });
    pass(report, 'destination_address', `destination address configured: ${wallet.exchangeDepositAddress}`, {
      exchangeDepositAddress: wallet.exchangeDepositAddress,
    });
  } catch (error) {
    fail(report, 'service_wallet', error);
  }

  if (options.assetKind === 'native') {
    pass(report, 'asset_config', 'native asset readiness uses chain forwarding config');
  } else {
    try {
      const token = await validateKnownErc20TokenAddress({
        caip2: options.caip2,
        tokenAddress: options.tokenAddress,
      });
      pass(report, 'asset_config', `ERC20 known contract: ${token.symbol} decimals=${token.decimals}`, {
        symbol: token.symbol,
        decimals: token.decimals,
        tokenAddress: token.tokenAddress,
      });
    } catch (error) {
      fail(report, 'asset_config', error);
    }
  }

  try {
    const config = validateApiConfig();
    const db = await getDBClient();
    const collectionName = config.COLLECTION_CHAIN_FORWARD_REQUESTS;
    await db.readOne(collectionName, { operationId: '__chain_forward_readiness_probe__' });
    pass(report, 'operation_collection', `operation collection readable: ${collectionName}`, { collectionName });
  } catch (error) {
    fail(report, 'operation_collection', error);
  }

  if (options.probeOkx && chainConfig && wallet) {
    try {
      const verification = await createOkxAdapter({ environment: options.environment }).verifyDepositAddress({
        currency: options.currency,
        wallet,
        chainConfig,
      });
      pass(report, 'okx_probe', `OKX probe succeeded: ${verification.currency} ${verification.network}`, {
        currency: verification.currency,
        network: verification.network,
        walletLabel: verification.walletLabel,
      });
    } catch (error) {
      fail(report, 'okx_probe', error);
    }
  } else if (!options.probeOkx) {
    skip(report, 'okx_probe', 'OKX probe skipped: pass --probe-okx --currency <symbol> to check exchange API', options.strict);
  }

  report.ready = report.errors.length === 0;
  return report;
}

function printTextReport(report) {
  console.log('Chain Forwarding Readiness Check');
  console.log('Mode: read-only');
  console.log(
    `Target: wallet=${report.target.walletLabel} caip2=${report.target.caip2} asset=${report.target.assetKind} destination=${report.target.destinationExchange}`,
  );
  console.log('');

  for (const check of report.checks) {
    const prefix = check.status === 'pass' ? 'PASS' : check.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`${prefix} ${check.message}`);
  }

  console.log('');
  console.log(`Result: ${report.ready ? 'READY' : 'NOT READY'}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  if (options.help) {
    console.log(HELP.trimEnd());
    return;
  }

  const restoreOutput = silenceOutput();
  let report;
  try {
    report = await runReadinessCheck(options);
  } finally {
    await closeReadinessDbClient();
    restoreOutput?.();
  }

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);

  if (!report.ready) process.exitCode = 1;
}

async function closeReadinessDbClient() {
  const { closeDBClient } = await import('@bemodest/database');
  await closeDBClient();
}

function silenceOutput() {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const suppressedWrite = function suppressedWrite(_chunk, encoding, callback) {
    const done = typeof encoding === 'function' ? encoding : callback;
    if (typeof done === 'function') done();
    return true;
  };
  process.stdout.write = suppressedWrite;
  process.stderr.write = suppressedWrite;
  return () => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  };
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
