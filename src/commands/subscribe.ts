import { Command } from 'commander';
import { parseAbi, parseUnits, formatUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  LOB_TOKEN_ABI,
} from 'openclaw';
import * as ui from 'openclaw';

const SUBSCRIPTION_ENGINE_ABI = parseAbi([
  'function createSubscription(address buyer, address seller, address paymentToken, uint256 amount, uint256 interval, string metadataURI)',
  'function processPayment(uint256 subscriptionId)',
  'function cancelSubscription(uint256 subscriptionId)',
  'function pauseSubscription(uint256 subscriptionId)',
  'function resumeSubscription(uint256 subscriptionId)',
  'function getSubscription(uint256 id) view returns (uint256 id, address buyer, address seller, address paymentToken, uint256 amount, uint256 interval, uint256 nextPaymentTime, bool active, bool paused, string metadataURI)',
  'function getSubscriptionsByBuyer(address buyer) view returns (uint256[])',
  'function getSubscriptionsBySeller(address seller) view returns (uint256[])',
]);

const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);

const INTERVAL_SHORTCUTS: Record<string, bigint> = {
  hourly: 3600n,
  daily: 86400n,
  weekly: 604800n,
  monthly: 2592000n,   // 30 days
  quarterly: 7776000n, // 90 days
};

function parseInterval(val: string): bigint {
  const lower = val.toLowerCase();
  if (INTERVAL_SHORTCUTS[lower]) return INTERVAL_SHORTCUTS[lower];
  // Try as raw seconds
  const n = BigInt(val);
  if (n < 3600n) throw new Error('Interval must be at least 3600 seconds (1 hour)');
  return n;
}

export function registerSubscribeCommands(program: Command): void {
  const subscribe = program
    .command('subscribe')
    .description('Subscription engine commands');

  // ── create ──────────────────────────────────────────

  subscribe
    .command('create')
    .description('Create a subscription')
    .requiredOption('--seller <address>', 'Seller address')
    .requiredOption('--token <address>', 'Payment token address (LOB or ERC-20)')
    .requiredOption('--amount <amount>', 'Payment amount per cycle (in token units)')
    .requiredOption('--interval <interval>', 'Payment interval (hourly|daily|weekly|monthly|quarterly or seconds)')
    .option('--metadata <uri>', 'Metadata URI', '')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient, address: account } = await createWalletClient(ws.config, ws.path);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');
        const tokenAddr = opts.token as `0x${string}`;
        const parsedAmount = parseUnits(opts.amount, 18);
        const interval = parseInterval(opts.interval);

        const spin = ui.spinner('Approving token transfer...');
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: 'approve',
          args: [subAddr, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        spin.text = 'Creating subscription...';
        const tx = await walletClient.writeContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'createSubscription',
          args: [
            account,
            opts.seller as `0x${string}`,
            tokenAddr,
            parsedAmount,
            interval,
            opts.metadata,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Subscription created');
        ui.info(`Seller:   ${opts.seller}`);
        ui.info(`Token:    ${tokenAddr}`);
        ui.info(`Amount:   ${opts.amount}`);
        ui.info(`Interval: ${opts.interval}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── process ─────────────────────────────────────────

  subscribe
    .command('process <id>')
    .description('Process a due payment for a subscription')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner(`Processing payment for subscription #${id}...`);
        const tx = await walletClient.writeContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'processPayment',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Payment processed for subscription #${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── cancel ──────────────────────────────────────────

  subscribe
    .command('cancel <id>')
    .description('Cancel a subscription')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner(`Cancelling subscription #${id}...`);
        const tx = await walletClient.writeContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'cancelSubscription',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Subscription #${id} cancelled`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── pause ──────────────────────────────────────────

  subscribe
    .command('pause <id>')
    .description('Pause a subscription')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner(`Pausing subscription #${id}...`);
        const tx = await walletClient.writeContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'pauseSubscription',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Subscription #${id} paused`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── resume ─────────────────────────────────────────

  subscribe
    .command('resume <id>')
    .description('Resume a paused subscription')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner(`Resuming subscription #${id}...`);
        const tx = await walletClient.writeContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'resumeSubscription',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Subscription #${id} resumed`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────

  subscribe
    .command('status <id>')
    .description('View subscription details')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner(`Fetching subscription #${id}...`);
        const result = await publicClient.readContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: 'getSubscription',
          args: [BigInt(id)],
        }) as any;

        const sub = {
          id: result[0],
          buyer: result[1],
          seller: result[2],
          paymentToken: result[3],
          amount: result[4],
          interval: result[5],
          nextPaymentTime: result[6],
          active: result[7],
          paused: result[8],
          metadataURI: result[9],
        };

        const statusLabel = sub.paused ? 'Paused' : sub.active ? 'Active' : 'Inactive';

        spin.succeed(`Subscription #${id}`);
        console.log(`  Buyer:         ${sub.buyer}`);
        console.log(`  Seller:        ${sub.seller}`);
        console.log(`  Token:         ${sub.paymentToken}`);
        console.log(`  Amount:        ${formatUnits(sub.amount, 18)}`);
        console.log(`  Interval:      ${(Number(sub.interval) / 86400).toFixed(1)} days (${sub.interval.toString()}s)`);
        console.log(`  Next payment:  ${new Date(Number(sub.nextPaymentTime) * 1000).toISOString()}`);
        console.log(`  Status:        ${statusLabel}`);
        if (sub.metadataURI) console.log(`  Metadata:      ${sub.metadataURI}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ───────────────────────────────────────────

  subscribe
    .command('list')
    .description('List your subscriptions')
    .option('--as-seller', 'Show subscriptions where you are the seller')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const w = loadWallet(ws.path);
        const address = w.address as `0x${string}`;
        const subAddr = getContractAddress(ws.config, 'subscriptionEngine');

        const spin = ui.spinner('Loading subscriptions...');
        const fnName = opts.asSeller ? 'getSubscriptionsBySeller' : 'getSubscriptionsByBuyer';
        const ids = await publicClient.readContract({
          address: subAddr,
          abi: SUBSCRIPTION_ENGINE_ABI,
          functionName: fnName,
          args: [address],
        }) as bigint[];

        if (ids.length === 0) {
          spin.succeed('No subscriptions found');
          return;
        }

        const subs: any[] = [];
        for (const subId of ids) {
          const result = await publicClient.readContract({
            address: subAddr,
            abi: SUBSCRIPTION_ENGINE_ABI,
            functionName: 'getSubscription',
            args: [subId],
          }) as any;

          const active = result[7] as boolean;
          const paused = result[8] as boolean;
          subs.push({
            id: result[0].toString(),
            counterparty: opts.asSeller ? result[1] : result[2],
            token: result[3],
            amount: formatUnits(result[4], 18),
            interval: (Number(result[5]) / 86400).toFixed(0),
            nextPayment: Number(result[6]),
            status: paused ? 'Paused' : active ? 'Active' : 'Inactive',
          });
        }

        spin.succeed(`${subs.length} subscription(s)`);
        const counterLabel = opts.asSeller ? 'Buyer' : 'Seller';
        ui.table(
          ['ID', counterLabel, 'Amount', 'Interval', 'Next Payment', 'Status'],
          subs.map((s) => [
            s.id,
            `${s.counterparty.slice(0, 6)}...${s.counterparty.slice(-4)}`,
            s.amount,
            `${s.interval}d`,
            new Date(s.nextPayment * 1000).toLocaleDateString(),
            s.status,
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
