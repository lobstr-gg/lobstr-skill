import { Command } from 'commander';
import { parseAbi, parseUnits, formatUnits } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
} from 'openclaw';
import * as ui from 'openclaw';

const SKILL_REGISTRY_ABI = parseAbi([
  'function listSkill(uint8 category, string name, string description, uint256 pricePerCall, address settlementToken, string metadataURI)',
  'function updateSkill(uint256 skillId, string name, string description, uint256 pricePerCall, string metadataURI)',
  'function deactivateSkill(uint256 skillId)',
  'function getSkill(uint256 skillId) view returns (uint256 id, address seller, uint8 category, string name, string description, uint256 pricePerCall, address settlementToken, string metadataURI, bool active)',
  'function getSellerListingCount(address seller) view returns (uint256)',
  'function hasActiveAccess(address buyer, uint256 skillId) view returns (bool)',
]);

export function registerSkillCommands(program: Command): void {
  const skill = program
    .command('skill')
    .description('Skill registry commands');

  // ── register ────────────────────────────────────────

  skill
    .command('register')
    .description('List a new skill on the registry')
    .requiredOption('--category <n>', 'Category ID (uint8)')
    .requiredOption('--name <name>', 'Skill name')
    .requiredOption('--description <desc>', 'Skill description')
    .requiredOption('--price <amount>', 'Price per call (in token units)')
    .requiredOption('--token <address>', 'Settlement token address')
    .requiredOption('--metadata <uri>', 'Metadata URI')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const skillAddr = getContractAddress(ws.config, 'skillRegistry');

        const spin = ui.spinner('Listing skill...');
        const tx = await walletClient.writeContract({
          address: skillAddr,
          abi: SKILL_REGISTRY_ABI,
          functionName: 'listSkill',
          args: [
            parseInt(opts.category, 10),
            opts.name,
            opts.description,
            parseUnits(opts.price, 18),
            opts.token as `0x${string}`,
            opts.metadata,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Skill listed');
        ui.info(`Name: ${opts.name}`);
        ui.info(`Category: ${opts.category}`);
        ui.info(`Price/call: ${opts.price}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── update ──────────────────────────────────────────

  skill
    .command('update <id>')
    .description('Update an existing skill')
    .requiredOption('--name <name>', 'New name')
    .requiredOption('--description <desc>', 'New description')
    .requiredOption('--price <amount>', 'New price per call (in token units)')
    .requiredOption('--metadata <uri>', 'New metadata URI')
    .action(async (id: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const skillAddr = getContractAddress(ws.config, 'skillRegistry');

        const spin = ui.spinner(`Updating skill #${id}...`);
        const tx = await walletClient.writeContract({
          address: skillAddr,
          abi: SKILL_REGISTRY_ABI,
          functionName: 'updateSkill',
          args: [BigInt(id), opts.name, opts.description, parseUnits(opts.price, 18), opts.metadata],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Skill #${id} updated`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list ────────────────────────────────────────────

  skill
    .command('list [address]')
    .description('Show listing count for a seller')
    .action(async (address?: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const skillAddr = getContractAddress(ws.config, 'skillRegistry');

        let sellerAddr: `0x${string}`;
        if (address) {
          sellerAddr = address as `0x${string}`;
        } else {
          const wallet = loadWallet(ws.path);
          sellerAddr = wallet.address as `0x${string}`;
        }

        const spin = ui.spinner('Fetching listing count...');
        const count = await publicClient.readContract({
          address: skillAddr,
          abi: SKILL_REGISTRY_ABI,
          functionName: 'getSellerListingCount',
          args: [sellerAddr],
        }) as bigint;

        spin.succeed(`Seller ${sellerAddr} has ${count.toString()} skill listing(s)`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── view ────────────────────────────────────────────

  skill
    .command('view <id>')
    .description('View skill details')
    .action(async (id: string) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const skillAddr = getContractAddress(ws.config, 'skillRegistry');

        const spin = ui.spinner(`Fetching skill #${id}...`);
        const result = await publicClient.readContract({
          address: skillAddr,
          abi: SKILL_REGISTRY_ABI,
          functionName: 'getSkill',
          args: [BigInt(id)],
        }) as any;

        const skillData = {
          id: result.id ?? result[0],
          seller: result.seller ?? result[1],
          category: result.category ?? result[2],
          name: result.name ?? result[3],
          description: result.description ?? result[4],
          pricePerCall: result.pricePerCall ?? result[5],
          settlementToken: result.settlementToken ?? result[6],
          metadataURI: result.metadataURI ?? result[7],
          active: result.active ?? result[8],
        };

        spin.succeed(`Skill #${id}`);
        console.log(`  Name:        ${skillData.name}`);
        console.log(`  Seller:      ${skillData.seller}`);
        console.log(`  Category:    ${skillData.category}`);
        console.log(`  Description: ${skillData.description}`);
        console.log(`  Price/call:  ${formatUnits(skillData.pricePerCall, 18)}`);
        console.log(`  Token:       ${skillData.settlementToken}`);
        console.log(`  Metadata:    ${skillData.metadataURI}`);
        console.log(`  Active:      ${skillData.active ? 'Yes' : 'No'}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
