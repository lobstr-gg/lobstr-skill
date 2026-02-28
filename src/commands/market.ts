import { Command } from 'commander';
import { parseAbi, parseUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  SERVICE_REGISTRY_ABI,
} from 'openclaw';
import * as ui from 'openclaw';
import { categoryToIndex, CATEGORY_NAMES, formatLob, CATEGORIES } from '../lib/format';

export function registerMarketCommands(program: Command): void {
  const market = program
    .command('market')
    .description('Manage service listings');

  market
    .command('create')
    .description('Create a new service listing')
    .requiredOption('--title <title>', 'Listing title')
    .requiredOption('--category <category>', `Category (${Object.keys(CATEGORIES).join(', ')})`)
    .requiredOption('--price <price>', 'Price per unit in LOB')
    .option('--description <desc>', 'Listing description', '')
    .option('--delivery <seconds>', 'Estimated delivery time in seconds', '86400')
    .option('--metadata <uri>', 'Metadata URI (IPFS, etc.)', '')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        const spin = ui.spinner('Creating listing...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const categoryIdx = categoryToIndex(opts.category);
        const price = parseUnits(opts.price, 18);
        const delivery = parseInt(opts.delivery, 10);

        const tx = await walletClient.writeContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'createListing',
          args: [categoryIdx, opts.title, opts.description, price, tokenAddr, BigInt(delivery), opts.metadata],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Listing created');
        ui.info(`Title: ${opts.title}`);
        ui.info(`Category: ${opts.category}`);
        ui.info(`Price: ${opts.price} LOB`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  market
    .command('list')
    .description('List your active listings')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');

        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;

        const spin = ui.spinner('Fetching listings...');

        const count = await publicClient.readContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'getProviderListingCount',
          args: [address],
        }) as bigint;

        if (count === 0n) {
          spin.succeed('No listings found');
          return;
        }

        // Fetch listings by ID (1-indexed up to count, but we need to search)
        const listings = [];
        for (let i = 1n; i <= count + 10n; i++) {
          try {
            const listingResult = await publicClient.readContract({
              address: registryAddr,
              abi: registryAbi,
              functionName: 'getListing',
              args: [i],
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
            if (listing.provider.toLowerCase() === address.toLowerCase()) {
              listings.push(listing);
            }
          } catch { break; }
          if (BigInt(listings.length) >= count) break;
        }

        spin.succeed(`${listings.length} listing(s)`);

        ui.table(
          ['ID', 'Title', 'Category', 'Price', 'Active'],
          listings.map((l: any) => [
            l.id.toString(),
            l.title,
            CATEGORY_NAMES[Number(l.category)] || 'Unknown',
            formatLob(l.pricePerUnit),
            l.active ? 'Yes' : 'No',
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  market
    .command('update <id>')
    .description('Update a listing')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--price <price>', 'New price in LOB')
    .option('--delivery <seconds>', 'New delivery time')
    .option('--metadata <uri>', 'New metadata URI')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');
        const tokenAddr = getContractAddress(ws.config, 'lobToken');

        const publicClient = createPublicClient(ws.config);

        // Get current listing values
        const currentResult = await publicClient.readContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'getListing',
          args: [BigInt(id)],
        }) as any;

        const current = {
          id: currentResult.id ?? currentResult[0],
          provider: currentResult.provider ?? currentResult[1],
          category: currentResult.category ?? currentResult[2],
          title: currentResult.title ?? currentResult[3],
          description: currentResult.description ?? currentResult[4],
          pricePerUnit: currentResult.pricePerUnit ?? currentResult[5],
          settlementToken: currentResult.settlementToken ?? currentResult[6],
          estimatedDeliverySeconds: currentResult.estimatedDeliverySeconds ?? currentResult[7],
          metadataURI: currentResult.metadataURI ?? currentResult[8],
          active: currentResult.active ?? currentResult[9],
          createdAt: currentResult.createdAt ?? currentResult[10],
        };

        const spin = ui.spinner('Updating listing...');
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const title = opts.title || current.title;
        const description = opts.description || current.description;
        const price = opts.price ? parseUnits(opts.price, 18) : current.pricePerUnit;
        const delivery = opts.delivery ? BigInt(opts.delivery) : current.estimatedDeliverySeconds;
        const metadata = opts.metadata || current.metadataURI;
        const settlement = current.settlementToken;

        const tx = await walletClient.writeContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'updateListing',
          args: [BigInt(id), title, description, price, settlement, delivery, metadata],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Listing #${id} updated`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  market
    .command('deactivate <id>')
    .description('Deactivate a listing')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const registryAbi = parseAbi(SERVICE_REGISTRY_ABI as unknown as string[]);
        const registryAddr = getContractAddress(ws.config, 'serviceRegistry');

        const spin = ui.spinner('Deactivating listing...');
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const tx = await walletClient.writeContract({
          address: registryAddr,
          abi: registryAbi,
          functionName: 'deactivateListing',
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Listing #${id} deactivated`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
