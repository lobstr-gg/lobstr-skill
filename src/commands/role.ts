import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { parseAbi } from 'viem';
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  loadWallet,
  buildRoleMerkleTree,
  poseidonHash,
  ROLE_PAYROLL_ABI,
  ROLE_TREE_SIZE,
} from 'openclaw';
import type { RoleHeartbeatEntry, RoleUptimeInput } from 'openclaw';
import * as ui from 'openclaw';
import { formatLob, formatUsdc, ROLE_TYPE, ROLE_RANK, ROLE_SLOT_STATUS } from '../lib/format';

const rolePayrollAbi = parseAbi(ROLE_PAYROLL_ABI as unknown as string[]);

export function registerRoleCommands(program: Command): void {
  const role = program
    .command('role')
    .description('Community role payroll: enroll, prove uptime, claim weekly pay');

  // ── activate ──────────────────────────────────────────────────

  role
    .command('activate')
    .description('Enroll in a paid community role (pays USDC cert fee, locks LOB stake)')
    .argument('<type>', 'Role type: arbitrator or moderator')
    .argument('<rank>', 'Rank: junior, senior, or principal')
    .action(async (type: string, rank: string) => {
      try {
        const roleType = _parseRoleType(type);
        const roleRank = _parseRoleRank(rank);

        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        // Show config first
        const config = await publicClient.readContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'getRoleConfig',
          args: [roleType, roleRank],
        }) as any;

        console.log(`Enrolling as ${ROLE_TYPE[roleType]} ${ROLE_RANK[roleRank]}:`);
        console.log(`  Cert fee:   ${formatUsdc(config.certFeeUsdc)}`);
        console.log(`  Min stake:  ${formatLob(config.minStakeLob)}`);
        console.log(`  Weekly pay: ${formatLob(config.weeklyBaseLob)}`);

        const spin = ui.spinner('Enrolling...');

        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'enroll',
          args: [roleType, roleRank],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Enrolled successfully');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ────────────────────────────────────────────────────

  role
    .command('status')
    .description('Show your current role, uptime, strikes, and pending pay')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const spin = ui.spinner('Fetching role status...');

        const [slot, epoch, lastHb, isFounder] = await Promise.all([
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'getRoleSlot',
            args: [address],
          }) as Promise<any>,
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'currentEpoch',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'lastHeartbeatTimestamp',
            args: [address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'founderAgents',
            args: [address],
          }) as Promise<boolean>,
        ]);

        spin.succeed('Role Status');

        if (isFounder) {
          console.log('  Status: Founder Agent (exempt)');
          return;
        }

        const status = Number(slot.status);
        console.log(`  Status:      ${ROLE_SLOT_STATUS[status] || 'Unknown'}`);

        if (status === 0) {
          console.log('  Not enrolled. Use "lobstr role activate <type> <rank>" to enroll.');
          return;
        }

        console.log(`  Role:        ${ROLE_TYPE[Number(slot.roleType)]} ${ROLE_RANK[Number(slot.rank)]}`);
        console.log(`  Strikes:     ${slot.strikes}/4`);
        console.log(`  Staked:      ${formatLob(slot.stakedAmount)}`);
        console.log(`  Last HB:     ${lastHb > 0n ? new Date(Number(lastHb) * 1000).toISOString() : 'never'}`);
        console.log(`  Epoch:       ${epoch}`);

        if (slot.suspendedUntil > 0n && BigInt(Math.floor(Date.now() / 1000)) < slot.suspendedUntil) {
          console.log(`  Suspended until: ${new Date(Number(slot.suspendedUntil) * 1000).toISOString()}`);
        }

        // Check heartbeat file
        const hbPath = path.join(ws.path, 'role-heartbeats.jsonl');
        if (fs.existsSync(hbPath)) {
          const lines = fs.readFileSync(hbPath, 'utf-8').trim().split('\n').filter(Boolean);
          console.log(`  Local HBs:   ${lines.length} entries`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── prove ─────────────────────────────────────────────────────

  role
    .command('prove')
    .description('Generate ZK uptime proof for a completed epoch')
    .option('--epoch <n>', 'Epoch number (default: last completed)')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const wallet = loadWallet(ws.path);
        const address = wallet.address as `0x${string}`;
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const [currentEpochBig, genesisBig] = await Promise.all([
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'currentEpoch',
          }) as Promise<bigint>,
          publicClient.readContract({
            address: payrollAddr,
            abi: rolePayrollAbi,
            functionName: 'genesisEpoch',
          }) as Promise<bigint>,
        ]);

        const currentEpochNum = Number(currentEpochBig);
        const genesis = Number(genesisBig);
        const targetEpoch = opts.epoch ? parseInt(opts.epoch, 10) : currentEpochNum - 1;

        if (targetEpoch >= currentEpochNum) {
          ui.error('Epoch not yet completed');
          process.exit(1);
        }

        const weekStart = genesis + targetEpoch * 7 * 24 * 3600;
        const weekEnd = weekStart + 7 * 24 * 3600;

        const spin = ui.spinner(`Building proof for epoch ${targetEpoch}...`);

        // Read role heartbeats
        const hbPath = path.join(ws.path, 'role-heartbeats.jsonl');
        if (!fs.existsSync(hbPath)) {
          spin.fail('No role-heartbeats.jsonl found');
          process.exit(1);
        }

        const allEntries: RoleHeartbeatEntry[] = fs.readFileSync(hbPath, 'utf-8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));

        // Filter entries for this epoch
        const epochEntries = allEntries.filter(
          (e) => e.timestamp >= weekStart && e.timestamp < weekEnd
        );

        spin.text = `Found ${epochEntries.length} heartbeats for epoch ${targetEpoch}`;

        // Build Merkle tree from heartbeat hashes
        const leaves = epochEntries.map((e) => BigInt(e.hash));
        // Pad to tree size
        while (leaves.length < ROLE_TREE_SIZE) {
          leaves.push(BigInt(0));
        }

        const tree = await buildRoleMerkleTree(leaves);

        // Sample 32 random positions (seeded by weekEnd for determinism)
        const sampledIndices: number[] = [];
        const validCount = epochEntries.length;

        if (validCount < 32) {
          spin.fail(`Not enough heartbeats (${validCount}) — need at least 32`);
          process.exit(1);
        }

        // Use block-hash-like seed for sampling
        let seed = BigInt(weekEnd);
        for (let i = 0; i < 32; i++) {
          seed = BigInt('0x' + require('crypto')
            .createHash('sha256')
            .update(seed.toString() + i.toString())
            .digest('hex'));
          const idx = Number(seed % BigInt(validCount));
          sampledIndices.push(idx);
        }

        // Build circuit input
        const sampledLeaves: string[] = [];
        const sampledPathElements: string[][] = [];
        const sampledPathIndices: number[][] = [];

        for (const idx of sampledIndices) {
          sampledLeaves.push(leaves[idx].toString());
          const proof = tree.getProof(idx);
          sampledPathElements.push(proof.pathElements.map((e) => e.toString()));
          sampledPathIndices.push(proof.pathIndices);
        }

        const input: RoleUptimeInput = {
          claimantAddress: BigInt(address).toString(),
          uptimeCount: validCount,
          weekStart,
          merkleRoot: tree.root.toString(),
          sampledLeaves,
          sampledPathElements,
          sampledPathIndices,
        };

        // Write input file
        const attestDir = path.join(ws.path, 'role-attestation');
        if (!fs.existsSync(attestDir)) fs.mkdirSync(attestDir, { recursive: true });

        const inputPath = path.join(attestDir, 'input.json');
        fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
        spin.text = 'Generating Groth16 proof...';

        // Generate proof with snarkjs
        const snarkjs = require('snarkjs');
        const circuitWasm = _findCircuitFile('roleUptime.wasm');
        const zkeyFile = _findCircuitFile('roleUptime_final.zkey');

        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
          input,
          circuitWasm,
          zkeyFile
        );

        // Write proof
        const proofPath = path.join(attestDir, 'proof.json');
        fs.writeFileSync(proofPath, JSON.stringify({ proof, publicSignals }, null, 2));

        spin.succeed(`Proof generated for epoch ${targetEpoch}`);
        console.log(`  Input:  ${inputPath}`);
        console.log(`  Proof:  ${proofPath}`);
        console.log(`  Uptime: ${validCount}/${2016} intervals`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim ─────────────────────────────────────────────────────

  role
    .command('claim')
    .description('Submit ZK proof on-chain and claim weekly pay')
    .option('--epoch <n>', 'Epoch number (default: last completed)')
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const attestDir = path.join(ws.path, 'role-attestation');
        const proofPath = path.join(attestDir, 'proof.json');

        if (!fs.existsSync(proofPath)) {
          ui.error('No proof found. Run "lobstr role prove" first.');
          process.exit(1);
        }

        const { proof, publicSignals } = JSON.parse(fs.readFileSync(proofPath, 'utf-8'));

        // Determine epoch
        const currentEpochBig = await publicClient.readContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'currentEpoch',
        }) as bigint;

        const epoch = opts.epoch ? parseInt(opts.epoch, 10) : Number(currentEpochBig) - 1;

        // Format proof for Solidity
        const pA: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
        const pB: [[bigint, bigint], [bigint, bigint]] = [
          [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
          [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
        ];
        const pC: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
        const pubSigs: [bigint, bigint, bigint, bigint] = [
          BigInt(publicSignals[0]),
          BigInt(publicSignals[1]),
          BigInt(publicSignals[2]),
          BigInt(publicSignals[3]),
        ];

        const spin = ui.spinner(`Claiming pay for epoch ${epoch}...`);

        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'claimWeeklyPay',
          args: [BigInt(epoch), pA, pB, pC, pubSigs],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Weekly pay claimed');
        ui.info(`Tx: ${tx}`);

        // Show claim details
        const wallet = loadWallet(ws.path);
        const claim = await publicClient.readContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'getEpochClaim',
          args: [wallet.address as `0x${string}`, BigInt(epoch)],
        }) as any;

        console.log(`  Epoch:   ${epoch}`);
        console.log(`  Uptime:  ${claim.uptimeCount}/2016`);
        console.log(`  Payout:  ${formatLob(claim.payAmount)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── resign ────────────────────────────────────────────────────

  role
    .command('resign')
    .description('Resign from your role (stake returned after 7-day cooldown)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const spin = ui.spinner('Resigning...');

        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'resign',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Resigned successfully. Complete resignation after 7-day cooldown with "lobstr role complete-resign".');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── complete-resign ───────────────────────────────────────────

  role
    .command('complete-resign')
    .description('Complete resignation and unlock stake (after 7-day cooldown)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const spin = ui.spinner('Completing resignation...');

        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'completeResignation',
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Resignation complete. Stake unlocked.');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── slots ─────────────────────────────────────────────────────

  role
    .command('slots')
    .description('Show available slots per role rank')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const spin = ui.spinner('Fetching slot info...');

        const results: { type: string; rank: string; filled: number; max: number; weeklyPay: string }[] = [];

        for (let t = 0; t <= 1; t++) {
          for (let r = 0; r <= 2; r++) {
            const [config, filled] = await Promise.all([
              publicClient.readContract({
                address: payrollAddr,
                abi: rolePayrollAbi,
                functionName: 'getRoleConfig',
                args: [t, r],
              }) as Promise<any>,
              publicClient.readContract({
                address: payrollAddr,
                abi: rolePayrollAbi,
                functionName: 'getFilledSlots',
                args: [t, r],
              }) as Promise<number>,
            ]);

            if (Number(config.maxSlots) > 0) {
              results.push({
                type: ROLE_TYPE[t],
                rank: ROLE_RANK[r],
                filled: Number(filled),
                max: Number(config.maxSlots),
                weeklyPay: formatLob(config.weeklyBaseLob),
              });
            }
          }
        }

        spin.succeed('Role Slots');
        for (const r of results) {
          const available = r.max - r.filled;
          console.log(`  ${r.type} ${r.rank}: ${r.filled}/${r.max} filled (${available} available) — ${r.weeklyPay}/week`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── heartbeat ─────────────────────────────────────────────────

  role
    .command('heartbeat')
    .description('Report heartbeat on-chain (cron does this automatically)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const wallet = loadWallet(ws.path);
        const payrollAddr = getContractAddress(ws.config, 'rolePayroll');

        const spin = ui.spinner('Reporting heartbeat...');

        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: rolePayrollAbi,
          functionName: 'reportHeartbeat',
          args: [wallet.address as `0x${string}`],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed('Heartbeat reported on-chain');
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── setup ─────────────────────────────────────────────────────

  role
    .command('setup')
    .description('Trusted setup for uptime circuit (download ptau, generate zkey)')
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const circuitsDir = path.join(ws.path, 'circuits');
        if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });

        console.log('Role uptime circuit setup');
        console.log('');
        console.log('This circuit is pre-compiled and bundled with the Docker image.');
        console.log('If you need to rebuild:');
        console.log('');
        console.log('  1. cd packages/circuits');
        console.log('  2. npx circom circuits/roleUptime.circom --r1cs --wasm --output build/');
        console.log('  3. npx snarkjs groth16 setup build/roleUptime.r1cs ptau/powersOfTau28_hez_final_17.ptau build/roleUptime_0000.zkey');
        console.log('  4. npx snarkjs zkey contribute build/roleUptime_0000.zkey build/roleUptime_final.zkey');
        console.log('  5. npx snarkjs zkey export solidityverifier build/roleUptime_final.zkey');
        console.log('  6. npx snarkjs zkey export verificationkey build/roleUptime_final.zkey build/verification_key.json');
        console.log('');
        console.log('Circuit files needed in workspace:');
        console.log('  - roleUptime.wasm');
        console.log('  - roleUptime_final.zkey');
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}

// ── Helpers ───────────────────────────────────────────────────────

function _parseRoleType(type: string): number {
  const t = type.toLowerCase();
  if (t === 'arbitrator' || t === 'arb') return 0;
  if (t === 'moderator' || t === 'mod') return 1;
  throw new Error(`Unknown role type: ${type}. Use 'arbitrator' or 'moderator'.`);
}

function _parseRoleRank(rank: string): number {
  const r = rank.toLowerCase();
  if (r === 'junior') return 0;
  if (r === 'senior') return 1;
  if (r === 'principal' || r === 'lead') return 2;
  throw new Error(`Unknown rank: ${rank}. Use 'junior', 'senior', or 'principal'.`);
}

function _findCircuitFile(filename: string): string {
  // Check common locations
  const candidates = [
    path.join(process.cwd(), 'circuits', filename),
    path.join(process.cwd(), filename),
    path.join('/opt/lobstr/circuits', filename),
    path.join(__dirname, '../../circuits', filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Circuit file not found: ${filename}. Run "lobstr role setup" for instructions.`);
}
