import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  STAKING_MANAGER_ABI,
  LOB_TOKEN_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { TIER_NAMES, formatLob } from '../lib/format';

export function registerStakeCommands(program: Command): void {
  program
    .command('stake [amount]')
    .description('Stake LOB tokens or view stake info')
    .option('--format <fmt>', 'Output format: text, json', 'text')
    .action(async (amount: string | undefined, opts: any) => {
      try {
        const ws = ensureWorkspace();
        const stakingAbi = parseAbi(STAKING_MANAGER_ABI as unknown as string[]);
        const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
        const stakingAddr = getContractAddress(ws.config, 'stakingManager');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        if (!amount) {
          // Show stake info
          const publicClient = createPublicClient(ws.config);
          const wallet = loadWallet(ws.path);
          const address = wallet.address as `0x${string}`;

          const spin = opts.format !== 'json' ? ui.spinner('Fetching stake info...') : null;

          const result = await publicClient.readContract({
            address: stakingAddr,
            abi: stakingAbi,
            functionName: 'getStakeInfo',
            args: [address],
          }) as any;

          const stakeInfo = {
            amount: result.amount ?? result[0],
            unstakeRequestTime: result.unstakeRequestTime ?? result[1],
            unstakeRequestAmount: result.unstakeRequestAmount ?? result[2],
          };

          const tier = await publicClient.readContract({
            address: stakingAddr,
            abi: stakingAbi,
            functionName: 'getTier',
            args: [address],
          }) as number;

          if (opts.format === 'json') {
            console.log(JSON.stringify({
              address,
              stakedAmount: formatLob(stakeInfo.amount),
              tier: TIER_NAMES[tier] || 'Unknown',
              unstakeRequestTime: stakeInfo.unstakeRequestTime > 0n ? Number(stakeInfo.unstakeRequestTime) : null,
              unstakeRequestAmount: stakeInfo.unstakeRequestTime > 0n ? formatLob(stakeInfo.unstakeRequestAmount) : null,
            }));
            return;
          }

          spin!.succeed('Stake Info');
          console.log(`  Address:  ${address}`);
          console.log(`  Staked:   ${formatLob(stakeInfo.amount)}`);
          console.log(`  Tier:     ${TIER_NAMES[tier] || 'Unknown'}`);

          if (stakeInfo.unstakeRequestTime > 0n) {
            const readyAt = new Date(Number(stakeInfo.unstakeRequestTime) * 1000 + 7 * 24 * 3600 * 1000);
            console.log(`  Unstaking: ${formatLob(stakeInfo.unstakeRequestAmount)} (ready ${readyAt.toISOString()})`);
          }
          return;
        }

        // Stake tokens
        const spin = ui.spinner('Staking tokens...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient, address } = await createWalletClient(ws.config, ws.path);
        const parsedAmount = parseUnits(amount, 18);

        // Approve
        spin.text = 'Approving LOB transfer...';
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: 'approve',
          args: [stakingAddr, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        // Stake
        spin.text = 'Staking...';
        const stakeTx = await walletClient.writeContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: 'stake',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: stakeTx });

        const newTier = await publicClient.readContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: 'getTier',
          args: [address],
        }) as number;

        spin.succeed(`Staked ${amount} LOB`);
        ui.info(`Tier: ${TIER_NAMES[newTier] || 'Unknown'}`);
        ui.info(`Tx: ${stakeTx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  program
    .command('unstake <amount>')
    .description('Request unstake of LOB tokens (starts 7-day cooldown)')
    .action(async (amount: string) => {
      try {
        const ws = ensureWorkspace();
        const stakingAbi = parseAbi(STAKING_MANAGER_ABI as unknown as string[]);
        const stakingAddr = getContractAddress(ws.config, 'stakingManager');

        const spin = ui.spinner('Requesting unstake...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const parsedAmount = parseUnits(amount, 18);

        const tx = await walletClient.writeContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: 'requestUnstake',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Unstake requested for ${amount} LOB`);
        ui.info('7-day cooldown before withdrawal. Run `lobstr withdraw` after cooldown.');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  program
    .command('withdraw')
    .description('Withdraw tokens after unstake cooldown expires')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const stakingAbi = parseAbi(STAKING_MANAGER_ABI as unknown as string[]);
        const stakingAddr = getContractAddress(ws.config, 'stakingManager');

        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;

        // Check if there's a pending unstake request
        const result = await publicClient.readContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: 'getStakeInfo',
          args: [address],
        }) as any;

        const unstakeRequestTime = result.unstakeRequestTime ?? result[1];
        const unstakeRequestAmount = result.unstakeRequestAmount ?? result[2];

        if (unstakeRequestTime === 0n) {
          ui.error('No pending unstake request. Use `lobstr unstake <amount>` first.');
          process.exit(1);
        }

        const readyAt = Number(unstakeRequestTime) * 1000 + 7 * 24 * 3600 * 1000;
        if (Date.now() < readyAt) {
          const readyDate = new Date(readyAt);
          ui.error(`Cooldown not expired. Withdrawal available ${readyDate.toISOString()}`);
          process.exit(1);
        }

        const spin = ui.spinner(`Withdrawing ${formatLob(unstakeRequestAmount)} LOB...`);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: 'unstake',
          args: [],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Withdrew ${formatLob(unstakeRequestAmount)} LOB`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
