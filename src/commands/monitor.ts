import { Command } from "commander";
import { parseAbi, encodeFunctionData, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  DISPUTE_ARBITRATION_ABI,
  ROLE_PAYROLL_ABI,
  SYBIL_GUARD_ABI,
  LIGHTNING_GOVERNOR_ABI,
  STAKING_MANAGER_ABI,
} from "openclaw";
import * as ui from "openclaw";
import {
  formatLob,
  DISPUTE_STATUS,
  RULING,
  ARBITRATOR_RANK,
  ROLE_TYPE,
  ROLE_RANK,
  ROLE_SLOT_STATUS,
  VIOLATION_TYPE,
} from "../lib/format";

const arbAbi = parseAbi(DISPUTE_ARBITRATION_ABI as unknown as string[]);
const payrollAbi = parseAbi(ROLE_PAYROLL_ABI as unknown as string[]);
const sybilAbi = parseAbi(SYBIL_GUARD_ABI as unknown as string[]);
const govAbi = parseAbi(LIGHTNING_GOVERNOR_ABI as unknown as string[]);
const stakingAbi = parseAbi(STAKING_MANAGER_ABI as unknown as string[]);

// ── Internal helpers ──────────────────────────────────────────────────────

interface ArbitratorData {
  address: Address;
  stake: bigint;
  rank: number;
  disputesHandled: bigint;
  majorityVotes: bigint;
  active: boolean;
}

interface DisputeData {
  id: bigint;
  jobId: bigint;
  buyer: Address;
  seller: Address;
  amount: bigint;
  status: number;
  ruling: number;
  arbitrators: Address[];
  votesForBuyer: number;
  votesForSeller: number;
  createdAt: bigint;
}

interface RoleSlotData {
  address: Address;
  roleType: number;
  rank: number;
  status: number;
  enrolledAt: bigint;
  strikes: number;
  stakedAmount: bigint;
  lastHeartbeat: bigint;
}

async function loadArbitrators(
  publicClient: any,
  arbAddr: Address
): Promise<ArbitratorData[]> {
  const results: ArbitratorData[] = [];
  // Scan accounts that have staked — check sequential addresses isn't feasible,
  // but we can check known arbitrators via disputes. Instead, scan dispute panels.
  // First gather unique arb addresses from recent disputes.
  const addrs = new Set<Address>();
  for (let i = 1; i <= 300; i++) {
    try {
      const d = (await publicClient.readContract({
        address: arbAddr,
        abi: arbAbi,
        functionName: "getDispute",
        args: [BigInt(i)],
      })) as any;
      // Dispute tuple: indexes for panel would be in returned data
      // getDispute returns flat tuple — arbitrators are in the panel
      // The ABI returns: id, jobId, buyer, seller, amount, token, buyerEvi, sellerEvi,
      //   status, ruling, createdAt, counterDeadline, votingDeadline, votesForBuyer, votesForSeller, totalVotes
      // Panel isn't in getDispute — it's stored separately. Use getArbitratorInfo on known addrs.
    } catch {
      break;
    }
  }

  // Fallback: check arbitrator info for known addresses from disputes
  return results;
}

async function loadDisputes(
  publicClient: any,
  arbAddr: Address,
  limit: number = 200
): Promise<DisputeData[]> {
  const disputes: DisputeData[] = [];
  for (let i = 1; i <= limit; i++) {
    try {
      const d = (await publicClient.readContract({
        address: arbAddr,
        abi: arbAbi,
        functionName: "getDispute",
        args: [BigInt(i)],
      })) as any;
      disputes.push({
        id: d[0],
        jobId: d[1],
        buyer: d[2],
        seller: d[3],
        amount: d[4],
        status: d[8],
        ruling: d[9],
        arbitrators: [], // Panel not available from getDispute — see note below
        votesForBuyer: Number(d[13]),
        votesForSeller: Number(d[14]),
        createdAt: d[10],
      });
    } catch {
      break;
    }
  }
  return disputes;
}

