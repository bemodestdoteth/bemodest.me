const HELP = `Usage: pnpm --filter @bemodest/api forward:chain-wallet -- [options]

Dry-run-first EVM chain forwarding harness.

Required:
  --wallet-label <label>           Service wallet label to forward from
  --caip2 <eip155:n>               EVM CAIP-2 chain id
  --asset-kind <native|erc20>      Asset kind
  --destination-exchange <name>    Destination exchange key, e.g. okx
  --service-name <name>            walletAccount serviceName
  --environment <env>              walletAccount/API credential environment

ERC20:
  --token-address <address>        Required when --asset-kind erc20

Apply mode:
  --apply                          Sign and broadcast after final verification
  --operation-id <id>              Required with --apply
  --currency <symbol>              Required with --apply for OKX verification
  --lock-owner <owner>             Optional lock owner override
  --no-wait-receipt                Mark submitted without waiting for receipt

Output:
  --json                           Emit JSON report
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
    apply: false,
    waitReceipt: true,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--apply') {
      options.apply = true;
      continue;
    }
    if (arg === '--no-wait-receipt') {
      options.waitReceipt = false;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
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
    else if (arg === '--service-name') options.serviceName = value;
    else if (arg === '--environment') options.environment = value;
    else if (arg === '--operation-id') options.operationId = value;
    else if (arg === '--token-address') options.tokenAddress = value;
    else if (arg === '--currency') options.currency = value;
    else if (arg === '--lock-owner') options.lockOwner = value;
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
  if (options.apply) {
    requiredOption(options.operationId, '--operation-id');
    requiredOption(options.currency, '--currency');
    if (options.destinationExchange.toLowerCase() !== 'okx') {
      throw new CliError('--apply currently requires --destination-exchange okx.');
    }
  }
}

function requiredOption(value, flag) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new CliError(`${flag} is required.`);
}

function printTextReport(report) {
  console.log('Chain Forwarding Harness');
  console.log(`Mode: ${report.mode}`);
  console.log(
    `Target: wallet=${report.target.walletLabel} caip2=${report.target.caip2} asset=${report.target.assetKind} destination=${report.target.destinationExchange}`,
  );
  console.log(`Operation: ${report.operationId}`);
  console.log('');
  console.log(`Wallet: ${report.target.walletAddress}`);
  console.log(`Destination: ${report.target.destinationAddress}`);
  console.log(`Native balance: ${report.plan.nativeBalance}`);
  console.log(`Gas reserve: ${report.plan.gasReserveWei}`);
  if (report.target.assetKind === 'erc20') {
    console.log(`Token: ${report.target.tokenSymbol} ${report.target.tokenAddress}`);
    console.log(`Token balance: ${report.plan.tokenBalance}`);
  }
  console.log(`Planned amount: ${report.plan.amount}`);

  if (report.txHash) console.log(`Tx hash: ${report.txHash}`);
  if (report.state?.status) console.log(`State: ${report.state.status}`);
  if (report.errors.length > 0) {
    console.log('');
    for (const error of report.errors) console.log(`BLOCK ${error}`);
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

  const { runChainForwardingHarness } = await import('../modules/chain-forward/harness.js');
  const report = await runChainForwardingHarness(options);

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);

  if (!report.ready) process.exitCode = 1;
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
