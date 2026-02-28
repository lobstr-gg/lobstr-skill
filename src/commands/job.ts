import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  ESCROW_ENGINE_ABI,
  SERVICE_REGISTRY_ABI,
  LOB_TOKEN_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { JOB_STATUS, formatLob, CATEGORY_NAMES } from '../lib/format';

// X402 Credit Facility ABI (V3 — replaces V1 EscrowBridge)
const BRIDGE_ABI = parseAbi([
  'function jobPayer(uint256) view returns (address)',
  'function confirmDelivery(uint256 jobId)',
  'function initiateDispute(uint256 jobId, string evidenceURI)',
  'function claimEscrowRefund(uint256 jobId)',
  'function jobRefundCredit(uint256) view returns (uint256)',
  'function refundClaimed(uint256) view returns (bool)',
  'function getCreditLine(address) view returns (uint256 limit, uint256 drawn, uint256 available, bool active)',
  'function drawCredit(uint256 amount)',
  'function repayCredit(uint256 amount)',
]);
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function registerJobCommands(program: Command): void {
  const job = program
    .command('job')
    .description('Manage escrow jobs');

  job
    .command('create')
    .description('Create a job from a listing')
    .requiredOption('--listing <id>', 'Listing ID')
    .requiredOption('--amount <amount>', 'Payment amount in LOB')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        const publicClient = createPublicClient(ws.config);

        // Get listing to find seller
        const listingResult = await publicClient.readContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'getListing',
          args: [BigInt(opts.listing)],
        }) as any;

        const listing = {
          id: listingResult.id ?? listingResult[0],
          provider: listingResult.provider ?? listingResult[1],
          category: listingResult.category ?? listingResult[2],
          title: listingResult.title ?? listingResult[3],
          description: listingResult.description ?? listingResult[4],
          pricePerUnit: listingResult.pricePerUnit ?? listingResult[5],
          settlementToken: listingResult.settlementToken ?? listingResult[6],
          estimatedDeliverySeconds: listingResult.estimatedDeliverySeconds ?? listingResult[7],
          metadataURI: listingResult.metadataURI ?? listingResult[8],
          active: listingResult.active ?? listingResult[9],
          createdAt: listingResult.createdAt ?? listingResult[10],
        };

        const spin = ui.spinner('Creating job...');
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const parsedAmount = parseUnits(opts.amount, 18);

        // Approve token transfer
        spin.text = 'Approving LOB transfer...';
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: 'approve',
          args: [escrowAddr, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        // Create job
        spin.text = 'Creating job...';
        const tx = await walletClient.writeContract({
          address: escrowAddr,
          abi: escrowAbi,
          functionName: 'createJob',
          args: [BigInt(opts.listing), listing.provider, parsedAmount, tokenAddr],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Job created');
        ui.info(`Listing: #${opts.listing} — ${listing.title}`);
        ui.info(`Amount: ${opts.amount} LOB`);
        ui.info(`Seller: ${listing.provider}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('deliver <id>')
    .description('Submit delivery for a job')
    .requiredOption('--evidence <uri>', 'Delivery evidence URI')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');

        const spin = ui.spinner('Submitting delivery...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: escrowAddr,
          abi: escrowAbi,
          functionName: 'submitDelivery',
          args: [BigInt(id), opts.evidence],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Delivery submitted for job #${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('confirm <id>')
    .description('Confirm delivery as buyer')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');

        const spin = ui.spinner('Confirming delivery...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        // Check if this is a bridge job
        const bridgeAddr = getContractAddress(ws.config, 'x402CreditFacility') as `0x${string}`;
        const bridgePayer = await publicClient.readContract({
          address: bridgeAddr,
          abi: BRIDGE_ABI,
          functionName: 'jobPayer',
          args: [BigInt(id)],
        });
        const isBridgeJob = bridgePayer !== ZERO_ADDRESS;

        let tx: `0x${string}`;
        if (isBridgeJob) {
          spin.text = 'Confirming via x402 bridge...';
          tx = await walletClient.writeContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'confirmDelivery',
            args: [BigInt(id)],
          });
        } else {
          tx = await walletClient.writeContract({
            address: escrowAddr,
            abi: escrowAbi,
            functionName: 'confirmDelivery',
            args: [BigInt(id)],
          });
        }
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Delivery confirmed for job #${id}${isBridgeJob ? ' (x402)' : ''}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('dispute <id>')
    .description('Initiate a dispute')
    .requiredOption('--evidence <uri>', 'Evidence URI')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');

        const spin = ui.spinner('Initiating dispute...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        // Check if this is a bridge job
        const bridgeAddr = getContractAddress(ws.config, 'x402CreditFacility') as `0x${string}`;
        const bridgePayer = await publicClient.readContract({
          address: bridgeAddr,
          abi: BRIDGE_ABI,
          functionName: 'jobPayer',
          args: [BigInt(id)],
        });
        const isBridgeJob = bridgePayer !== ZERO_ADDRESS;

        let tx: `0x${string}`;
        if (isBridgeJob) {
          spin.text = 'Initiating dispute via x402 bridge...';
          tx = await walletClient.writeContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'initiateDispute',
            args: [BigInt(id), opts.evidence],
          });
        } else {
          tx = await walletClient.writeContract({
            address: escrowAddr,
            abi: escrowAbi,
            functionName: 'initiateDispute',
            args: [BigInt(id), opts.evidence],
          });
        }
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Dispute initiated for job #${id}${isBridgeJob ? ' (x402)' : ''}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('refund <id>')
    .description('Claim escrow refund for a resolved x402 dispute')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const spin = ui.spinner('Checking refund eligibility...');

        // Verify this is a bridge job with a refund credit
        const bridgeAddr = getContractAddress(ws.config, 'x402CreditFacility') as `0x${string}`;
        const [bridgePayer, credit, claimed] = await Promise.all([
          publicClient.readContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'jobPayer',
            args: [BigInt(id)],
          }),
          publicClient.readContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'jobRefundCredit',
            args: [BigInt(id)],
          }),
          publicClient.readContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'refundClaimed',
            args: [BigInt(id)],
          }),
        ]);

        if (bridgePayer === ZERO_ADDRESS) {
          spin.fail('Not a bridge job');
          return;
        }
        if (claimed) {
          spin.fail('Refund already claimed');
          return;
        }
        if (credit === 0n) {
          spin.fail('No refund credit available');
          return;
        }

        spin.text = 'Claiming refund...';
        const tx = await walletClient.writeContract({
          address: bridgeAddr,
          abi: BRIDGE_ABI,
          functionName: 'claimEscrowRefund',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Refund claimed for job #${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('status <id>')
    .description('Check job status')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');

        const spin = ui.spinner('Fetching job...');
        const publicClient = createPublicClient(ws.config);

        const jobResult = await publicClient.readContract({
          address: escrowAddr,
          abi: escrowAbi,
          functionName: 'getJob',
          args: [BigInt(id)],
        }) as any;

        const jobData = {
          id: jobResult.id ?? jobResult[0],
          listingId: jobResult.listingId ?? jobResult[1],
          buyer: jobResult.buyer ?? jobResult[2],
          seller: jobResult.seller ?? jobResult[3],
          amount: jobResult.amount ?? jobResult[4],
          token: jobResult.token ?? jobResult[5],
          fee: jobResult.fee ?? jobResult[6],
          status: jobResult.status ?? jobResult[7],
          createdAt: jobResult.createdAt ?? jobResult[8],
          disputeWindowEnd: jobResult.disputeWindowEnd ?? jobResult[9],
          deliveryMetadataURI: jobResult.deliveryMetadataURI ?? jobResult[10],
        };

        // Check if this is a bridge job
        const bridgeAddr = getContractAddress(ws.config, 'x402CreditFacility') as `0x${string}`;
        let isBridgeJob = false;
        let realPayer = '';
        try {
          const bridgePayer = await publicClient.readContract({
            address: bridgeAddr,
            abi: BRIDGE_ABI,
            functionName: 'jobPayer',
            args: [BigInt(id)],
          });
          if (bridgePayer !== ZERO_ADDRESS) {
            isBridgeJob = true;
            realPayer = bridgePayer;
          }
        } catch { /* bridge not available or job not a bridge job */ }

        spin.succeed(`Job #${id}${isBridgeJob ? ' (x402)' : ''}`);
        console.log(`  Listing:  #${jobData.listingId}`);
        if (isBridgeJob) {
          console.log(`  Payer:    ${realPayer} (via x402 bridge)`);
          console.log(`  Bridge:   ${jobData.buyer}`);
        } else {
          console.log(`  Buyer:    ${jobData.buyer}`);
        }
        console.log(`  Seller:   ${jobData.seller}`);
        console.log(`  Amount:   ${formatLob(jobData.amount)}`);
        console.log(`  Fee:      ${formatLob(jobData.fee)}`);
        console.log(`  Status:   ${JOB_STATUS[Number(jobData.status)] || 'Unknown'}`);
        console.log(`  Created:  ${new Date(Number(jobData.createdAt) * 1000).toISOString()}`);
        if (jobData.disputeWindowEnd > 0n) {
          console.log(`  Dispute window: ${new Date(Number(jobData.disputeWindowEnd) * 1000).toISOString()}`);
        }
        if (jobData.deliveryMetadataURI) {
          console.log(`  Delivery: ${jobData.deliveryMetadataURI}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  job
    .command('list')
    .description('List jobs (recent)')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const escrowAbi = parseAbi(ESCROW_ENGINE_ABI as unknown as string[]);
        const escrowAddr = getContractAddress(ws.config, 'escrowEngine');

        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address.toLowerCase();

        const spin = ui.spinner('Fetching jobs...');

        // Scan recent job IDs
        const jobs = [];
        for (let i = 1n; i <= 100n; i++) {
          try {
            const jobResult = await publicClient.readContract({
              address: escrowAddr,
              abi: escrowAbi,
              functionName: 'getJob',
              args: [i],
            }) as any;

            const jobData = {
              id: jobResult.id ?? jobResult[0],
              listingId: jobResult.listingId ?? jobResult[1],
              buyer: jobResult.buyer ?? jobResult[2],
              seller: jobResult.seller ?? jobResult[3],
              amount: jobResult.amount ?? jobResult[4],
              token: jobResult.token ?? jobResult[5],
              fee: jobResult.fee ?? jobResult[6],
              status: jobResult.status ?? jobResult[7],
              createdAt: jobResult.createdAt ?? jobResult[8],
              disputeWindowEnd: jobResult.disputeWindowEnd ?? jobResult[9],
              deliveryMetadataURI: jobResult.deliveryMetadataURI ?? jobResult[10],
            };

            const isMine =
              jobData.buyer.toLowerCase() === address ||
              jobData.seller.toLowerCase() === address;

            if (isMine) {
              if (opts.status) {
                const statusNum = Object.entries(JOB_STATUS).find(
                  ([, v]) => v.toLowerCase() === opts.status.toLowerCase()
                )?.[0];
                if (statusNum && Number(jobData.status) !== Number(statusNum)) continue;
              }
              jobs.push(jobData);
            }
          } catch { break; }
        }

        spin.succeed(`${jobs.length} job(s)`);

        if (jobs.length === 0) {
          ui.info('No jobs found');
          return;
        }

        ui.table(
          ['ID', 'Role', 'Amount', 'Status', 'Created'],
          jobs.map((j: any) => [
            j.id.toString(),
            j.buyer.toLowerCase() === address ? 'Buyer' : 'Seller',
            formatLob(j.amount),
            JOB_STATUS[Number(j.status)] || 'Unknown',
            new Date(Number(j.createdAt) * 1000).toLocaleDateString(),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
