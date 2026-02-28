import { Command } from "commander";
import { keccak256, toBytes, parseAbi, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  SYBIL_GUARD_ABI,
} from "openclaw";
import * as ui from "openclaw";

// Minimal ABI for AccessControl + Pausable
const ACCESS_CONTROL_ABI = parseAbi([
  "function grantRole(bytes32 role, address account)",
  "function revokeRole(bytes32 role, address account)",
  "function renounceRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
]);

// Map of contract name -> config key for getContractAddress
const CONTRACT_MAP: Record<string, string> = {
  SybilGuard: "sybilGuard",
  StakingManager: "stakingManager",
  TreasuryGovernor: "treasuryGovernor",
  ServiceRegistry: "serviceRegistry",
  DisputeArbitration: "disputeArbitration",
  EscrowEngine: "escrowEngine",
  ReputationSystem: "reputationSystem",
  InsurancePool: "insurancePool",
  LoanEngine: "loanEngine",
  X402CreditFacility: "x402CreditFacility",
  LightningGovernor: "lightningGovernor",
  StakingRewards: "stakingRewards",
  LiquidityMining: "liquidityMining",
  RewardDistributor: "rewardDistributor",
  RewardScheduler: "rewardScheduler",
  AirdropClaimV3: "airdropClaimV3",
  TeamVesting: "teamVesting",
  X402EscrowBridge: "x402EscrowBridge",
  SubscriptionEngine: "subscriptionEngine",
  MultiPartyEscrow: "multiPartyEscrow",
  BondingEngine: "bondingEngine",
  DirectiveBoard: "directiveBoard",
  ReviewRegistry: "reviewRegistry",
  RolePayroll: "rolePayroll",
  UptimeVerifier: "uptimeVerifier",
};

function resolveRoleHash(role: string): `0x${string}` {
  // If it already looks like a bytes32 hash, use it directly
  if (role.startsWith("0x") && role.length === 66) {
    return role as `0x${string}`;
  }
  // DEFAULT_ADMIN_ROLE is 0x0
  if (role === "DEFAULT_ADMIN_ROLE") {
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  // Otherwise hash the role name
  return keccak256(toBytes(role));
}

export function registerAdminCommands(program: Command): void {
  const admin = program
    .command("admin")
    .description("Contract admin — role management and access control");

  // ── grant-role ────────────────────────────────────

  admin
    .command("grant-role")
    .description("Grant a role on a contract (requires DEFAULT_ADMIN_ROLE)")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .requiredOption("--role <role>", "Role name (e.g. WATCHER_ROLE, JUDGE_ROLE, GUARDIAN_ROLE)")
    .requiredOption("--account <address>", "Address to grant the role to")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);
        const roleHash = resolveRoleHash(opts.role);
        const account = opts.account as Address;

        // Check if already granted
        const already = await publicClient.readContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "hasRole",
          args: [roleHash, account],
        });

        if (already) {
          ui.info(`${opts.role} already granted to ${account} on ${opts.contract}`);
          return;
        }

        const spin = ui.spinner(`Granting ${opts.role} to ${account.slice(0, 10)}...`);
        const tx = await walletClient.writeContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "grantRole",
          args: [roleHash, account],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`${opts.role} granted`);
        ui.info(`Contract: ${opts.contract} (${contractAddr})`);
        ui.info(`Account: ${account}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── revoke-role ───────────────────────────────────

  admin
    .command("revoke-role")
    .description("Revoke a role on a contract (requires DEFAULT_ADMIN_ROLE)")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .requiredOption("--role <role>", "Role name")
    .requiredOption("--account <address>", "Address to revoke the role from")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);
        const roleHash = resolveRoleHash(opts.role);
        const account = opts.account as Address;

        const spin = ui.spinner(`Revoking ${opts.role} from ${account.slice(0, 10)}...`);
        const tx = await walletClient.writeContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "revokeRole",
          args: [roleHash, account],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`${opts.role} revoked`);
        ui.info(`Contract: ${opts.contract} (${contractAddr})`);
        ui.info(`Account: ${account}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── renounce-role ────────────────────────────────

  admin
    .command("renounce-role")
    .description("Renounce your own role on a contract (irreversible)")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .requiredOption("--role <role>", "Role name to renounce")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient, address: callerAddr } = await createWalletClient(ws.config, ws.path);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);
        const roleHash = resolveRoleHash(opts.role);

        // Verify caller has the role
        const has = await publicClient.readContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "hasRole",
          args: [roleHash, callerAddr],
        });

        if (!has) {
          ui.info(`You don't have ${opts.role} on ${opts.contract} — nothing to renounce`);
          return;
        }

        const spin = ui.spinner(`Renouncing ${opts.role} on ${opts.contract}...`);
        const tx = await walletClient.writeContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "renounceRole",
          args: [roleHash, callerAddr],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`${opts.role} renounced on ${opts.contract}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── check-role ────────────────────────────────────

  admin
    .command("check-role")
    .description("Check if an address has a role on a contract")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .requiredOption("--role <role>", "Role name")
    .requiredOption("--account <address>", "Address to check")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);
        const roleHash = resolveRoleHash(opts.role);
        const account = opts.account as Address;

        const has = await publicClient.readContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "hasRole",
          args: [roleHash, account],
        });

        if (has) {
          ui.info(`✓ ${account} HAS ${opts.role} on ${opts.contract}`);
        } else {
          ui.info(`✗ ${account} does NOT have ${opts.role} on ${opts.contract}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── pause ─────────────────────────────────────────

  admin
    .command("pause")
    .description("Emergency pause a contract (requires DEFAULT_ADMIN_ROLE)")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);

        const already = await publicClient.readContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "paused",
        });

        if (already) {
          ui.info(`${opts.contract} is already paused`);
          return;
        }

        const spin = ui.spinner(`Pausing ${opts.contract}...`);
        const tx = await walletClient.writeContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "pause",
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`${opts.contract} PAUSED`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── unpause ───────────────────────────────────────

  admin
    .command("unpause")
    .description("Unpause a contract (requires DEFAULT_ADMIN_ROLE)")
    .requiredOption("--contract <name>", `Contract name: ${Object.keys(CONTRACT_MAP).join(", ")}`)
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);

        const configKey = CONTRACT_MAP[opts.contract];
        if (!configKey) {
          ui.error(`Unknown contract: ${opts.contract}. Options: ${Object.keys(CONTRACT_MAP).join(", ")}`);
          process.exit(1);
        }

        const contractAddr = getContractAddress(ws.config, configKey as any);

        const spin = ui.spinner(`Unpausing ${opts.contract}...`);
        const tx = await walletClient.writeContract({
          address: contractAddr,
          abi: ACCESS_CONTROL_ABI,
          functionName: "unpause",
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`${opts.contract} UNPAUSED`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ────────────────────────────────────────

  admin
    .command("status")
    .description("Check pause status of all contracts")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);

        const spin = ui.spinner("Checking contract status...");
        const results: string[][] = [];

        for (const [name, configKey] of Object.entries(CONTRACT_MAP)) {
          try {
            const addr = getContractAddress(ws.config, configKey as any);
            const paused = await publicClient.readContract({
              address: addr,
              abi: ACCESS_CONTROL_ABI,
              functionName: "paused",
            });
            results.push([name, addr, paused ? "PAUSED" : "Active"]);
          } catch {
            results.push([name, "—", "N/A (no Pausable)"]);
          }
        }

        spin.succeed("Contract status");
        ui.table(["Contract", "Address", "Status"], results);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
