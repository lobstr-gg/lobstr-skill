import { Command } from 'commander';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { parseAbi, formatUnits, parseUnits, type Address } from 'viem';
import {
  ensureWorkspace,
  encryptKey,
  saveWallet,
  loadWallet,
  decryptKey,
  walletExists,
  promptPassword,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  LOB_TOKEN_ABI,
} from 'openclaw';
import * as ui from 'openclaw';

const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Manage agent wallet');

  wallet
    .command('create')
    .description('Generate a new agent wallet')
    .action(async () => {
      try {
        const ws = ensureWorkspace();

        if (walletExists(ws.path)) {
          ui.error('Wallet already exists. Use "lobstr wallet address" to view it.');
          process.exit(1);
        }

        const password = await promptPassword('Create wallet password: ');
        const confirm = await promptPassword('Confirm password: ');

        if (password !== confirm) {
          ui.error('Passwords do not match');
          process.exit(1);
        }

        if (password.length < 8) {
          ui.error('Password must be at least 8 characters');
          process.exit(1);
        }

        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        const encrypted = encryptKey(privateKey, password);
        encrypted.address = account.address;

        saveWallet(ws.path, encrypted);

        ui.success('Wallet created');
        ui.info(`Address: ${account.address}`);
        ui.warn('Back up your password — it cannot be recovered');
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  wallet
    .command('address')
    .description('Show wallet address')
    .action(() => {
      try {
        const ws = ensureWorkspace();
        const w = loadWallet(ws.path);
        console.log(w.address);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  wallet
    .command('balance')
    .description('Show LOB and ETH balance')
    .option('--format <fmt>', 'Output format: text, json', 'text')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const w = loadWallet(ws.path);
        const publicClient = createPublicClient(ws.config);
        const address = w.address as `0x${string}`;

        const spin = opts.format !== 'json' ? ui.spinner('Fetching balances...') : null;

        // ETH balance
        const ethBalance = await publicClient.getBalance({ address });

        // LOB balance
        let lobBalance = BigInt(0);
        try {
          const tokenAddr = getContractAddress(ws.config, 'lobToken');
          lobBalance = await publicClient.readContract({
            address: tokenAddr,
            abi: parseAbi(LOB_TOKEN_ABI as unknown as string[]),
            functionName: 'balanceOf',
            args: [address],
          }) as bigint;
        } catch {
          // Token contract not configured
        }

        if (opts.format === 'json') {
          console.log(JSON.stringify({
            address,
            ethBalance: formatUnits(ethBalance, 18),
            lobBalance: formatUnits(lobBalance, 18),
          }));
          return;
        }

        spin!.succeed('Balances');
        console.log(`  Address: ${address}`);
        console.log(`  ETH:     ${formatUnits(ethBalance, 18)}`);
        console.log(`  LOB:     ${formatUnits(lobBalance, 18)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── send ──────────────────────────────────────────

  wallet
    .command('send <amount> <recipient>')
    .description('Send ETH or LOB to an address')
    .option('--token <eth|lob>', 'Token to send (default: lob)', 'lob')
    .action(async (amount: string, recipient: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const token = opts.token.toLowerCase();

        if (token !== 'eth' && token !== 'lob') {
          ui.error('Token must be "eth" or "lob"');
          process.exit(1);
        }

        const parsedAmount = parseUnits(amount, 18);
        const spin = ui.spinner(`Sending ${amount} ${token.toUpperCase()} to ${recipient}...`);

        let tx: `0x${string}`;
        if (token === 'eth') {
          tx = await walletClient.sendTransaction({
            to: recipient as Address,
            value: parsedAmount,
          });
        } else {
          const tokenAddr = getContractAddress(ws.config, 'lobToken');
          tx = await walletClient.writeContract({
            address: tokenAddr,
            abi: tokenAbi,
            functionName: 'transfer',
            args: [recipient as Address, parsedAmount],
          });
        }

        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Sent ${amount} ${token.toUpperCase()} to ${recipient}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── import ──────────────────────────────────────────

  wallet
    .command('import')
    .description('Import an existing private key')
    .action(async () => {
      try {
        const ws = ensureWorkspace();

        if (walletExists(ws.path)) {
          ui.error('Wallet already exists. Remove wallet.json first to re-import.');
          process.exit(1);
        }

        const privateKey = await promptPassword('Private key (0x...): ');
        if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
          ui.error('Invalid private key format (expected 0x + 64 hex chars)');
          process.exit(1);
        }

        const account = privateKeyToAccount(privateKey as `0x${string}`);

        const password = await promptPassword('Create wallet password: ');
        const confirm = await promptPassword('Confirm password: ');

        if (password !== confirm) {
          ui.error('Passwords do not match');
          process.exit(1);
        }

        const encrypted = encryptKey(privateKey, password);
        encrypted.address = account.address;

        saveWallet(ws.path, encrypted);

        ui.success('Wallet imported');
        ui.info(`Address: ${account.address}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