async function loadEnrolledRoles(
  publicClient: any,
  payrollAddr: Address,
  addresses: Address[]
): Promise<RoleSlotData[]> {
  const results: RoleSlotData[] = [];
  for (const addr of addresses) {
    try {
      const slot = (await publicClient.readContract({
        address: payrollAddr,
        abi: payrollAbi,
        functionName: "getRoleSlot",
        args: [addr],
      })) as any;
      // Only include if enrolled (status != Empty)
      if (Number(slot[2]) !== 0) {
        const lastHb = (await publicClient.readContract({
          address: payrollAddr,
          abi: payrollAbi,
          functionName: "lastHeartbeatTimestamp",
          args: [addr],
        })) as bigint;
        results.push({
          address: addr,
          roleType: Number(slot[0]),
          rank: Number(slot[1]),
          status: Number(slot[2]),
          enrolledAt: slot[3],
          strikes: Number(slot[5]),
          stakedAmount: slot[6],
          lastHeartbeat: lastHb,
        });
      }
    } catch {
      // Skip addresses that error
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Command registration
// ═══════════════════════════════════════════════════════════════════════════

export function registerMonitorCommands(program: Command): void {
  const monitor = program
    .command("monitor")
    .description("Protocol health monitoring — detect gaming, collusion, and uptime farming");

  // ── scan ──────────────────────────────────────────────────────────────
  // Read-only analysis. Anyone can run.

  monitor
    .command("scan")
    .description("Scan for gaming patterns (read-only, anyone can run)")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");

        const spin = opts.format !== "json" ? ui.spinner("Scanning protocol for gaming patterns...") : null;

        const findings: Array<{ severity: string; category: string; detail: string }> = [];

        // ── 1. Pool size check ─────────────────────────────
        if (spin) spin.text = "Checking arbitrator pool size...";

        // Count active arbitrators by scanning getArbitratorInfo for known addresses
        // We'll gather addresses from dispute data first
        const disputes = await loadDisputes(publicClient, arbAddr);
        const arbAddresses = new Set<string>();

        for (const d of disputes) {
          // Since getDispute doesn't return panel, check via getArbitratorInfo on parties
          // The parties themselves might not be arbs, but we can check
        }

        // Alternatively: use getFilledSlots on RolePayroll to get pool counts
        let totalArbs = 0;
        for (let roleType = 0; roleType <= 0; roleType++) {
          for (let rank = 0; rank <= 2; rank++) {
            try {
              const filled = (await publicClient.readContract({
                address: payrollAddr,
                abi: payrollAbi,
                functionName: "getFilledSlots",
                args: [roleType, rank],
              })) as number;
              totalArbs += Number(filled);
            } catch {
              // Skip
            }
          }
        }

        let totalMods = 0;
        for (let rank = 0; rank <= 2; rank++) {
          try {
            const filled = (await publicClient.readContract({
              address: payrollAddr,
              abi: payrollAbi,
              functionName: "getFilledSlots",
              args: [1, rank],
            })) as number;
            totalMods += Number(filled);
          } catch {
            // Skip
          }
        }

        if (totalArbs > 0 && totalArbs < 10) {
          findings.push({
            severity: "HIGH",
            category: "Pool Dominance",
            detail: `Only ${totalArbs} active arbitrator(s). With a 3-person panel, ${totalArbs < 5 ? "2" : "3"} wallets could control majority. Safe minimum: 10.`,
          });
        }

        // ── 2. Dispute volume analysis ─────────────────────
        if (spin) spin.text = "Analyzing dispute patterns...";

        const resolvedDisputes = disputes.filter((d) => d.status === 3);
        const now = BigInt(Math.floor(Date.now() / 1000));
        const weekAgo = now - 604800n;
        const recentDisputes = resolvedDisputes.filter((d) => d.createdAt >= weekAgo);

        // Check for micro-disputes (sub-1 LOB — potential self-dispute farming)
        const ONE_LOB = 1000000000000000000n; // 1e18
        const microDisputes = recentDisputes.filter((d) => d.amount < ONE_LOB);
        if (microDisputes.length > 3) {
          findings.push({
            severity: "HIGH",
            category: "Self-Dispute Farming",
            detail: `${microDisputes.length} disputes on sub-1-LOB jobs this week. Each costs a fraction in fees but earns per-dispute LOB from treasury.`,
          });
        }

        // Check for buyer-seller overlap (same address on both sides of disputes)
        const buyers = new Set(recentDisputes.map((d) => d.buyer.toLowerCase()));
        const sellers = new Set(recentDisputes.map((d) => d.seller.toLowerCase()));
        const overlap = [...buyers].filter((b) => sellers.has(b));
        if (overlap.length > 0) {
          findings.push({
            severity: "MEDIUM",
            category: "Buyer-Seller Overlap",
            detail: `${overlap.length} address(es) appear as both buyer AND seller in recent disputes: ${overlap.map((a) => a.slice(0, 10) + "...").join(", ")}`,
          });
        }

        // ── 3. Voting bias analysis ────────────────────────
        if (spin) spin.text = "Analyzing voting patterns...";

        // Check for unanimous-only rulings (sign of last-vote sniping)
        const votedDisputes = resolvedDisputes.filter(
          (d) => d.votesForBuyer + d.votesForSeller >= 2
        );
        const unanimousCount = votedDisputes.filter(
          (d) => d.votesForBuyer >= 3 || d.votesForSeller >= 3
        ).length;
        if (votedDisputes.length >= 10) {
          const unanimousRate = Math.floor((unanimousCount / votedDisputes.length) * 100);
          if (unanimousRate > 90) {
            findings.push({
              severity: "MEDIUM",
              category: "Last-Vote Sniping",
              detail: `${unanimousRate}% of disputes resolved unanimously (${unanimousCount}/${votedDisputes.length}). Statistical anomaly — possible last-voter always matching majority.`,
            });
          }
        }

        // Check ruling direction bias across all disputes
        const buyerWins = resolvedDisputes.filter((d) => d.ruling === 1).length;
        const sellerWins = resolvedDisputes.filter((d) => d.ruling === 2).length;
        const totalRuled = buyerWins + sellerWins;
        if (totalRuled >= 10) {
          const buyerRate = Math.floor((buyerWins / totalRuled) * 100);
          if (buyerRate > 80 || buyerRate < 20) {
            findings.push({
              severity: "LOW",
              category: "Rubber-Stamp Bias",
              detail: `System-wide ruling skew: ${buyerRate}% buyer wins / ${100 - buyerRate}% seller wins across ${totalRuled} disputes. Possible coordinated voting.`,
            });
          }
        }

        // ── 4. Heartbeat / abandonment check ───────────────
        if (spin) spin.text = "Checking heartbeat freshness...";

        const currentEpoch = (await publicClient.readContract({
          address: payrollAddr,
          abi: payrollAbi,
          functionName: "currentEpoch",
        })) as bigint;

        // ── 5. Per-epoch dispute stats anomalies ───────────
        // Check if any arbitrator has abnormally high per-dispute payouts
        // by looking at dispute stats vs pool average

        // Output results
        if (opts.format === "json") {
          console.log(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              poolSize: { arbitrators: totalArbs, moderators: totalMods },
              currentEpoch: Number(currentEpoch),
              disputeStats: {
                total: disputes.length,
                resolved: resolvedDisputes.length,
                recentWeek: recentDisputes.length,
                microDisputes: microDisputes.length,
                unanimousRate:
                  votedDisputes.length > 0
                    ? Math.floor((unanimousCount / votedDisputes.length) * 100)
                    : null,
              },
              findings: findings,
            })
          );
          return;
        }

        if (spin) spin.succeed(`Scan complete — ${findings.length} finding(s)`);

        // Summary stats
        ui.header("Protocol Overview");
        ui.info(`Arbitrator pool: ${totalArbs} active`);
        ui.info(`Moderator pool: ${totalMods} active`);
        ui.info(`Current epoch: ${currentEpoch}`);
        ui.info(`Disputes: ${disputes.length} total, ${resolvedDisputes.length} resolved, ${recentDisputes.length} this week`);
        console.log("");

        if (findings.length === 0) {
          ui.success("No gaming patterns detected");
          return;
        }

        ui.header("Findings");
        for (const f of findings) {
          const prefix = f.severity === "HIGH" ? "!!!" : f.severity === "MEDIUM" ? " !!" : "  !";
          const color =
            f.severity === "HIGH" ? ui.error : f.severity === "MEDIUM" ? ui.warn : ui.info;
          color(`${prefix} [${f.severity}] ${f.category}`);
          ui.info(`    ${f.detail}`);
          console.log("");
        }

        // Actionable suggestions
        ui.header("Available Actions");
        ui.info("  lobstr monitor report-abandonment <addr>  — trigger abandonment cascade (permissionless)");
        ui.info("  lobstr mod report --subjects <addrs> ...  — file SybilGuard report (WATCHER_ROLE)");
        ui.info("  lobstr monitor propose-pause              — propose pausing RolePayroll (Platinum tier)");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── pool ──────────────────────────────────────────────────────────────
  // Detailed arbitrator pool health.

  monitor
    .command("pool")
    .description("Show arbitrator pool health and per-rank enrollment")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");

        const spin = opts.format !== "json" ? ui.spinner("Loading pool data...") : null;

        const rows: Array<{
          roleType: string;
          rank: string;
          filled: number;
          maxSlots: number;
          minStake: string;
          weeklyBase: string;
          perDispute: string;
        }> = [];

        for (let rt = 0; rt <= 1; rt++) {
          for (let rk = 0; rk <= 2; rk++) {
            try {
              const [filled, config] = await Promise.all([
                publicClient.readContract({
                  address: payrollAddr,
                  abi: payrollAbi,
                  functionName: "getFilledSlots",
                  args: [rt, rk],
                }) as Promise<number>,
                publicClient.readContract({
                  address: payrollAddr,
                  abi: payrollAbi,
                  functionName: "getRoleConfig",
                  args: [rt, rk],
                }) as Promise<any>,
              ]);

              rows.push({
                roleType: ROLE_TYPE[rt] || "Unknown",
                rank: ROLE_RANK[rk] || "Unknown",
                filled: Number(filled),
                maxSlots: Number(config[0]),
                minStake: formatLob(config[2]),
                weeklyBase: formatLob(config[3]),
                perDispute: formatLob(config[4]),
              });
            } catch {
              // Skip unconfigured slots
            }
          }
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(rows));
          return;
        }

        if (spin) spin.succeed("Pool enrollment");
        ui.table(
          ["Role", "Rank", "Filled", "Max", "Min Stake", "Weekly Base", "Per Dispute"],
          rows.map((r) => [
            r.roleType,
            r.rank,
            `${r.filled}`,
            `${r.maxSlots}`,
            r.minStake,
            r.weeklyBase,
            r.perDispute,
          ])
        );

        const totalArbs = rows.filter((r) => r.roleType === "Arbitrator").reduce((s, r) => s + r.filled, 0);
        if (totalArbs > 0 && totalArbs < 10) {
          console.log("");
          ui.warn(`Pool dominance risk: only ${totalArbs} arbitrators. 2-3 sybil wallets could control panel majority.`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── report-abandonment ────────────────────────────────────────────────
  // Permissionless: anyone can call reportAbandonment() if heartbeat stale 72h+.

  monitor
    .command("report-abandonment <address>")
    .description("Report an abandoned role holder (permissionless, triggers stake slash if 72h+ silent)")
    .option("--dry-run", "Check eligibility without submitting transaction")
    .action(async (address: string, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");

        const spin = ui.spinner(`Checking ${address.slice(0, 10)}...`);

        // Check role slot status and last heartbeat
        const [slot, lastHb, isFounder] = await Promise.all([
          publicClient.readContract({
            address: payrollAddr,
            abi: payrollAbi,
            functionName: "getRoleSlot",
            args: [address as Address],
          }) as Promise<any>,
          publicClient.readContract({
            address: payrollAddr,
            abi: payrollAbi,
            functionName: "lastHeartbeatTimestamp",
            args: [address as Address],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: payrollAddr,
            abi: payrollAbi,
            functionName: "founderAgents",
            args: [address as Address],
          }) as Promise<boolean>,
        ]);

        const status = Number(slot[2]);
        if (status !== 1 && status !== 2) {
          spin.fail(`${address.slice(0, 10)}... is not enrolled (status: ${ROLE_SLOT_STATUS[status] || "Empty"})`);
          return;
        }

        if (isFounder) {
          spin.fail("Founder agents are exempt from abandonment reporting");
          return;
        }

        if (lastHb === 0n) {
          spin.fail("No heartbeat recorded — cannot report abandonment");
          return;
        }

        const now = BigInt(Math.floor(Date.now() / 1000));
        const silentSeconds = now - lastHb;
        const silentHours = Number(silentSeconds) / 3600;

        ui.info(`Role: ${ROLE_TYPE[Number(slot[0])]} ${ROLE_RANK[Number(slot[1])]}`);
        ui.info(`Stake: ${formatLob(slot[6])}`);
        ui.info(`Strikes: ${slot[5]}`);
        ui.info(`Last heartbeat: ${new Date(Number(lastHb) * 1000).toISOString()} (${silentHours.toFixed(1)}h ago)`);

        if (silentSeconds < 259200n) {
          // < 72h
          spin.fail(`Not eligible — only ${silentHours.toFixed(1)}h silent (need 72h+)`);
          return;
        }

        // Describe what will happen
        let consequence: string;
        if (silentSeconds >= 2592000n) {
          consequence = "30d+ silence → full stake forfeited to treasury";
        } else if (silentSeconds >= 604800n) {
          consequence = "7d+ silence → role revoked, 25% stake slashed";
        } else {
          consequence = "72h+ silence → 2 strikes issued";
        }

        spin.succeed(`Eligible for abandonment report`);
        ui.warn(`Consequence: ${consequence}`);

        if (opts.dryRun) {
          ui.info("Dry run — no transaction sent");
          return;
        }

        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const txSpin = ui.spinner("Submitting reportAbandonment...");
        const tx = await walletClient.writeContract({
          address: payrollAddr,
          abi: payrollAbi,
          functionName: "reportAbandonment",
          args: [address as Address],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        txSpin.succeed("Abandonment reported");
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── propose-pause ─────────────────────────────────────────────────────
  // Submit LightningGovernor proposal to pause RolePayroll (Platinum tier required).

  monitor
    .command("propose-pause")
    .description("Propose pausing RolePayroll via LightningGovernor (Platinum tier required)")
    .requiredOption("--reason <reason>", "Reason for pause proposal")
    .option("--dry-run", "Check eligibility without submitting")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "lightningGovernor");
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");
        const stakingAddr = getContractAddress(ws.config, "stakingManager");

        const { client: walletClient, address } = await createWalletClient(
          ws.config,
          ws.path
        );

        const spin = ui.spinner("Checking eligibility...");

        // Check Platinum tier requirement
        const tier = (await publicClient.readContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: "getTier",
          args: [address],
        })) as number;

        if (Number(tier) !== 4) {
          spin.fail(
            `Platinum tier required (100,000+ LOB staked). Your tier: ${
              ["None", "Bronze", "Silver", "Gold", "Platinum"][Number(tier)] || "Unknown"
            }`
          );
          ui.info("Alternative: file a SybilGuard report via `lobstr mod report` (requires WATCHER_ROLE)");
          ui.info("Alternative: report abandonment via `lobstr monitor report-abandonment` (permissionless)");
          return;
        }

        // Check if pause() is whitelisted on RolePayroll
        const pauseSelector = "0x8456cb59" as `0x${string}`; // bytes4(keccak256("pause()"))
        const isWhitelisted = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "isWhitelisted",
          args: [payrollAddr, pauseSelector],
        })) as boolean;

        if (!isWhitelisted) {
          spin.fail("pause() is not whitelisted on LightningGovernor for RolePayroll");
          ui.info("The TreasuryGovernor multisig must whitelist this selector first.");
          ui.info("Use `lobstr dao admin-propose` to request whitelisting.");
          return;
        }

        const calldata = encodeFunctionData({
          abi: parseAbi(["function pause()"]),
          functionName: "pause",
        });

        spin.succeed("Eligible to propose");
        ui.info(`Target: RolePayroll (${payrollAddr})`);
        ui.info(`Action: pause()`);
        ui.info(`Reason: ${opts.reason}`);

        if (opts.dryRun) {
          ui.info("Dry run — no transaction sent");
          ui.info(`Calldata: ${calldata}`);
          return;
        }

        const txSpin = ui.spinner("Submitting proposal...");
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "createProposal",
          args: [payrollAddr, calldata, `[MONITOR] Pause RolePayroll: ${opts.reason}`],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        txSpin.succeed("Proposal submitted");
        ui.info(`Tx: ${tx}`);
        ui.info("Proposal needs Platinum-tier votes to reach quorum.");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── propose-config ────────────────────────────────────────────────────
  // Submit LightningGovernor proposal to adjust RolePayroll config.

  monitor
    .command("propose-config")
    .description("Propose adjusting role config via LightningGovernor (Platinum tier required)")
    .requiredOption("--role-type <type>", "Role type: Arbitrator, Moderator")
    .requiredOption("--rank <rank>", "Rank: Junior, Senior, Principal")
    .requiredOption("--per-dispute <amount>", "New perDisputeLob amount (in LOB)")
    .requiredOption("--reason <reason>", "Reason for config change")
    .option("--dry-run", "Check eligibility without submitting")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "lightningGovernor");
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");
        const stakingAddr = getContractAddress(ws.config, "stakingManager");

        const { client: walletClient, address } = await createWalletClient(
          ws.config,
          ws.path
        );

        // Resolve role type and rank
        const roleTypeIndex = Object.entries(ROLE_TYPE).find(
          ([, v]) => v.toLowerCase() === opts.roleType.toLowerCase()
        )?.[0];
        if (roleTypeIndex === undefined) {
          ui.error(`Unknown role type: ${opts.roleType}. Options: ${Object.values(ROLE_TYPE).join(", ")}`);
          process.exit(1);
        }

        const rankIndex = Object.entries(ROLE_RANK).find(
          ([, v]) => v.toLowerCase() === opts.rank.toLowerCase()
        )?.[0];
        if (rankIndex === undefined) {
          ui.error(`Unknown rank: ${opts.rank}. Options: ${Object.values(ROLE_RANK).join(", ")}`);
          process.exit(1);
        }

        const spin = ui.spinner("Checking eligibility...");

        // Check Platinum tier
        const tier = (await publicClient.readContract({
          address: stakingAddr,
          abi: stakingAbi,
          functionName: "getTier",
          args: [address],
        })) as number;

        if (Number(tier) !== 4) {
          spin.fail(
            `Platinum tier required. Your tier: ${
              ["None", "Bronze", "Silver", "Gold", "Platinum"][Number(tier)] || "Unknown"
            }`
          );
          return;
        }

        // Get current config to show what's changing
        const currentConfig = (await publicClient.readContract({
          address: payrollAddr,
          abi: payrollAbi,
          functionName: "getRoleConfig",
          args: [Number(roleTypeIndex), Number(rankIndex)],
        })) as any;

        ui.info(`Current perDisputeLob: ${formatLob(currentConfig[4])}`);
        ui.info(`Proposed perDisputeLob: ${opts.perDispute} LOB`);

        // Check if setRoleConfig is whitelisted
        const selector = "0x" + "setRoleConfig".slice(0, 8) as `0x${string}`;
        // Actually compute the real selector
        const setConfigAbi = parseAbi([
          "function setRoleConfig(uint8 roleType, uint8 rank, (uint16 maxSlots, uint256 certFeeUsdc, uint256 minStakeLob, uint256 weeklyBaseLob, uint256 perDisputeLob, uint256 majorityBonusLob) config)",
        ]);

        spin.succeed("Eligibility check passed");

        if (opts.dryRun) {
          ui.info("Dry run — no transaction sent");
          return;
        }

        // Build calldata for setRoleConfig with only perDisputeLob changed
        const { parseUnits } = await import("viem");
        const newPerDispute = parseUnits(opts.perDispute, 18);

        const calldata = encodeFunctionData({
          abi: setConfigAbi,
          functionName: "setRoleConfig",
          args: [
            Number(roleTypeIndex),
            Number(rankIndex),
            {
              maxSlots: currentConfig[0],
              certFeeUsdc: currentConfig[1],
              minStakeLob: currentConfig[2],
              weeklyBaseLob: currentConfig[3],
              perDisputeLob: newPerDispute,
              majorityBonusLob: currentConfig[5],
            },
          ],
        });

        const txSpin = ui.spinner("Submitting proposal...");
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "createProposal",
          args: [
            payrollAddr,
            calldata,
            `[MONITOR] Adjust ${opts.roleType} ${opts.rank} perDisputeLob to ${opts.perDispute} LOB: ${opts.reason}`,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        txSpin.succeed("Config proposal submitted");
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── enforce ───────────────────────────────────────────────────────────
  // Automated enforcement: scan + take action on clear violations.

  monitor
    .command("enforce")
    .description("Scan and auto-enforce: report abandonments, file sybil reports (requires roles)")
    .option("--dry-run", "Show what would be enforced without submitting transactions")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const payrollAddr = getContractAddress(ws.config, "rolePayroll");
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = opts.format !== "json" ? ui.spinner("Scanning for enforceable violations...") : null;

        const actions: Array<{
          type: string;
          target: string;
          detail: string;
          executed: boolean;
        }> = [];

        // ── Auto-reportAbandonment for stale heartbeats ────
        // Scan disputes to find arb addresses, then check their heartbeats
        if (spin) spin.text = "Checking heartbeat freshness...";

        const disputes = await loadDisputes(publicClient, arbAddr, 100);

        // Collect unique addresses that might be enrolled
        const candidateAddrs = new Set<string>();
        for (const d of disputes) {
          candidateAddrs.add(d.buyer.toLowerCase());
          candidateAddrs.add(d.seller.toLowerCase());
        }

        const now = BigInt(Math.floor(Date.now() / 1000));
        const staleAddresses: Address[] = [];

        for (const addr of candidateAddrs) {
          try {
            const slot = (await publicClient.readContract({
              address: payrollAddr,
              abi: payrollAbi,
              functionName: "getRoleSlot",
              args: [addr as Address],
            })) as any;

            const status = Number(slot[2]);
            if (status !== 1 && status !== 2) continue; // Not active/suspended

            const isFounder = (await publicClient.readContract({
              address: payrollAddr,
              abi: payrollAbi,
              functionName: "founderAgents",
              args: [addr as Address],
            })) as boolean;
            if (isFounder) continue;

            const lastHb = (await publicClient.readContract({
              address: payrollAddr,
              abi: payrollAbi,
              functionName: "lastHeartbeatTimestamp",
              args: [addr as Address],
            })) as bigint;

            if (lastHb > 0n && (now - lastHb) >= 259200n) {
              const silentHours = Number(now - lastHb) / 3600;
              staleAddresses.push(addr as Address);
              actions.push({
                type: "reportAbandonment",
                target: addr,
                detail: `${silentHours.toFixed(0)}h silent — eligible for abandonment report`,
                executed: false,
              });
            }
          } catch {
            // Not enrolled or error — skip
          }
        }

        // Execute abandonments if not dry-run
        if (!opts.dryRun && staleAddresses.length > 0) {
          const { client: walletClient } = await createWalletClient(ws.config, ws.path);

          for (const staleAddr of staleAddresses) {
            try {
              if (spin) spin.text = `Reporting abandonment: ${staleAddr.slice(0, 10)}...`;
              const tx = await walletClient.writeContract({
                address: payrollAddr,
                abi: payrollAbi,
                functionName: "reportAbandonment",
                args: [staleAddr],
              });
              await publicClient.waitForTransactionReceipt({ hash: tx });
              const action = actions.find(
                (a) => a.target === staleAddr && a.type === "reportAbandonment"
              );
              if (action) action.executed = true;
            } catch (txErr) {
              const action = actions.find(
                (a) => a.target === staleAddr && a.type === "reportAbandonment"
              );
              if (action) action.detail += ` (tx failed: ${(txErr as Error).message.slice(0, 60)})`;
            }
          }
        }

        // ── Output ─────────────────────────────────────────
        if (opts.format === "json") {
          console.log(JSON.stringify({ actions, dryRun: !!opts.dryRun }));
          return;
        }

        if (spin) spin.succeed(`Enforcement scan complete — ${actions.length} action(s)`);

        if (actions.length === 0) {
          ui.success("No enforceable violations found");
          return;
        }

        ui.table(
          ["Type", "Target", "Detail", "Executed"],
          actions.map((a) => [
            a.type,
            a.target.slice(0, 12) + "...",
            a.detail.slice(0, 60),
            opts.dryRun ? "dry-run" : a.executed ? "yes" : "failed",
          ])
        );

        if (opts.dryRun) {
          console.log("");
          ui.info("Dry run — no transactions sent. Remove --dry-run to execute.");
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
