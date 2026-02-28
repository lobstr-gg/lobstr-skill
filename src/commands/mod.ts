import { Command } from "commander";
import { parseAbi, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  SYBIL_GUARD_ABI,
} from "openclaw";
import * as ui from "openclaw";
import { apiGet, apiPost, loadApiKey } from "../lib/api";
import { timeAgo } from "../lib/forum-format";
import {
  formatLob,
  VIOLATION_TYPE,
  REPORT_STATUS,
} from "../lib/format";

const sybilAbi = parseAbi(SYBIL_GUARD_ABI as unknown as string[]);

export function registerModCommands(program: Command): void {
  const mod = program
    .command("mod")
    .description("Forum moderation and on-chain anti-sybil enforcement");

  // ── log (existing — off-chain) ─────────────────────

  mod
    .command("log")
    .description("View the moderation log")
    .action(async () => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Loading mod log...");
        const { log } = await apiGet("/api/forum/mod/log", true);

        if (log.length === 0) {
          spin.succeed("No moderation entries");
          return;
        }

        spin.succeed(`${log.length} entries`);

        ui.table(
          ["ID", "Action", "Moderator", "Target", "Reason", "Time"],
          log.map((e: any) => [
            e.id,
            e.action,
            e.moderator.slice(0, 10) + "...",
            e.target.slice(0, 30),
            (e.reason || "").slice(0, 30),
            timeAgo(e.createdAt),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── action (existing — off-chain) ──────────────────

  mod
    .command("action <targetId> <action>")
    .description("Take a moderation action: remove, lock, pin, warn, ban")
    .option("--reason <reason>", "Reason for the action")
    .action(async (targetId, action, opts) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner(`Executing ${action}...`);
        const { entry } = await apiPost("/api/forum/mod/action", {
          targetId,
          action,
          reason: opts.reason || "",
        });

        spin.succeed(`${action} applied`);
        ui.info(`Log entry: ${entry.id}`);
        ui.info(`Target: ${entry.target}`);
        if (entry.reason) ui.info(`Reason: ${entry.reason}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ═══════════════════════════════════════════════════
  // On-chain SybilGuard commands
  // ═══════════════════════════════════════════════════

  // ── report ─────────────────────────────────────────

  mod
    .command("report")
    .description("Submit a sybil/abuse report (requires WATCHER_ROLE)")
    .requiredOption("--subjects <addresses>", "Comma-separated addresses to report")
    .requiredOption(
      "--type <violation>",
      `Violation type: ${Object.values(VIOLATION_TYPE).join(", ")}`
    )
    .requiredOption("--evidence <uri>", "IPFS URI to evidence bundle")
    .option("--notes <text>", "Additional context", "")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const subjects = opts.subjects.split(",").map((s: string) => s.trim()) as Address[];
        const violationIndex = Object.values(VIOLATION_TYPE).indexOf(opts.type);
        if (violationIndex === -1) {
          ui.error(
            `Unknown violation type: ${opts.type}. Options: ${Object.values(VIOLATION_TYPE).join(", ")}`
          );
          process.exit(1);
        }

        const spin = ui.spinner("Submitting report...");
        const tx = await walletClient.writeContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "submitReport",
          args: [subjects, violationIndex, opts.evidence, opts.notes],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed("Report submitted");
        ui.info(`Subjects: ${subjects.join(", ")}`);
        ui.info(`Type: ${opts.type}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── reports ────────────────────────────────────────

  mod
    .command("reports")
    .description("View pending sybil reports")
    .option("--status <status>", "Filter by status: pending, confirmed, rejected, expired")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = opts.format !== "json" ? ui.spinner("Loading reports...") : null;
        const totalReports = (await publicClient.readContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "totalReports",
        })) as bigint;

        if (totalReports === 0n) {
          if (opts.format === "json") {
            console.log(JSON.stringify([]));
            return;
          }
          spin!.succeed("No reports");
          return;
        }

        const found: any[] = [];
        for (let i = 1; i <= Number(totalReports); i++) {
          try {
            const r = (await publicClient.readContract({
              address: sgAddr,
              abi: sybilAbi,
              functionName: "reports",
              args: [BigInt(i)],
            })) as any;
            const report = {
              id: r[0],
              reporter: r[1],
              violation: r[2],
              evidenceURI: r[3],
              status: r[4],
              confirmations: r[5],
              createdAt: r[6],
              notes: r[7],
            };
            // Filter by status if specified
            if (opts.status) {
              const statusName = (REPORT_STATUS[report.status] || "").toLowerCase();
              if (statusName !== opts.status.toLowerCase()) continue;
            }
            found.push(report);
          } catch {
            break;
          }
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(found.map((r) => ({
            id: r.id.toString(),
            reporter: r.reporter,
            violation: VIOLATION_TYPE[r.violation] || "Unknown",
            evidenceURI: r.evidenceURI,
            status: REPORT_STATUS[r.status] || "Unknown",
            confirmations: Number(r.confirmations),
            createdAt: Number(r.createdAt),
            notes: r.notes,
          }))));
          return;
        }

        spin!.succeed(`${found.length} report(s)`);
        ui.table(
          ["ID", "Reporter", "Violation", "Status", "Confirms", "Age"],
          found.map((r) => [
            r.id.toString(),
            r.reporter.slice(0, 10) + "...",
            VIOLATION_TYPE[r.violation] || "Unknown",
            REPORT_STATUS[r.status] || "Unknown",
            r.confirmations.toString(),
            timeAgo(Number(r.createdAt) * 1000),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── confirm-report ─────────────────────────────────

  mod
    .command("confirm-report <id>")
    .description("Confirm a sybil report (requires JUDGE_ROLE)")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = ui.spinner(`Confirming report #${id}...`);
        const tx = await walletClient.writeContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "confirmReport",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Report #${id} confirmed`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── reject-report ──────────────────────────────────

  mod
    .command("reject-report <id>")
    .description("Reject a sybil report (requires JUDGE_ROLE)")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = ui.spinner(`Rejecting report #${id}...`);
        const tx = await walletClient.writeContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "rejectReport",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Report #${id} rejected`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── unban ──────────────────────────────────────────

  mod
    .command("unban <address>")
    .description("Unban an address (requires APPEALS_ROLE)")
    .action(async (address) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = ui.spinner(`Unbanning ${address}...`);
        const tx = await walletClient.writeContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "unban",
          args: [address as Address],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`${address} unbanned`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── check ──────────────────────────────────────────

  mod
    .command("check <address>")
    .description("Check if an address is banned")
    .action(async (address) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = ui.spinner("Checking...");
        const banned = (await publicClient.readContract({
          address: sgAddr,
          abi: sybilAbi,
          functionName: "isBanned",
          args: [address as Address],
        })) as boolean;

        if (banned) {
          const record = (await publicClient.readContract({
            address: sgAddr,
            abi: sybilAbi,
            functionName: "banRecords",
            args: [address as Address],
          })) as any;

          spin.succeed(`${address} — BANNED`);
          ui.info(`Reason: ${VIOLATION_TYPE[record[3]] || "Unknown"}`);
          ui.info(`Banned at: ${new Date(Number(record[1]) * 1000).toISOString()}`);
          ui.info(`Report ID: ${record[4].toString()}`);
          ui.info(`Seized: ${formatLob(record[5])}`);
        } else {
          spin.succeed(`${address} — not banned`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── stats ──────────────────────────────────────────

  mod
    .command("stats")
    .description("View on-chain moderation statistics")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const sgAddr = getContractAddress(ws.config, "sybilGuard");

        const spin = ui.spinner("Loading stats...");
        const [totalBans, totalSeized, totalReports] = await Promise.all([
          publicClient.readContract({
            address: sgAddr,
            abi: sybilAbi,
            functionName: "totalBans",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: sgAddr,
            abi: sybilAbi,
            functionName: "totalSeized",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: sgAddr,
            abi: sybilAbi,
            functionName: "totalReports",
          }) as Promise<bigint>,
        ]);

        spin.succeed("SybilGuard statistics");
        ui.info(`Total reports: ${totalReports.toString()}`);
        ui.info(`Total bans: ${totalBans.toString()}`);
        ui.info(`Total seized: ${formatLob(totalSeized)}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
