import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  LOB_TOKEN_ABI,
  SERVICE_REGISTRY_ABI,
  INSURANCE_POOL_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { formatLob, TIER_NAMES } from '../lib/format';

const insurancePoolAbi = parseAbi(INSURANCE_POOL_ABI as unknown as string[]);

export function registerInsuranceCommands(program: Command): void {
  const insurance = program
    .command('insurance')
    .description('Insurance pool commands');

  // ── deposit ─────────────────────────────────────────

  insurance
    .command('deposit <amount>')
    .description('Deposit LOB into insurance pool (earn premium yield)')
    .action(async (amount: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner('Approving LOB transfer...');
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: 'approve',
          args: [poolAddr, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        spin.text = 'Depositing into insurance pool...';
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'depositToPool',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Deposited ${amount} LOB into insurance pool`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── withdraw ────────────────────────────────────────

  insurance
    .command('withdraw <amount>')
    .description('Withdraw LOB from insurance pool')
    .action(async (amount: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner('Withdrawing from insurance pool...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'withdrawFromPool',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Withdrew ${amount} LOB from insurance pool`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim-rewards ─────────────────────────────────────

  insurance
    .command('claim-rewards')
    .description('Claim accrued premium yield from pool staking')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;

        const spin = ui.spinner('Checking earned rewards...');
        const earned = await publicClient.readContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'poolEarned',
          args: [address],
        }) as bigint;

        if (earned === 0n) {
          spin.succeed('No rewards to claim');
          return;
        }

        spin.text = `Claiming ${formatLob(earned)} in rewards...`;
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'claimPoolRewards',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Claimed ${formatLob(earned)} in premium rewards`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── create-job ────────────────────────────────────────

  insurance
    .command('create-job')
    .description('Create an insured job from a listing (premium auto-deducted)')
    .requiredOption('--listing <id>', 'Listing ID')
    .requiredOption('--amount <amount>', 'Payment amount in LOB')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        const spin = ui.spinner('Looking up listing...');

        // Get listing to find seller
        const listingResult = await publicClient.readContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'getListing',
          args: [BigInt(opts.listing)],
        }) as any;

        const seller = (listingResult.provider ?? listingResult[1]) as `0x${string}`;
        const title = listingResult.title ?? listingResult[3];

        // Read premium rate to compute total approval
        const premiumBps = await publicClient.readContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'premiumRateBps',
        }) as bigint;

        const parsedAmount = parseUnits(opts.amount, 18);
        const premium = (parsedAmount * premiumBps) / 10000n;
        const totalApproval = parsedAmount + premium;

        spin.text = 'Approving LOB transfer (principal + premium)...';
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: 'approve',
          args: [poolAddr, totalApproval],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        spin.text = 'Creating insured job...';
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'createInsuredJob',
          args: [BigInt(opts.listing), seller, parsedAmount, tokenAddr],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Insured job created');
        ui.info(`Listing: #${opts.listing} — ${title}`);
        ui.info(`Amount: ${opts.amount} LOB`);
        ui.info(`Premium: ${formatLob(premium)} (${Number(premiumBps) / 100}%)`);
        ui.info(`Seller: ${seller}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── confirm-delivery ──────────────────────────────────

  insurance
    .command('confirm-delivery <jobId>')
    .description('Confirm delivery on an insured job (buyer only)')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Confirming insured delivery...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'confirmInsuredDelivery',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Delivery confirmed for insured job #${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── dispute ───────────────────────────────────────────

  insurance
    .command('dispute <jobId>')
    .description('Initiate a dispute on an insured job')
    .requiredOption('--evidence <uri>', 'Evidence URI')
    .action(async (jobId: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Initiating insured dispute...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'initiateInsuredDispute',
          args: [BigInt(jobId), opts.evidence],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Dispute initiated for insured job #${jobId}`);
        ui.info(`Evidence: ${opts.evidence}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── file-claim ────────────────────────────────────────

  insurance
    .command('file-claim <jobId>')
    .description('File supplemental insurance claim for net loss (after dispute resolves)')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Filing insurance claim...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'fileClaim',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Insurance claim filed for job #${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim-refund ──────────────────────────────────────

  insurance
    .command('claim-refund <jobId>')
    .description('Claim escrow refund on an insured job (full principal, no cap)')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Claiming refund...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'claimRefund',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Refund claimed for insured job #${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── check-job ─────────────────────────────────────────

  insurance
    .command('check-job <jobId>')
    .description('Check if a job is insured')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Checking job...');
        const insured = await publicClient.readContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'isInsuredJob',
          args: [BigInt(jobId)],
        }) as boolean;

        spin.succeed(`Job #${jobId}: ${insured ? 'Insured' : 'Not insured'}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── coverage ──────────────────────────────────────────

  insurance
    .command('coverage')
    .description('View your coverage cap based on reputation tier')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Fetching coverage cap...');
        const cap = await publicClient.readContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'getCoverageCap',
          args: [address],
        }) as bigint;

        spin.succeed('Coverage Info');
        console.log(`  Your address:   ${address}`);
        console.log(`  Coverage cap:   ${formatLob(cap)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────

  insurance
    .command('status')
    .description('View your deposit, earned rewards, and pool health')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Fetching insurance status...');

        const [stakerInfo, earned, statsResult, premiumBps, coverageCap, isPaused] = await Promise.all([
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'getStakerInfo',
            args: [address],
          }) as Promise<any>,
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'poolEarned',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'getPoolStats',
          }) as Promise<any>,
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'premiumRateBps',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'getCoverageCap',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: poolAddr,
            abi: insurancePoolAbi,
            functionName: 'paused',
          }) as Promise<boolean>,
        ]);

        const deposited = stakerInfo.deposited ?? stakerInfo[0];
        const stats = {
          totalDeposits: statsResult.totalDeposits ?? statsResult[0],
          totalPremiums: statsResult.totalPremiums ?? statsResult[1],
          totalClaims: statsResult.totalClaims ?? statsResult[2],
          available: statsResult.available ?? statsResult[3],
        };

        spin.succeed('Insurance Pool Status');
        if (isPaused) console.log('  *** POOL IS PAUSED ***');
        console.log('');
        console.log('  Your Position:');
        console.log(`    Deposited:      ${formatLob(deposited)}`);
        console.log(`    Earned rewards: ${formatLob(earned)}`);
        console.log(`    Coverage cap:   ${formatLob(coverageCap)}`);
        console.log('');
        console.log('  Pool Health:');
        console.log(`    Total deposits: ${formatLob(stats.totalDeposits)}`);
        console.log(`    Total premiums: ${formatLob(stats.totalPremiums)}`);
        console.log(`    Total claims:   ${formatLob(stats.totalClaims)}`);
        console.log(`    Available:      ${formatLob(stats.available)}`);
        console.log(`    Premium rate:   ${Number(premiumBps) / 100}%`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── book-job ──────────────────────────────────────────

  insurance
    .command('book-job <jobId>')
    .description('Settle a terminal insured job (releases in-flight reserves)')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner(`Booking insured job #${jobId}...`);
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'bookJob',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Job #${jobId} booked — in-flight reserves released`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── update-rate ───────────────────────────────────────

  insurance
    .command('update-rate <bps>')
    .description('Update premium rate in basis points (GOVERNOR_ROLE required)')
    .action(async (bps: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const newBps = BigInt(bps);
        if (newBps > 1000n) {
          ui.error('Rate cannot exceed 1000 bps (10%)');
          process.exit(1);
        }

        const spin = ui.spinner(`Updating premium rate to ${bps} bps...`);
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'updatePremiumRate',
          args: [newBps],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Premium rate updated to ${Number(newBps) / 100}%`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── update-caps ───────────────────────────────────────

  insurance
    .command('update-caps')
    .description('Update coverage caps by tier (GOVERNOR_ROLE required)')
    .requiredOption('--bronze <amount>', 'Bronze cap in LOB')
    .requiredOption('--silver <amount>', 'Silver cap in LOB')
    .requiredOption('--gold <amount>', 'Gold cap in LOB')
    .requiredOption('--platinum <amount>', 'Platinum cap in LOB')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Updating coverage caps...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'updateCoverageCaps',
          args: [
            parseUnits(opts.bronze, 18),
            parseUnits(opts.silver, 18),
            parseUnits(opts.gold, 18),
            parseUnits(opts.platinum, 18),
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Coverage caps updated');
        console.log(`  Bronze:   ${opts.bronze} LOB`);
        console.log(`  Silver:   ${opts.silver} LOB`);
        console.log(`  Gold:     ${opts.gold} LOB`);
        console.log(`  Platinum: ${opts.platinum} LOB`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── pause ─────────────────────────────────────────────

  insurance
    .command('pause')
    .description('Pause the insurance pool (DEFAULT_ADMIN_ROLE required)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Pausing insurance pool...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'pause',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Insurance pool paused');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── unpause ───────────────────────────────────────────

  insurance
    .command('unpause')
    .description('Unpause the insurance pool (DEFAULT_ADMIN_ROLE required)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const poolAddr = getContractAddress(ws.config, 'insurancePool');

        const spin = ui.spinner('Unpausing insurance pool...');
        const tx = await walletClient.writeContract({
          address: poolAddr,
          abi: insurancePoolAbi,
          functionName: 'unpause',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Insurance pool unpaused');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
