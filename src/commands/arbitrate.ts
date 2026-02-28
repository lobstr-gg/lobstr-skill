import { Command } from "commander";
import * as readline from "readline";
import { parseAbi, parseUnits, formatUnits, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  LOB_TOKEN_ABI,
  DISPUTE_ARBITRATION_ABI,
} from "openclaw";
import * as ui from "openclaw";
import {
  formatLob,
  ARBITRATOR_RANK,
  DISPUTE_STATUS,
  RULING,
} from "../lib/format";
import { apiGet, apiPost } from "../lib/api";

const arbAbi = parseAbi(DISPUTE_ARBITRATION_ABI as unknown as string[]);
const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);

export function registerArbitrateCommands(program: Command): void {
  const arb = program
    .command("arbitrate")
    .description("Dispute arbitration commands");

  // ── stake ──────────────────────────────────────────

  arb
    .command("stake <amount>")
    .description("Stake LOB to become an arbitrator")
    .action(async (amount) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient, address } = await createWalletClient(
          ws.config,
          ws.path
        );

        const arbAddr = getContractAddress(ws.config, "disputeArbitration");
        const tokenAddr = getContractAddress(ws.config, "lobToken");
        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner("Approving LOB...");

        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: "approve",
          args: [arbAddr, parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
        spin.text = "Staking as arbitrator...";

        const stakeTx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "stakeAsArbitrator",
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: stakeTx });

        spin.succeed(`Staked ${amount} LOB as arbitrator`);

        // Show updated info
        const info = (await publicClient.readContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "getArbitratorInfo",
          args: [address],
        })) as [bigint, number, bigint, bigint, boolean];

        ui.info(`Total stake: ${formatLob(info[0])}`);
        ui.info(`Rank: ${ARBITRATOR_RANK[info[1]] || "Unknown"}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── unstake ────────────────────────────────────────

  arb
    .command("unstake <amount>")
    .description("Withdraw arbitrator stake")
    .action(async (amount) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );

        const arbAddr = getContractAddress(ws.config, "disputeArbitration");
        const parsedAmount = parseUnits(amount, 18);

        const spin = ui.spinner("Unstaking...");
        const tx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "unstakeAsArbitrator",
          args: [parsedAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Unstaked ${amount} LOB from arbitrator pool`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── status ─────────────────────────────────────────

  arb
    .command("status")
    .description("Show your arbitrator info (rank, stake, accuracy)")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { address } = await createWalletClient(ws.config, ws.path);

        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner("Loading arbitrator info...");
        const info = (await publicClient.readContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "getArbitratorInfo",
          args: [address],
        })) as [bigint, number, bigint, bigint, boolean];

        spin.succeed("Arbitrator status");
        ui.info(`Stake: ${formatLob(info[0])}`);
        ui.info(`Rank: ${ARBITRATOR_RANK[info[1]] || "None"}`);
        ui.info(`Disputes handled: ${info[2].toString()}`);
        ui.info(`Majority votes: ${info[3].toString()}`);
        ui.info(`Active: ${info[4] ? "Yes" : "No"}`);

        if (info[2] > 0n) {
          const accuracy = Number((info[3] * 100n) / info[2]);
          ui.info(`Accuracy: ${accuracy}%`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── disputes ───────────────────────────────────────

  arb
    .command("disputes")
    .description("List disputes assigned to you")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { address } = await createWalletClient(ws.config, ws.path);

        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = opts.format !== "json" ? ui.spinner("Scanning disputes...") : null;
        const found: any[] = [];

        // Scan recent disputes (last 200 IDs)
        for (let i = 1; i <= 200; i++) {
          try {
            const dispute = (await publicClient.readContract({
              address: arbAddr,
              abi: arbAbi,
              functionName: "getDispute",
              args: [BigInt(i)],
            })) as any;

            const arbitrators = dispute[13] as string[];
            const isAssigned = arbitrators.some(
              (a: string) => a.toLowerCase() === address.toLowerCase()
            );
            if (isAssigned) {
              found.push(dispute);
            }
          } catch {
            break; // ID doesn't exist, stop scanning
          }
        }

        if (found.length === 0) {
          if (opts.format === "json") {
            console.log(JSON.stringify([]));
            return;
          }
          spin!.succeed("No disputes assigned to you");
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(found.map((d) => ({
            id: d[0].toString(),
            jobId: d[1].toString(),
            buyer: d[2],
            seller: d[3],
            amount: formatLob(d[4]),
            token: d[5],
            buyerEvidence: d[6],
            sellerEvidence: d[7],
            status: DISPUTE_STATUS[d[8]] || "Unknown",
            ruling: RULING[d[9]] || "Pending",
            createdAt: Number(d[10]),
            counterDeadline: Number(d[11]),
            votingDeadline: Number(d[12]),
            votesForBuyer: Number(d[14]),
            votesForSeller: Number(d[15]),
            totalVotes: Number(d[16]),
          }))));
          return;
        }

        spin!.succeed(`${found.length} dispute(s) found`);
        ui.table(
          ["ID", "Job", "Amount", "Status", "Ruling", "Votes"],
          found.map((d) => [
            d[0].toString(),
            d[1].toString(),
            formatLob(d[4]),
            DISPUTE_STATUS[d[8]] || "Unknown",
            RULING[d[9]] || "Pending",
            `B:${d[14]} S:${d[15]} / ${d[16]}`,
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── dispute <id> ───────────────────────────────────

  arb
    .command("dispute <id>")
    .description("View dispute details and evidence")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner("Loading dispute...");
        const d = (await publicClient.readContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "getDispute",
          args: [BigInt(id)],
        })) as any;

        spin.succeed(`Dispute #${id}`);
        ui.info(`Job ID: ${d[1].toString()}`);
        ui.info(`Buyer: ${d[2]}`);
        ui.info(`Seller: ${d[3]}`);
        ui.info(`Amount: ${formatLob(d[4])}`);
        ui.info(`Token: ${d[5]}`);
        ui.info(`Status: ${DISPUTE_STATUS[d[8]] || "Unknown"}`);
        ui.info(`Ruling: ${RULING[d[9]] || "Pending"}`);
        ui.info(
          `Created: ${new Date(Number(d[10]) * 1000).toISOString()}`
        );
        ui.info(
          `Counter-evidence deadline: ${new Date(Number(d[11]) * 1000).toISOString()}`
        );
        ui.info(
          `Voting deadline: ${new Date(Number(d[12]) * 1000).toISOString()}`
        );

        console.log();
        ui.header("Evidence");
        ui.info(`Buyer evidence: ${d[6] || "(none)"}`);
        ui.info(`Seller evidence: ${d[7] || "(none)"}`);

        console.log();
        ui.header("Arbitrators");
        const arbitrators = d[13] as string[];
        arbitrators.forEach((a: string, i: number) => {
          ui.info(`  ${i + 1}. ${a}`);
        });

        console.log();
        ui.header("Votes");
        ui.info(`For buyer: ${d[14]}`);
        ui.info(`For seller: ${d[15]}`);
        ui.info(`Total cast: ${d[16]}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── vote ───────────────────────────────────────────

  arb
    .command("vote <disputeId> <side>")
    .description("Vote on a dispute (buyer or seller)")
    .action(async (disputeId, side) => {
      try {
        const favorBuyer = side.toLowerCase() === "buyer";
        if (
          side.toLowerCase() !== "buyer" &&
          side.toLowerCase() !== "seller"
        ) {
          ui.error('Side must be "buyer" or "seller"');
          process.exit(1);
        }

        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner(
          `Voting for ${side} on dispute #${disputeId}...`
        );
        const tx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "vote",
          args: [BigInt(disputeId), favorBuyer],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Voted for ${side} on dispute #${disputeId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── execute ────────────────────────────────────────

  arb
    .command("execute <disputeId>")
    .description("Execute ruling after voting concludes")
    .action(async (disputeId) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner(`Executing ruling for dispute #${disputeId}...`);
        const tx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "executeRuling",
          args: [BigInt(disputeId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Ruling executed for dispute #${disputeId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── counter-evidence ─────────────────────────────────

  arb
    .command("counter-evidence <disputeId>")
    .description("Submit counter-evidence for a dispute (seller)")
    .requiredOption("--evidence <uri>", "Evidence URI (IPFS or HTTPS)")
    .action(async (disputeId, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner(
          `Submitting counter-evidence for dispute #${disputeId}...`
        );
        const tx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "submitCounterEvidence",
          args: [BigInt(disputeId), opts.evidence],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(
          `Counter-evidence submitted for dispute #${disputeId}`
        );
        ui.info(`Evidence URI: ${opts.evidence}`);
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── appeal ──────────────────────────────────────────

  arb
    .command("appeal <disputeId>")
    .description("Appeal a dispute ruling (requires 500 LOB bond)")
    .action(async (disputeId) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");
        const tokenAddr = getContractAddress(ws.config, "lobToken");
        const bondAmount = parseUnits("500", 18);

        const spin = ui.spinner("Approving 500 LOB bond...");
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: tokenAbi,
          functionName: "approve",
          args: [arbAddr, bondAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });

        spin.text = `Filing appeal for dispute #${disputeId}...`;
        const tx = await walletClient.writeContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "appealRuling",
          args: [BigInt(disputeId)],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

        spin.succeed(`Appeal filed for dispute #${disputeId}`);
        ui.info("500 LOB bond locked");
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── history ────────────────────────────────────────

  arb
    .command("history")
    .description("View your arbitration history and accuracy")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { address } = await createWalletClient(ws.config, ws.path);
        const arbAddr = getContractAddress(ws.config, "disputeArbitration");

        const spin = ui.spinner("Loading history...");
        const info = (await publicClient.readContract({
          address: arbAddr,
          abi: arbAbi,
          functionName: "getArbitratorInfo",
          args: [address],
        })) as [bigint, number, bigint, bigint, boolean];

        spin.succeed("Arbitration history");
        ui.info(`Total disputes handled: ${info[2].toString()}`);
        ui.info(`Majority votes (correct): ${info[3].toString()}`);
        ui.info(`Rank: ${ARBITRATOR_RANK[info[1]] || "None"}`);
        ui.info(`Current stake: ${formatLob(info[0])}`);

        if (info[2] > 0n) {
          const accuracy = Number((info[3] * 100n) / info[2]);
          const minority = info[2] - info[3];
          ui.info(`Minority votes (incorrect): ${minority.toString()}`);
          ui.info(`Accuracy rate: ${accuracy}%`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── test (AI-generated certification exam) ──────────

  arb
    .command("test")
    .description("Take the AI-generated arbitrator certification test")
    .action(async () => {
      try {
        // ── Step 1: Generate scenario ────────────────────
        const spin = ui.spinner(
          "Generating your unique test scenario (this takes ~15-30 seconds)..."
        );

        let scenario: {
          scenarioId: string;
          title: string;
          description: string;
          evidenceFiles: { name: string; type: string; url: string }[];
          mcQuestions: { question: string; options: string[] }[];
          analysisPrompt: string;
          rulingOptions: string[];
          alreadyPassed?: boolean;
          passedAt?: number;
          score?: { mc: number; analysis: number; rulingCorrect: boolean };
        };

        try {
          scenario = await apiGet("/api/arbitrator/test", true);
        } catch (err) {
          spin.fail("Failed to generate test");
          ui.error((err as Error).message);
          process.exit(1);
        }

        if (scenario.alreadyPassed) {
          spin.succeed("Already certified!");
          ui.info(`You passed the arbitrator test on ${new Date(scenario.passedAt!).toLocaleDateString()}`);
          if (scenario.score) {
            ui.info(`MC: ${scenario.score.mc}% | Analysis: ${scenario.score.analysis}% | Ruling: ${scenario.score.rulingCorrect ? "Correct" : "Incorrect"}`);
          }
          return;
        }

        spin.succeed("Test scenario generated");

        // ── Step 2: Display scenario + evidence ──────────
        console.log();
        ui.header(scenario.title);
        if (scenario.description) {
          console.log(scenario.description);
        }

        console.log();
        ui.header("Evidence Files");
        console.log("Review these files before answering questions:\n");
        const typeLabels: Record<string, string> = {
          pdf: "PDF Document",
          image: "Image",
          csv: "CSV Spreadsheet",
        };
        for (const ev of scenario.evidenceFiles) {
          const label = typeLabels[ev.type] || ev.type.toUpperCase();
          console.log(`  [${label}] ${ev.name}`);
          console.log(`  ${ev.url}\n`);
        }

        // Wait for user to review evidence
        await promptLine("Press Enter when you have reviewed all evidence files...");

        // ── Step 3: Multiple choice questions ────────────
        console.log();
        ui.header("Phase 1: Multiple Choice (80% to pass)");
        console.log("Answer each question based on the evidence you reviewed.\n");

        const mcAnswers: number[] = [];
        for (let i = 0; i < scenario.mcQuestions.length; i++) {
          const q = scenario.mcQuestions[i];
          console.log(`  ${i + 1}. ${q.question}`);
          for (let j = 0; j < q.options.length; j++) {
            console.log(`     ${j + 1}) ${q.options[j]}`);
          }

          const answer = await promptLine(`  Your answer (1-${q.options.length}): `);
          const parsed = parseInt(answer, 10);
          if (isNaN(parsed) || parsed < 1 || parsed > q.options.length) {
            ui.error(`Invalid answer. Please enter 1-${q.options.length}.`);
            process.exit(1);
          }
          mcAnswers.push(parsed - 1); // Convert to 0-indexed
          console.log();
        }

        // ── Step 4: Written analysis ─────────────────────
        console.log();
        ui.header("Phase 2: Written Analysis (70% to pass)");
        console.log(scenario.analysisPrompt);
        console.log("\nWrite your analysis (minimum 100 characters).");
        console.log("Type your analysis and press Enter when done:\n");

        const analysis = await promptLine("> ");
        if (analysis.trim().length < 100) {
          ui.error(
            `Analysis too short (${analysis.trim().length} chars, need 100+). Test aborted.`
          );
          process.exit(1);
        }

        // ── Step 5: Mock ruling ──────────────────────────
        console.log();
        ui.header("Phase 3: Mock Ruling (must be correct)");
        console.log("Based on the evidence and your analysis, cast your ruling:\n");
        console.log("  1) BuyerWins");
        console.log("  2) SellerWins");

        const rulingInput = await promptLine("\n  Your ruling (1 or 2): ");
        const rulingNum = parseInt(rulingInput, 10);
        if (rulingNum !== 1 && rulingNum !== 2) {
          ui.error("Invalid ruling. Enter 1 or 2.");
          process.exit(1);
        }
        const ruling = rulingNum === 1 ? "BuyerWins" : "SellerWins";

        // ── Step 6: Submit and grade ─────────────────────
        console.log();
        const gradeSpin = ui.spinner("Grading your submission with AI...");

        let result: {
          passed: boolean;
          scores: { mc: number; analysis: number; rulingCorrect: boolean };
          analysisFeedback?: string;
          txHash?: string | null;
        };

        try {
          result = await apiPost("/api/arbitrator/test/submit", {
            scenarioId: scenario.scenarioId,
            mcAnswers,
            analysis: analysis.trim(),
            ruling,
          });
        } catch (err) {
          gradeSpin.fail("Grading failed");
          ui.error((err as Error).message);
          process.exit(1);
        }

        // ── Step 7: Display results ──────────────────────
        if (result.passed) {
          gradeSpin.succeed("TEST PASSED — You are now a certified arbitrator!");
        } else {
          gradeSpin.fail("TEST FAILED — Review the feedback and try again.");
        }

        console.log();
        ui.header("Results");
        const mcPass = result.scores.mc >= 80;
        const analysisPass = result.scores.analysis >= 70;
        ui.info(
          `Multiple Choice: ${result.scores.mc}% ${mcPass ? "(PASS)" : "(FAIL — need 80%)"}`
        );
        ui.info(
          `Written Analysis: ${result.scores.analysis}% ${analysisPass ? "(PASS)" : "(FAIL — need 70%)"}`
        );
        ui.info(
          `Mock Ruling: ${result.scores.rulingCorrect ? "Correct (PASS)" : "Incorrect (FAIL)"}`
        );

        if (result.analysisFeedback) {
          console.log();
          ui.header("AI Feedback");
          console.log(result.analysisFeedback);
        }

        if (result.txHash && result.txHash !== "already-certified") {
          console.log();
          ui.success(`On-chain certification TX: ${result.txHash}`);
        }

        if (!result.passed) {
          console.log();
          ui.info('Run "lobstr arbitrate test" again to retake.');
          process.exit(1);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}

/** Prompt for a single line of input via readline. */
function promptLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
