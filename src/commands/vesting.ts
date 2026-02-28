import { Command } from 'commander';
import { parseAbi } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
} from 'openclaw';
import * as ui from 'openclaw';
import { formatLob, VESTING_STATUS } from '../lib/format';

const TEAM_VESTING_ABI = parseAbi([
  'function getVestingInfo(address beneficiary) view returns (uint256 totalAmount, uint256 claimedAmount, uint256 claimable, uint256 startTime, uint256 cliffEnd, uint256 endTime, bool active)',
  'function claim()',
]);

export function registerVestingCommands(program: Command): void {
  const vesting = program
    .command('vesting')
    .description('Team vesting commands');

  // ── status ──────────────────────────────────────────

  vesting
    .command('status')
    .description('View vesting schedule and claimable amount')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const vestingAddr = getContractAddress(ws.config, 'teamVesting');

        const spin = ui.spinner('Fetching vesting info...');
        const result = await publicClient.readContract({
          address: vestingAddr,
          abi: TEAM_VESTING_ABI,
          functionName: 'getVestingInfo',
          args: [address],
        }) as any;

        const info = {
          totalAmount: result.totalAmount ?? result[0],
          claimedAmount: result.claimedAmount ?? result[1],
          claimable: result.claimable ?? result[2],
          startTime: result.startTime ?? result[3],
          cliffEnd: result.cliffEnd ?? result[4],
          endTime: result.endTime ?? result[5],
          active: result.active ?? result[6],
        };

        // Determine vesting status based on timestamps
        const now = BigInt(Math.floor(Date.now() / 1000));
        let statusLabel = 'Unknown';
        if (!info.active) {
          statusLabel = VESTING_STATUS[0] || 'NotStarted';
        } else if (now < info.cliffEnd) {
          statusLabel = VESTING_STATUS[1] || 'Cliff';
        } else if (now < info.endTime) {
          statusLabel = VESTING_STATUS[2] || 'Vesting';
        } else {
          statusLabel = VESTING_STATUS[1] || 'FullyVested';
        }

        spin.succeed('Vesting Status');
        console.log(`  Active:     ${info.active ? 'Yes' : 'No'}`);
        console.log(`  Status:     ${statusLabel}`);
        console.log(`  Total:      ${formatLob(info.totalAmount)}`);
        console.log(`  Claimed:    ${formatLob(info.claimedAmount)}`);
        console.log(`  Claimable:  ${formatLob(info.claimable)}`);
        console.log(`  Start:      ${new Date(Number(info.startTime) * 1000).toISOString()}`);
        console.log(`  Cliff end:  ${new Date(Number(info.cliffEnd) * 1000).toISOString()}`);
        console.log(`  End:        ${new Date(Number(info.endTime) * 1000).toISOString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim ───────────────────────────────────────────

  vesting
    .command('claim')
    .description('Claim vested tokens')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const vestingAddr = getContractAddress(ws.config, 'teamVesting');

        // Check claimable first
        const result = await publicClient.readContract({
          address: vestingAddr,
          abi: TEAM_VESTING_ABI,
          functionName: 'getVestingInfo',
          args: [address],
        }) as any;

        const claimable = result.claimable ?? result[2];

        if (claimable === 0n) {
          ui.warn('Nothing to claim yet');
          return;
        }

        const spin = ui.spinner(`Claiming ${formatLob(claimable)}...`);
        const tx = await walletClient.writeContract({
          address: vestingAddr,
          abi: TEAM_VESTING_ABI,
          functionName: 'claim',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Claimed ${formatLob(claimable)}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
