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
import { formatLob, LOAN_STATUS, LOAN_TERM } from '../lib/format';

const LOAN_ENGINE_ABI = parseAbi([
  'function requestLoan(uint256 principal, uint8 term) returns (uint256)',
  'function cancelLoan(uint256 loanId)',
  'function fundLoan(uint256 loanId)',
  'function repay(uint256 loanId, uint256 amount)',
  'function getLoan(uint256 loanId) view returns (uint256 id, address borrower, address lender, uint256 principal, uint256 interestAmount, uint256 protocolFee, uint256 collateralAmount, uint256 totalRepaid, uint8 status, uint8 term, uint256 requestedAt, uint256 fundedAt, uint256 dueDate)',
  'function getActiveLoanIds(address borrower) view returns (uint256[])',
  'function getBorrowerProfile(address borrower) view returns (uint256 activeLoans, uint256 totalBorrowed, uint256 totalRepaid, uint256 defaults, bool restricted)',
  'function getMaxBorrow(address borrower) view returns (uint256)',
  'function getInterestRate(address borrower) view returns (uint256)',
  'function getCollateralRequired(uint256 principal, address borrower) view returns (uint256)',
  'function getOutstandingAmount(uint256 loanId) view returns (uint256)',
]);

const TERM_MAP: Record<string, number> = {
  '7d': 0,
  '14d': 1,
  '30d': 2,
  '90d': 3,
};

function parseLoanResult(result: any) {
  return {
    id: result[0],
    borrower: result[1],
    lender: result[2],
    principal: result[3],
    interestAmount: result[4],
    protocolFee: result[5],
    collateralAmount: result[6],
    totalRepaid: result[7],
    status: result[8],
    term: result[9],
    requestedAt: result[10],
    fundedAt: result[11],
    dueDate: result[12],
  };
}

