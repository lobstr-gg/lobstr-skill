import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  LIQUIDITY_MINING_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { formatLob } from '../lib/format';

const liquidityMiningAbi = parseAbi(LIQUIDITY_MINING_ABI as unknown as string[]);

export function registerFarmingCommands(program: Command): void {
  const farming = program
    .command('farming')
    .description('Liquidity mining / yield farming commands');

  // ── stake-lp ────────────────────────────────────────

  farming
    .command('stake-lp <amount>')
    .description('Stake LP tokens (approve first)')
    .action(async (amount: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner('Staking LP tokens...');
        const tx = await walletClient.writeContract({
          address: farmAddr,
          abi: liquidityMiningAbi,
          functionName: 'stake',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Staked ${amount} LP tokens`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── unstake-lp ──────────────────────────────────────

  farming
    .command('unstake-lp <amount>')
    .description('Unstake LP tokens')
    .action(async (amount: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner('Unstaking LP tokens...');
        const tx = await walletClient.writeContract({
          address: farmAddr,
          abi: liquidityMiningAbi,
          functionName: 'withdraw',
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Unstaked ${amount} LP tokens`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim ───────────────────────────────────────────

  farming
    .command('claim')
    .description('Claim farming rewards')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const spin = ui.spinner('Claiming farming rewards...');
        const tx = await walletClient.writeContract({
          address: farmAddr,
          abi: liquidityMiningAbi,
          functionName: 'getReward',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Farming rewards claimed');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── exit ──────────────────────────────────────────

  farming
    .command('exit')
    .description('Withdraw all LP tokens and claim rewards')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const spin = ui.spinner('Exiting farm (withdraw all + claim)...');
        const tx = await walletClient.writeContract({
          address: farmAddr,
          abi: liquidityMiningAbi,
          functionName: 'exit',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Exited farm — all LP withdrawn and rewards claimed');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── emergency-withdraw ────────────────────────────

  farming
    .command('emergency-withdraw')
    .description('Emergency withdraw LP tokens (forfeits unclaimed rewards)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const spin = ui.spinner('Emergency withdrawing LP tokens...');
        const tx = await walletClient.writeContract({
          address: farmAddr,
          abi: liquidityMiningAbi,
          functionName: 'emergencyWithdraw',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Emergency withdraw complete (unclaimed rewards forfeited)');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────

  farming
    .command('status')
    .description('View staked amount, earned, boost, and reward rate')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const farmAddr = getContractAddress(ws.config, 'liquidityMining');

        const spin = ui.spinner('Fetching farming status...');

        const [staked, earned, totalSupply, rewardRate, boostBps] = await Promise.all([
          publicClient.readContract({
            address: farmAddr,
            abi: liquidityMiningAbi,
            functionName: 'balanceOf',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: farmAddr,
            abi: liquidityMiningAbi,
            functionName: 'earned',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: farmAddr,
            abi: liquidityMiningAbi,
            functionName: 'totalSupply',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: farmAddr,
            abi: liquidityMiningAbi,
            functionName: 'rewardRate',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: farmAddr,
            abi: liquidityMiningAbi,
            functionName: 'getBoostMultiplier',
            args: [address],
          }) as Promise<bigint>,
        ]);

        const boostMult = (Number(boostBps) / 10000).toFixed(2);

        spin.succeed('Farming Status');
        console.log(`  Staked:       ${formatLob(staked)}`);
        console.log(`  Earned:       ${formatLob(earned)}`);
        console.log(`  Boost:        ${boostMult}x`);
        console.log(`  Reward rate:  ${formatLob(rewardRate)}/s`);
        console.log(`  Total staked: ${formatLob(totalSupply)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
