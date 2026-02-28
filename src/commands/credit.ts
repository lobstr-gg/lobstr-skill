import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
} from 'openclaw';
import * as ui from 'openclaw';
import { formatLob } from '../lib/format';

const CREDIT_FACILITY_ABI = parseAbi([
  'function openCreditLine()',
  'function closeCreditLine()',
  'function drawCreditAndCreateEscrow(uint256 listingId, address seller, uint256 amount) returns (uint256 drawId)',
  'function repayDraw(uint256 drawId)',
  'function getCreditLine(address agent) view returns (uint256 limit, uint256 outstanding, uint256 available, bool open)',
  'function getDraw(uint256 drawId) view returns (uint256 id, address agent, uint256 amount, uint256 repaid, uint256 startTime, bool active)',
  'function getAvailableCredit(address agent) view returns (uint256)',
]);

export function registerCreditCommands(program: Command): void {
  const credit = program
    .command('credit')
    .description('X402 credit facility commands');

  // ── open-line ───────────────────────────────────────

  credit
    .command('open-line')
    .description('Open a credit line (limit determined by your stake tier)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const creditAddr = getContractAddress(ws.config, 'x402CreditFacility');

        const spin = ui.spinner('Opening credit line...');
        const tx = await walletClient.writeContract({
          address: creditAddr,
          abi: CREDIT_FACILITY_ABI,
          functionName: 'openCreditLine',
          args: [],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Credit line opened');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── draw ────────────────────────────────────────────

  credit
    .command('draw')
    .description('Draw credit and create an escrow job')
    .requiredOption('--listing <id>', 'Listing ID')
    .requiredOption('--seller <address>', 'Seller address')
    .requiredOption('--amount <amount>', 'Amount in LOB')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const creditAddr = getContractAddress(ws.config, 'x402CreditFacility');

        const parsedAmount = parseUnits(opts.amount, 18);

        const spin = ui.spinner('Drawing credit and creating escrow...');
        const tx = await walletClient.writeContract({
          address: creditAddr,
          abi: CREDIT_FACILITY_ABI,
          functionName: 'drawCreditAndCreateEscrow',
          args: [BigInt(opts.listing), opts.seller as `0x${string}`, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Drew ${opts.amount} LOB — escrow created`);
        ui.info(`Listing: #${opts.listing}`);
        ui.info(`Seller:  ${opts.seller}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── repay ───────────────────────────────────────────

  credit
    .command('repay <drawId>')
    .description('Repay an outstanding draw')
    .action(async (drawId: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const creditAddr = getContractAddress(ws.config, 'x402CreditFacility');

        const spin = ui.spinner(`Repaying draw #${drawId}...`);
        const tx = await walletClient.writeContract({
          address: creditAddr,
          abi: CREDIT_FACILITY_ABI,
          functionName: 'repayDraw',
          args: [BigInt(drawId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Draw #${drawId} repaid`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────

  credit
    .command('status')
    .description('View credit line details')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const creditAddr = getContractAddress(ws.config, 'x402CreditFacility');

        const spin = ui.spinner('Fetching credit line...');
        const result = await publicClient.readContract({
          address: creditAddr,
          abi: CREDIT_FACILITY_ABI,
          functionName: 'getCreditLine',
          args: [address],
        }) as any;

        const creditLine = {
          limit: result.limit ?? result[0],
          outstanding: result.outstanding ?? result[1],
          available: result.available ?? result[2],
          open: result.open ?? result[3],
        };

        spin.succeed('Credit Line Status');
        console.log(`  Open:        ${creditLine.open ? 'Yes' : 'No'}`);
        console.log(`  Limit:       ${formatLob(creditLine.limit)}`);
        console.log(`  Outstanding: ${formatLob(creditLine.outstanding)}`);
        console.log(`  Available:   ${formatLob(creditLine.available)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
