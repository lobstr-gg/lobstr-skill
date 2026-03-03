import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  PRODUCT_MARKETPLACE_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { formatLob } from '../lib/format';

const productAbi = parseAbi(PRODUCT_MARKETPLACE_ABI as unknown as string[]);

const CONDITION_NAMES: Record<number, string> = {
  0: 'NEW',
  1: 'LIKE_NEW',
  2: 'GOOD',
  3: 'FAIR',
  4: 'POOR',
  5: 'FOR_PARTS',
};

const CONDITION_INDEX: Record<string, number> = Object.fromEntries(
  Object.entries(CONDITION_NAMES).map(([k, v]) => [v, Number(k)])
);

const LISTING_TYPE_NAMES: Record<number, string> = {
  0: 'FIXED_PRICE',
  1: 'AUCTION',
};

const SHIPPING_STATUS: Record<number, string> = {
  0: 'NOT_SHIPPED',
  1: 'SHIPPED',
  2: 'DELIVERED',
  3: 'RETURN_REQUESTED',
};

export function registerProductCommands(program: Command): void {
  const product = program
    .command('product')
    .description('Product marketplace commands');

  // ── create ─────────────────────────────────────────

  product
    .command('create')
    .description('Create a product listing')
    .requiredOption('--listing-id <id>', 'ServiceRegistry listing ID (PHYSICAL_TASK category)')
    .requiredOption('--condition <condition>', `Condition (${Object.keys(CONDITION_INDEX).join(', ')})`)
    .requiredOption('--category <category>', 'Product category (e.g. Electronics, Clothing)')
    .requiredOption('--image <uri>', 'Image URI')
    .option('--shipping <uri>', 'Shipping info URI', '')
    .option('--quantity <n>', 'Quantity available', '1')
    .option('--tracking', 'Require shipping tracking', false)
    .option('--auction', 'List as auction (default: fixed price)', false)
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const conditionIdx = CONDITION_INDEX[opts.condition.toUpperCase()];
        if (conditionIdx === undefined) {
          throw new Error(`Unknown condition: ${opts.condition}. Available: ${Object.keys(CONDITION_INDEX).join(', ')}`);
        }

        const listingType = opts.auction ? 1 : 0;

        const spin = ui.spinner('Creating product...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'createProduct',
          args: [
            BigInt(opts.listingId),
            conditionIdx,
            opts.category,
            opts.shipping,
            opts.image,
            BigInt(opts.quantity),
            opts.tracking,
            listingType,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Product created');
        ui.info(`Listing ID: ${opts.listingId}`);
        ui.info(`Condition: ${opts.condition.toUpperCase()}`);
        ui.info(`Category: ${opts.category}`);
        ui.info(`Quantity: ${opts.quantity}`);
        ui.info(`Type: ${opts.auction ? 'AUCTION' : 'FIXED_PRICE'}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ───────────────────────────────────────────

  product
    .command('list')
    .description('List your products')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const walletAddr = wallet.address as `0x${string}`;

        const spin = ui.spinner('Fetching products...');

        const nextId = await publicClient.readContract({
          address: addr,
          abi: productAbi,
          functionName: 'nextProductId',
        }) as bigint;

        const products = [];
        for (let i = 0n; i < nextId; i++) {
          try {
            const result = await publicClient.readContract({
              address: addr,
              abi: productAbi,
              functionName: 'getProduct',
              args: [i],
            }) as any;
            const p = {
              id: result[0] ?? result.id,
              listingId: result[1] ?? result.listingId,
              seller: result[2] ?? result.seller,
              listingType: result[3] ?? result.listingType,
              condition: result[4] ?? result.condition,
              category: result[5] ?? result.productCategory,
              quantity: result[8] ?? result.quantity,
              sold: result[9] ?? result.sold,
              active: result[10] ?? result.active,
              price: result[13] ?? result.price,
            };
            if (p.seller.toLowerCase() === walletAddr.toLowerCase()) {
              products.push(p);
            }
          } catch { break; }
        }

        if (products.length === 0) {
          spin.succeed('No products found');
          return;
        }

        spin.succeed(`${products.length} product(s)`);

        ui.table(
          ['ID', 'Category', 'Condition', 'Price', 'Qty', 'Sold', 'Type', 'Active'],
          products.map((p: any) => [
            p.id.toString(),
            p.category,
            CONDITION_NAMES[Number(p.condition)] || 'Unknown',
            formatLob(p.price),
            p.quantity.toString(),
            p.sold.toString(),
            LISTING_TYPE_NAMES[Number(p.listingType)] || 'Unknown',
            p.active ? 'Yes' : 'No',
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── view ───────────────────────────────────────────

  product
    .command('view <id>')
    .description('View product details')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');
        const publicClient = createPublicClient(ws.config);

        const spin = ui.spinner('Fetching product...');
        const result = await publicClient.readContract({
          address: addr,
          abi: productAbi,
          functionName: 'getProduct',
          args: [BigInt(id)],
        }) as any;

        spin.succeed(`Product #${id}`);
        ui.info(`Listing ID: ${(result[1] ?? result.listingId).toString()}`);
        ui.info(`Seller: ${result[2] ?? result.seller}`);
        ui.info(`Type: ${LISTING_TYPE_NAMES[Number(result[3] ?? result.listingType)] || 'Unknown'}`);
        ui.info(`Condition: ${CONDITION_NAMES[Number(result[4] ?? result.condition)] || 'Unknown'}`);
        ui.info(`Category: ${result[5] ?? result.productCategory}`);
        ui.info(`Image: ${result[7] ?? result.imageURI}`);
        ui.info(`Price: ${formatLob(result[13] ?? result.price)}`);
        ui.info(`Quantity: ${(result[8] ?? result.quantity).toString()}`);
        ui.info(`Sold: ${(result[9] ?? result.sold).toString()}`);
        ui.info(`Active: ${(result[10] ?? result.active) ? 'Yes' : 'No'}`);
        ui.info(`Requires Tracking: ${(result[11] ?? result.requiresTracking) ? 'Yes' : 'No'}`);
        ui.info(`Token: ${result[12] ?? result.settlementToken}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── buy ────────────────────────────────────────────

  product
    .command('buy <id>')
    .description('Buy a product at fixed price')
    .option('--max-price <price>', 'Max price in LOB (slippage protection)', '0')
    .option('--deadline <seconds>', 'Delivery deadline in seconds', '604800')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Buying product...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        // If no max price, use max uint256 (no slippage protection)
        const maxPrice = opts.maxPrice !== '0'
          ? parseUnits(opts.maxPrice, 18)
          : BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'buyProduct',
          args: [BigInt(id), maxPrice, BigInt(opts.deadline)],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Product purchased');
        ui.info(`Product ID: ${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── buy-insured ────────────────────────────────────

  product
    .command('buy-insured <id>')
    .description('Buy a product with insurance coverage')
    .option('--max-price <price>', 'Max price in LOB (slippage protection)', '0')
    .option('--deadline <seconds>', 'Delivery deadline in seconds', '604800')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Buying product (insured)...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const maxPrice = opts.maxPrice !== '0'
          ? parseUnits(opts.maxPrice, 18)
          : BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'buyProductInsured',
          args: [BigInt(id), maxPrice, BigInt(opts.deadline)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Product purchased (insured)');
        ui.info(`Product ID: ${id}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── ship ───────────────────────────────────────────

  product
    .command('ship <jobId>')
    .description('Add shipping tracking to a product order')
    .requiredOption('--carrier <carrier>', 'Shipping carrier (e.g. UPS, FedEx, USPS)')
    .requiredOption('--tracking <number>', 'Tracking number')
    .action(async (jobId: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Adding shipping info...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'shipProduct',
          args: [BigInt(jobId), opts.carrier, opts.tracking],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Shipping info added');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Carrier: ${opts.carrier}`);
        ui.info(`Tracking: ${opts.tracking}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── confirm ────────────────────────────────────────

  product
    .command('confirm <jobId>')
    .description('Confirm receipt of a delivered product')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Confirming receipt...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'confirmReceipt',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Receipt confirmed — funds released to seller');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── return ─────────────────────────────────────────

  product
    .command('return <jobId>')
    .description('Request a return')
    .requiredOption('--reason <reason>', 'Reason for return')
    .action(async (jobId: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Requesting return...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'requestReturn',
          args: [BigInt(jobId), opts.reason],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Return requested');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Reason: ${opts.reason}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── damage ─────────────────────────────────────────

  product
    .command('damage <jobId>')
    .description('Report a damaged product')
    .requiredOption('--evidence <uri>', 'Evidence URI (photo/document)')
    .action(async (jobId: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Reporting damage...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'reportDamaged',
          args: [BigInt(jobId), opts.evidence],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Damage reported');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Evidence: ${opts.evidence}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── deactivate ─────────────────────────────────────

  product
    .command('deactivate <id>')
    .description('Deactivate a product listing')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Deactivating product...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'deactivateProduct',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Product #${id} deactivated`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── auction ────────────────────────────────────────

  product
    .command('auction <id>')
    .description('Create an auction for a product')
    .requiredOption('--start-price <price>', 'Starting bid price in LOB')
    .requiredOption('--reserve <price>', 'Reserve price in LOB')
    .requiredOption('--buy-now <price>', 'Buy-now price in LOB (0 to disable)')
    .requiredOption('--duration <seconds>', 'Auction duration in seconds')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Creating auction...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'createAuction',
          args: [
            BigInt(id),
            parseUnits(opts.startPrice, 18),
            parseUnits(opts.reserve, 18),
            parseUnits(opts.buyNow, 18),
            BigInt(opts.duration),
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Auction created');
        ui.info(`Product ID: ${id}`);
        ui.info(`Start Price: ${opts.startPrice} LOB`);
        ui.info(`Reserve: ${opts.reserve} LOB`);
        ui.info(`Buy Now: ${opts.buyNow} LOB`);
        ui.info(`Duration: ${opts.duration}s`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── bid ────────────────────────────────────────────

  product
    .command('bid <auctionId>')
    .description('Place a bid on an auction')
    .requiredOption('--amount <amount>', 'Bid amount in LOB')
    .action(async (auctionId: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Placing bid...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'placeBid',
          args: [BigInt(auctionId), parseUnits(opts.amount, 18)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Bid placed');
        ui.info(`Auction ID: ${auctionId}`);
        ui.info(`Amount: ${opts.amount} LOB`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── withdraw ───────────────────────────────────────

  product
    .command('withdraw')
    .description('Withdraw outbid funds')
    .requiredOption('--token <address>', 'Token address to withdraw')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Withdrawing bid...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'withdrawBid',
          args: [opts.token as `0x${string}`],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Bid funds withdrawn');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim ──────────────────────────────────────────

  product
    .command('claim <jobId>')
    .description('File an insurance claim for an insured purchase')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Filing insurance claim...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'fileInsuranceClaim',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Insurance claim filed');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── refund ─────────────────────────────────────────

  product
    .command('refund <jobId>')
    .description('Claim insurance refund for an approved claim')
    .action(async (jobId: string) => {
      try {
        const ws = ensureWorkspace();
        const addr = getContractAddress(ws.config, 'productMarketplace');

        const spin = ui.spinner('Claiming refund...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: addr,
          abi: productAbi,
          functionName: 'claimInsuranceRefund',
          args: [BigInt(jobId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Insurance refund claimed');
        ui.info(`Job ID: ${jobId}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