export function registerLoanCommands(program: Command): void {
  const loan = program
    .command('loan')
    .description('Loan engine commands');

  // ── request ─────────────────────────────────────────

  loan
    .command('request')
    .description('Request a loan')
    .requiredOption('--amount <amt>', 'Loan principal in LOB')
    .option('--term <term>', 'Loan term: 7d, 14d, 30d, 90d (default: 30d)', '30d')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const termIndex = TERM_MAP[opts.term];
        if (termIndex === undefined) {
          ui.error(`Invalid term: ${opts.term}. Use: 7d, 14d, 30d, 90d`);
          process.exit(1);
        }

        const parsedAmount = parseUnits(opts.amount, 18);

        const spin = ui.spinner('Requesting loan...');
        const tx = await walletClient.writeContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'requestLoan',
          args: [parsedAmount, termIndex],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Loan requested');
        ui.info(`Amount: ${opts.amount} LOB`);
        ui.info(`Term: ${LOAN_TERM[termIndex]}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── repay ───────────────────────────────────────────

  loan
    .command('repay <id>')
    .description('Repay a loan (full or partial)')
    .option('--amount <amt>', 'Partial repayment amount in LOB (default: full outstanding)')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        let repayAmount: bigint;
        if (opts.amount) {
          repayAmount = parseUnits(opts.amount, 18);
        } else {
          const outstanding = await publicClient.readContract({
            address: loanAddr,
            abi: LOAN_ENGINE_ABI,
            functionName: 'getOutstandingAmount',
            args: [BigInt(id)],
          }) as bigint;
          repayAmount = outstanding;
        }

        const spin = ui.spinner(`Repaying loan #${id}...`);
        const tx = await walletClient.writeContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'repay',
          args: [BigInt(id), repayAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Loan #${id} repaid`);
        ui.info(`Amount: ${formatLob(repayAmount)}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── cancel ──────────────────────────────────────────

  loan
    .command('cancel <id>')
    .description('Cancel a pending loan request')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const spin = ui.spinner(`Cancelling loan #${id}...`);
        const tx = await walletClient.writeContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'cancelLoan',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Loan #${id} cancelled`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── fund ────────────────────────────────────────────

  loan
    .command('fund <id>')
    .description('Fund a pending loan request (become lender)')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const spin = ui.spinner(`Funding loan #${id}...`);
        const tx = await walletClient.writeContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'fundLoan',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Loan #${id} funded`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ──────────────────────────────────────────

  loan
    .command('status <id>')
    .description('View loan details')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const spin = ui.spinner(`Fetching loan #${id}...`);
        const result = await publicClient.readContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'getLoan',
          args: [BigInt(id)],
        }) as any;

        const l = parseLoanResult(result);

        spin.succeed(`Loan #${id}`);
        console.log(`  Borrower:     ${l.borrower}`);
        console.log(`  Lender:       ${l.lender === '0x0000000000000000000000000000000000000000' ? 'Unfunded' : l.lender}`);
        console.log(`  Principal:    ${formatLob(l.principal)}`);
        console.log(`  Interest:     ${formatLob(l.interestAmount)}`);
        console.log(`  Protocol fee: ${formatLob(l.protocolFee)}`);
        console.log(`  Collateral:   ${formatLob(l.collateralAmount)}`);
        console.log(`  Repaid:       ${formatLob(l.totalRepaid)}`);
        console.log(`  Status:       ${LOAN_STATUS[Number(l.status)] || 'Unknown'}`);
        console.log(`  Term:         ${LOAN_TERM[Number(l.term)] || 'Unknown'}`);
        console.log(`  Requested:    ${new Date(Number(l.requestedAt) * 1000).toISOString()}`);
        if (Number(l.fundedAt) > 0) {
          console.log(`  Funded:       ${new Date(Number(l.fundedAt) * 1000).toISOString()}`);
        }
        if (Number(l.dueDate) > 0) {
          console.log(`  Due date:     ${new Date(Number(l.dueDate) * 1000).toISOString()}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ────────────────────────────────────────────

  loan
    .command('list')
    .description("List user's active loans")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const spin = ui.spinner('Fetching loans...');
        const loanIds = await publicClient.readContract({
          address: loanAddr,
          abi: LOAN_ENGINE_ABI,
          functionName: 'getActiveLoanIds',
          args: [address],
        }) as bigint[];

        if (loanIds.length === 0) {
          spin.succeed('No active loans');
          return;
        }

        const loans: any[] = [];
        for (const lid of loanIds) {
          const result = await publicClient.readContract({
            address: loanAddr,
            abi: LOAN_ENGINE_ABI,
            functionName: 'getLoan',
            args: [lid],
          }) as any;

          loans.push(parseLoanResult(result));
        }

        spin.succeed(`${loans.length} loan(s)`);
        ui.table(
          ['ID', 'Principal', 'Collateral', 'Term', 'Due', 'Status'],
          loans.map((l: any) => [
            l.id.toString(),
            formatLob(l.principal),
            formatLob(l.collateralAmount),
            LOAN_TERM[Number(l.term)] || '?',
            Number(l.dueDate) > 0 ? new Date(Number(l.dueDate) * 1000).toLocaleDateString() : '-',
            LOAN_STATUS[Number(l.status)] || 'Unknown',
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── profile ─────────────────────────────────────────

  loan
    .command('profile')
    .description('View your borrower profile')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const loanAddr = getContractAddress(ws.config, 'loanEngine');

        const spin = ui.spinner('Fetching borrower profile...');
        const [profile, maxBorrow, interestRate] = await Promise.all([
          publicClient.readContract({
            address: loanAddr,
            abi: LOAN_ENGINE_ABI,
            functionName: 'getBorrowerProfile',
            args: [address],
          }) as any,
          publicClient.readContract({
            address: loanAddr,
            abi: LOAN_ENGINE_ABI,
            functionName: 'getMaxBorrow',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: loanAddr,
            abi: LOAN_ENGINE_ABI,
            functionName: 'getInterestRate',
            args: [address],
          }) as Promise<bigint>,
        ]);

        spin.succeed('Borrower Profile');
        console.log(`  Address:        ${address}`);
        console.log(`  Active loans:   ${profile[0]}`);
        console.log(`  Total borrowed: ${formatLob(profile[1])}`);
        console.log(`  Total repaid:   ${formatLob(profile[2])}`);
        console.log(`  Defaults:       ${profile[3]}`);
        console.log(`  Restricted:     ${profile[4] ? 'Yes' : 'No'}`);
        console.log(`  Max borrow:     ${formatLob(maxBorrow)}`);
        console.log(`  Interest rate:  ${Number(interestRate) / 100}%`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
