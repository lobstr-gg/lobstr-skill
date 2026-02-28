import { Command } from 'commander';
import { parseAbi } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
} from 'openclaw';
import * as ui from 'openclaw';

const REVIEW_REGISTRY_ABI = parseAbi([
  'function submitReview(uint256 jobId, uint8 rating, string metadataURI)',
  'function getReview(uint256 reviewId) view returns (uint256 id, uint256 jobId, address reviewer, uint8 rating, string metadataURI, uint256 timestamp)',
  'function getReviewByJobAndReviewer(uint256 jobId, address reviewer) view returns (uint256 id, uint256 jobId, address reviewer, uint8 rating, string metadataURI, uint256 timestamp)',
  'function getRatingStats(address subject) view returns (uint256 totalRatings, uint256 sumRatings, uint256 avgRating)',
  'function getAverageRating(address subject) view returns (uint256 numerator, uint256 denominator)',
]);

export function registerReviewCommands(program: Command): void {
  const review = program
    .command('review')
    .description('Review registry commands');

  // ── submit ──────────────────────────────────────────

  review
    .command('submit')
    .description('Submit a review for a completed job')
    .requiredOption('--job <id>', 'Job ID')
    .requiredOption('--rating <1-5>', 'Rating (1-5)')
    .requiredOption('--metadata <uri>', 'Metadata URI for the review')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const reviewAddr = getContractAddress(ws.config, 'reviewRegistry');

        const rating = parseInt(opts.rating, 10);
        if (rating < 1 || rating > 5) {
          ui.error('Rating must be between 1 and 5');
          process.exit(1);
        }

        const spin = ui.spinner('Submitting review...');
        const tx = await walletClient.writeContract({
          address: reviewAddr,
          abi: REVIEW_REGISTRY_ABI,
          functionName: 'submitReview',
          args: [BigInt(opts.job), rating, opts.metadata],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Review submitted');
        ui.info(`Job: #${opts.job}`);
        ui.info(`Rating: ${'*'.repeat(rating)}${'_'.repeat(5 - rating)} (${rating}/5)`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ────────────────────────────────────────────

  review
    .command('stats <address>')
    .description('View rating stats for an address')
    .action(async (address: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const reviewAddr = getContractAddress(ws.config, 'reviewRegistry');

        const spin = ui.spinner('Fetching rating stats...');
        const result = await publicClient.readContract({
          address: reviewAddr,
          abi: REVIEW_REGISTRY_ABI,
          functionName: 'getRatingStats',
          args: [address as `0x${string}`],
        }) as any;

        const stats = {
          totalRatings: result.totalRatings ?? result[0],
          sumRatings: result.sumRatings ?? result[1],
          avgRating: result.avgRating ?? result[2],
        };

        if (Number(stats.totalRatings) === 0) {
          spin.succeed('No ratings found');
          return;
        }

        spin.succeed(`Rating stats for ${address}`);
        console.log(`  Total ratings: ${stats.totalRatings.toString()}`);
        console.log(`  Sum ratings:   ${stats.sumRatings.toString()}`);
        console.log(`  Avg rating:    ${stats.avgRating.toString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── view ────────────────────────────────────────────

  review
    .command('view <id>')
    .description('View review details')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const reviewAddr = getContractAddress(ws.config, 'reviewRegistry');

        const spin = ui.spinner(`Fetching review #${id}...`);
        const result = await publicClient.readContract({
          address: reviewAddr,
          abi: REVIEW_REGISTRY_ABI,
          functionName: 'getReview',
          args: [BigInt(id)],
        }) as any;

        const reviewData = {
          id: result.id ?? result[0],
          jobId: result.jobId ?? result[1],
          reviewer: result.reviewer ?? result[2],
          rating: result.rating ?? result[3],
          metadataURI: result.metadataURI ?? result[4],
          timestamp: result.timestamp ?? result[5],
        };

        spin.succeed(`Review #${id}`);
        console.log(`  Job:      #${reviewData.jobId}`);
        console.log(`  Reviewer: ${reviewData.reviewer}`);
        console.log(`  Rating:   ${'*'.repeat(Number(reviewData.rating))}${'_'.repeat(5 - Number(reviewData.rating))} (${reviewData.rating}/5)`);
        console.log(`  Metadata: ${reviewData.metadataURI}`);
        console.log(`  Date:     ${new Date(Number(reviewData.timestamp) * 1000).toISOString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
