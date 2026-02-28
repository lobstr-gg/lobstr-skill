import { Command } from 'commander';
import { type Address } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  LIGHTNING_GOVERNOR_ABI,
  parseAbi,
} from 'openclaw';
import * as ui from 'openclaw';

// viem readContract needs parsed ABI objects, not human-readable strings
const GOVERNOR_ABI = parseAbi(LIGHTNING_GOVERNOR_ABI as unknown as string[]);
import { LIGHTNING_PROPOSAL_STATUS } from '../lib/format';

export function registerGovernorCommands(program: Command): void {
  const governor = program
    .command('governor')
    .description('Lightning governor commands');

  // ── propose ─────────────────────────────────────────

  governor
    .command('propose')
    .description('Create a governance proposal (Platinum tier required)')
    .requiredOption('--target <addr>', 'Target contract address')
    .requiredOption('--calldata <hex>', 'Encoded calldata (0x...)')
    .requiredOption('--description <desc>', 'Proposal description')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, 'lightningGovernor');

        const spin = ui.spinner('Creating proposal...');
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: GOVERNOR_ABI,
          functionName: 'createProposal',
          args: [
            opts.target as Address,
            opts.calldata as `0x${string}`,
            opts.description,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Proposal created');
        ui.info(`Target: ${opts.target}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── vote ────────────────────────────────────────────

  governor
    .command('vote <id>')
    .description('Vote on a proposal (Platinum tier required)')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, 'lightningGovernor');

        const spin = ui.spinner(`Voting on proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: GOVERNOR_ABI,
          functionName: 'vote',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Voted on proposal #${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── execute ─────────────────────────────────────────

  governor
    .command('execute <id>')
    .description('Execute an approved proposal (EXECUTOR_ROLE required)')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, 'lightningGovernor');

        const spin = ui.spinner(`Executing proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: GOVERNOR_ABI,
          functionName: 'execute',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Proposal #${id} executed`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── cancel ─────────────────────────────────────────

  governor
    .command('cancel <id>')
    .description('Cancel a proposal (proposer or guardian only)')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, 'lightningGovernor');

        const spin = ui.spinner(`Cancelling proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: GOVERNOR_ABI,
          functionName: 'cancel',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Proposal #${id} cancelled`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ────────────────────────────────────────────

  governor
    .command('list')
    .description('List active proposals')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, 'lightningGovernor');

        const spin = ui.spinner('Loading proposals...');

        const [count, currentQuorum] = await Promise.all([
          publicClient.readContract({
            address: govAddr,
            abi: GOVERNOR_ABI,
            functionName: 'proposalCount',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: govAddr,
            abi: GOVERNOR_ABI,
            functionName: 'quorum',
          }) as Promise<bigint>,
        ]);

        if (count === 0n) {
          spin.succeed('No proposals found');
          return;
        }

        const proposals: any[] = [];
        for (let i = 1n; i <= count; i++) {
          try {
            const result = await publicClient.readContract({
              address: govAddr,
              abi: GOVERNOR_ABI,
              functionName: 'getProposal',
              args: [i],
            }) as any;

            proposals.push({
              id: result[0],
              proposer: result[1],
              target: result[2],
              callData: result[3],
              description: result[4],
              status: result[5],
              voteCount: result[6],
              createdAt: result[7],
              votingDeadline: result[8],
              approvedAt: result[9],
              executionDeadline: result[10],
            });
          } catch {
            break;
          }
        }

        spin.succeed(`${proposals.length} proposal(s) | quorum: ${currentQuorum}`);
        ui.table(
          ['ID', 'Proposer', 'Target', 'Votes', 'Status', 'Deadline'],
          proposals.map((p: any) => [
            p.id.toString(),
            p.proposer.slice(0, 10) + '...',
            p.target.slice(0, 10) + '...',
            `${p.voteCount}/${currentQuorum}`,
            LIGHTNING_PROPOSAL_STATUS[Number(p.status)] || 'Unknown',
            new Date(Number(p.votingDeadline) * 1000).toLocaleDateString(),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
