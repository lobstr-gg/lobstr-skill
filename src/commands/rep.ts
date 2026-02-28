import { Command } from 'commander';
import { parseAbi } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  getContractAddress,
  loadWallet,
  REPUTATION_SYSTEM_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { REPUTATION_TIERS } from '../lib/format';

export function registerRepCommands(program: Command): void {
  const rep = program
    .command('rep')
    .description('View reputation data');

  rep
    .command('score [address]')
    .description('View reputation score and tier')
    .action(async (address?: string) => {
      try {
        const ws = ensureWorkspace();
        const repAbi = parseAbi(REPUTATION_SYSTEM_ABI as unknown as string[]);
        const repAddr = getContractAddress(ws.config, 'reputationSystem');

        const publicClient = createPublicClient(ws.config);
        const targetAddr = (address || loadWallet(ws.path).address) as `0x${string}`;

        const spin = ui.spinner('Fetching reputation...');

        const [score, tier] = await publicClient.readContract({
          address: repAddr,
          abi: repAbi,
          functionName: 'getScore',
          args: [targetAddr],
        }) as [bigint, number];

        spin.succeed('Reputation');
        console.log(`  Address: ${targetAddr}`);
        console.log(`  Score:   ${score.toString()}`);
        console.log(`  Tier:    ${REPUTATION_TIERS[tier] || 'Unknown'}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  rep
    .command('history [address]')
    .description('View detailed reputation data')
    .action(async (address?: string) => {
      try {
        const ws = ensureWorkspace();
        const repAbi = parseAbi(REPUTATION_SYSTEM_ABI as unknown as string[]);
        const repAddr = getContractAddress(ws.config, 'reputationSystem');

        const publicClient = createPublicClient(ws.config);
        const targetAddr = (address || loadWallet(ws.path).address) as `0x${string}`;

        const spin = ui.spinner('Fetching reputation data...');

        const result = await publicClient.readContract({
          address: repAddr,
          abi: repAbi,
          functionName: 'getReputationData',
          args: [targetAddr],
        }) as any;

        const data = {
          score: result.score ?? result[0],
          completions: result.completions ?? result[1],
          disputesLost: result.disputesLost ?? result[2],
          disputesWon: result.disputesWon ?? result[3],
          firstActivityTimestamp: result.firstActivityTimestamp ?? result[4],
        };

        spin.succeed('Reputation History');
        console.log(`  Address:        ${targetAddr}`);
        console.log(`  Score:          ${data.score.toString()}`);
        console.log(`  Completions:    ${data.completions.toString()}`);
        console.log(`  Disputes won:   ${data.disputesWon.toString()}`);
        console.log(`  Disputes lost:  ${data.disputesLost.toString()}`);
        if (data.firstActivityTimestamp > 0n) {
          console.log(`  First activity: ${new Date(Number(data.firstActivityTimestamp) * 1000).toISOString()}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
