import { Command } from "commander";
import { parseAbi, parseUnits, keccak256, toHex, encodeFunctionData, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
  LOB_TOKEN_ABI,
  TREASURY_GOVERNOR_ABI,
} from "openclaw";
import * as ui from "openclaw";
import { formatLob, PROPOSAL_STATUS } from "../lib/format";

const govAbi = parseAbi(TREASURY_GOVERNOR_ABI as unknown as string[]);
const tokenAbi = parseAbi(LOB_TOKEN_ABI as unknown as string[]);
const accessControlAbi = parseAbi([
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account)',
]);

export function registerDaoCommands(program: Command): void {
  const dao = program
    .command("dao")
    .description("DAO treasury and governance commands");

  // ── proposals ──────────────────────────────────────

  dao
    .command("proposals")
    .description("List active spending proposals")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = opts.format !== "json" ? ui.spinner("Loading proposals...") : null;
        const found: any[] = [];

        for (let i = 1; i <= 100; i++) {
          try {
            const result = (await publicClient.readContract({
              address: govAddr,
              abi: govAbi,
              functionName: "getProposal",
              args: [BigInt(i)],
            })) as any;
            const p = {
              id: result.id ?? result[0],
              proposer: result.proposer ?? result[1],
              token: result.token ?? result[2],
              recipient: result.recipient ?? result[3],
              amount: result.amount ?? result[4],
              description: result.description ?? result[5],
              status: result.status ?? result[6],
              approvalCount: result.approvalCount ?? result[7],
              createdAt: result.createdAt ?? result[8],
              timelockEnd: result.timelockEnd ?? result[9],
            };
            if (p.id === 0n) break;
            found.push(p);
          } catch {
            break;
          }
        }

        if (found.length === 0) {
          if (opts.format === "json") {
            console.log(JSON.stringify([]));
            return;
          }
          spin!.succeed("No proposals found");
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(found.map((p) => ({
            id: p.id.toString(),
            proposer: p.proposer,
            token: p.token,
            recipient: p.recipient,
            amount: formatLob(p.amount),
            description: p.description,
            status: PROPOSAL_STATUS[p.status] || "Unknown",
            approvalCount: Number(p.approvalCount),
            createdAt: Number(p.createdAt),
            timelockEnd: Number(p.timelockEnd),
          }))));
          return;
        }

        spin!.succeed(`${found.length} proposal(s)`);
        ui.table(
          ["ID", "Proposer", "Recipient", "Amount", "Status", "Approvals"],
          found.map((p) => [
            p.id.toString(),
            p.proposer.slice(0, 10) + "...",
            p.recipient.slice(0, 10) + "...",
            formatLob(p.amount),
            PROPOSAL_STATUS[p.status] || "Unknown",
            p.approvalCount.toString(),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── proposal <id> ──────────────────────────────────

  dao
    .command("proposal <id>")
    .description("View proposal details")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Loading proposal...");
        const result = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "getProposal",
          args: [BigInt(id)],
        })) as any;

        const p = {
          id: result.id ?? result[0],
          proposer: result.proposer ?? result[1],
          token: result.token ?? result[2],
          recipient: result.recipient ?? result[3],
          amount: result.amount ?? result[4],
          description: result.description ?? result[5],
          status: result.status ?? result[6],
          approvalCount: result.approvalCount ?? result[7],
          createdAt: result.createdAt ?? result[8],
          timelockEnd: result.timelockEnd ?? result[9],
        };

        const expired = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "isProposalExpired",
          args: [BigInt(id)],
        })) as boolean;

        spin.succeed(`Proposal #${id}`);
        ui.info(`Proposer: ${p.proposer}`);
        ui.info(`Token: ${p.token}`);
        ui.info(`Recipient: ${p.recipient}`);
        ui.info(`Amount: ${formatLob(p.amount)}`);
        ui.info(`Description: ${p.description}`);
        ui.info(`Status: ${PROPOSAL_STATUS[p.status] || "Unknown"}${expired ? " (EXPIRED)" : ""}`);
        ui.info(`Approvals: ${p.approvalCount.toString()}`);
        ui.info(`Created: ${new Date(Number(p.createdAt) * 1000).toISOString()}`);
        if (p.timelockEnd > 0n) {
          ui.info(`Timelock ends: ${new Date(Number(p.timelockEnd) * 1000).toISOString()}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── propose ────────────────────────────────────────

  dao
    .command("propose")
    .description("Create a spending proposal")
    .requiredOption("--recipient <address>", "Recipient address")
    .requiredOption("--amount <amount>", "Amount in LOB")
    .requiredOption("--description <desc>", "Proposal description")
    .option("--token <address>", "Token address (defaults to LOB)")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");
        const tokenAddr = opts.token || getContractAddress(ws.config, "lobToken");
        const parsedAmount = parseUnits(opts.amount, 18);

        const spin = ui.spinner("Creating proposal...");
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "createProposal",
          args: [
            tokenAddr as Address,
            opts.recipient as Address,
            parsedAmount,
            opts.description,
          ],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed("Proposal created");
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── approve ────────────────────────────────────────

  dao
    .command("approve <id>")
    .description("Approve a pending proposal")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner(`Approving proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "approveProposal",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Approved proposal #${id}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── execute ────────────────────────────────────────

  dao
    .command("execute <id>")
    .description("Execute an approved proposal (after timelock)")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner(`Executing proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "executeProposal",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Proposal #${id} executed`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── cancel ─────────────────────────────────────────

  dao
    .command("cancel <id>")
    .description("Cancel a proposal (proposer or guardian)")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner(`Cancelling proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "cancelProposal",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Proposal #${id} cancelled`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── admin-proposals ───────────────────────────────

  dao
    .command("admin-proposals")
    .description("List admin proposals (role grants, contract calls)")
    .option("--format <fmt>", "Output format: text, json", "text")
    .option("--status <status>", "Filter by status: pending, approved, executed, cancelled")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = opts.format !== "json" ? ui.spinner("Loading admin proposals...") : null;
        const found: any[] = [];

        const CONTRACT_LABELS: Record<string, string> = {
          "0xd41a40145811915075f6935a4755f8688e53c8db": "ReputationSystem",
          "0xcb7790d3f9b5bfe171eb30c253ab3007d43c441b": "StakingManager",
          "0x576235a56e0e25feb95ea198d017070ad7f78360": "EscrowEngine",
          "0xffbded2dba5e27ad5a56c6d4c401124e942ada04": "DisputeArbitration",
          "0xf5ab9f1a5c6cc60e1a68d50b4c943d72fd97487a": "LoanEngine",
          "0x0d1d8583561310adeefe18cb3a5729e2666ac14c": "X402CreditFacility",
          "0x545a01e48cfb6a76699ef12ec1e998c1a275c84e": "SybilGuard",
          "0xe1d68167a15afa7c4e22df978dc4a66a0b4114fe": "InsurancePool",
          "0x9b7e2b8cf7de5ef1f85038b050952dc1d4596319": "TreasuryGovernor",
        };

        for (let i = 1; i <= 100; i++) {
          try {
            const result = (await publicClient.readContract({
              address: govAddr,
              abi: govAbi,
              functionName: "getAdminProposal",
              args: [BigInt(i)],
            })) as any;
            const p = {
              id: result.id ?? result[0],
              proposer: result.proposer ?? result[1],
              target: result.target ?? result[2],
              callData: result.callData ?? result[3],
              description: result.description ?? result[4],
              status: result.status ?? result[5],
              approvalCount: result.approvalCount ?? result[6],
              createdAt: result.createdAt ?? result[7],
              timelockEnd: result.timelockEnd ?? result[8],
            };
            if (p.id === 0n) break;
            found.push(p);
          } catch {
            break;
          }
        }

        // Apply status filter
        const statusFilter = opts.status?.toLowerCase();
        const filtered = statusFilter
          ? found.filter((p) => PROPOSAL_STATUS[p.status]?.toLowerCase() === statusFilter)
          : found;

        if (filtered.length === 0) {
          if (opts.format === "json") {
            console.log(JSON.stringify([]));
            return;
          }
          spin!.succeed(found.length > 0 ? `No ${statusFilter} admin proposals (${found.length} total)` : "No admin proposals found");
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(filtered.map((p) => ({
            id: p.id.toString(),
            proposer: p.proposer,
            target: p.target,
            targetLabel: CONTRACT_LABELS[p.target.toLowerCase()] || "Unknown",
            description: p.description,
            status: PROPOSAL_STATUS[p.status] || "Unknown",
            approvalCount: Number(p.approvalCount),
            createdAt: Number(p.createdAt),
            timelockEnd: Number(p.timelockEnd),
          }))));
          return;
        }

        spin!.succeed(`${filtered.length} admin proposal(s)${statusFilter ? ` (${statusFilter})` : ""}`);
        ui.table(
          ["ID", "Target", "Description", "Status", "Approvals", "Created"],
          filtered.map((p) => [
            p.id.toString(),
            CONTRACT_LABELS[p.target.toLowerCase()] || p.target.slice(0, 10) + "...",
            p.description.length > 50 ? p.description.slice(0, 47) + "..." : p.description,
            PROPOSAL_STATUS[p.status] || "Unknown",
            `${p.approvalCount}/3`,
            new Date(Number(p.createdAt) * 1000).toLocaleDateString(),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── admin-proposal <id> ──────────────────────────

  dao
    .command("admin-proposal <id>")
    .description("View admin proposal details")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Loading admin proposal...");
        const result = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "getAdminProposal",
          args: [BigInt(id)],
        })) as any;

        const p = {
          id: result.id ?? result[0],
          proposer: result.proposer ?? result[1],
          target: result.target ?? result[2],
          callData: result.callData ?? result[3],
          description: result.description ?? result[4],
          status: result.status ?? result[5],
          approvalCount: result.approvalCount ?? result[6],
          createdAt: result.createdAt ?? result[7],
          timelockEnd: result.timelockEnd ?? result[8],
        };

        spin.succeed(`Admin Proposal #${id}`);
        ui.info(`Description: ${p.description}`);
        ui.info(`Target: ${p.target}`);
        ui.info(`Proposer: ${p.proposer}`);
        ui.info(`Status: ${PROPOSAL_STATUS[p.status] || "Unknown"}`);
        ui.info(`Approvals: ${p.approvalCount}/3`);
        ui.info(`Calldata: ${p.callData}`);
        ui.info(`Created: ${new Date(Number(p.createdAt) * 1000).toISOString()}`);
        if (p.timelockEnd > 0n) {
          ui.info(`Timelock ends: ${new Date(Number(p.timelockEnd) * 1000).toISOString()}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── admin-propose ──────────────────────────────────

  dao
    .command("admin-propose")
    .description("Create an admin proposal (arbitrary contract call)")
    .requiredOption("--target <address>", "Target contract address")
    .requiredOption("--calldata <hex>", "Encoded calldata (0x...)")
    .requiredOption("--description <desc>", "Proposal description")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Creating admin proposal...");
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "createAdminProposal",
          args: [
            opts.target as Address,
            opts.calldata as `0x${string}`,
            opts.description,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed("Admin proposal created");
        ui.info(`Tx: ${tx}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── admin-approve ──────────────────────────────────

  dao
    .command("admin-approve <id>")
    .description("Approve an admin proposal")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner(`Approving admin proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "approveAdminProposal",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Admin proposal #${id} approved`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── admin-execute ──────────────────────────────────

  dao
    .command("admin-execute <id>")
    .description("Execute an approved admin proposal (after timelock)")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner(`Executing admin proposal #${id}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "executeAdminProposal",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Admin proposal #${id} executed`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── streams ────────────────────────────────────────

  dao
    .command("streams")
    .description("List your payment streams")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { address } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = opts.format !== "json" ? ui.spinner("Loading streams...") : null;
        const streamIds = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "getRecipientStreams",
          args: [address],
        })) as bigint[];

        if (streamIds.length === 0) {
          if (opts.format === "json") {
            console.log(JSON.stringify([]));
            return;
          }
          spin!.succeed("No payment streams");
          return;
        }

        const streams: any[] = [];
        for (const sid of streamIds) {
          const streamResult = await publicClient.readContract({
            address: govAddr,
            abi: govAbi,
            functionName: "getStream",
            args: [sid],
          }) as any;
          const s = {
            id: streamResult.id ?? streamResult[0],
            recipient: streamResult.recipient ?? streamResult[1],
            token: streamResult.token ?? streamResult[2],
            totalAmount: streamResult.totalAmount ?? streamResult[3],
            claimedAmount: streamResult.claimedAmount ?? streamResult[4],
            startTime: streamResult.startTime ?? streamResult[5],
            endTime: streamResult.endTime ?? streamResult[6],
            role: streamResult.role ?? streamResult[7],
            active: streamResult.active ?? streamResult[8],
          };
          const claimable = await publicClient.readContract({
            address: govAddr,
            abi: govAbi,
            functionName: "streamClaimable",
            args: [sid],
          });
          streams.push({ ...s, claimable });
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(streams.map((s: any) => ({
            id: s.id.toString(),
            role: s.role,
            totalAmount: formatLob(s.totalAmount),
            claimedAmount: formatLob(s.claimedAmount),
            claimable: formatLob(s.claimable),
            active: s.active,
            endTime: Number(s.endTime),
          }))));
          return;
        }

        spin!.succeed(`${streams.length} stream(s)`);
        ui.table(
          ["ID", "Role", "Total", "Claimed", "Claimable", "Active", "Ends"],
          streams.map((s: any) => [
            s.id.toString(),
            s.role,
            formatLob(s.totalAmount),
            formatLob(s.claimedAmount),
            formatLob(s.claimable),
            s.active ? "Yes" : "No",
            new Date(Number(s.endTime) * 1000).toLocaleDateString(),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── claim ──────────────────────────────────────────

  dao
    .command("claim <streamId>")
    .description("Claim vested funds from a payment stream")
    .action(async (streamId) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(
          ws.config,
          ws.path
        );
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const claimable = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "streamClaimable",
          args: [BigInt(streamId)],
        })) as bigint;

        if (claimable === 0n) {
          ui.warn("Nothing to claim yet");
          return;
        }

        const spin = ui.spinner(`Claiming ${formatLob(claimable)}...`);
        const tx = await walletClient.writeContract({
          address: govAddr,
          abi: govAbi,
          functionName: "claimStream",
          args: [BigInt(streamId)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Claimed ${formatLob(claimable)} from stream #${streamId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── treasury ───────────────────────────────────────

  dao
    .command("treasury")
    .description("View treasury balances")
    .option("--format <fmt>", "Output format: text, json", "text")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");
        const tokenAddr = getContractAddress(ws.config, "lobToken");

        const spin = opts.format !== "json" ? ui.spinner("Loading treasury...") : null;
        const lobBalance = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "getBalance",
          args: [tokenAddr],
        })) as bigint;

        const reqApprovals = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "requiredApprovals",
        })) as bigint;

        const signers = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "signerCount",
        })) as bigint;

        if (opts.format === "json") {
          console.log(JSON.stringify({
            lobBalance: formatLob(lobBalance),
            requiredApprovals: Number(reqApprovals),
            signerCount: Number(signers),
          }));
          return;
        }

        spin!.succeed("Treasury status");
        ui.info(`LOB balance: ${formatLob(lobBalance)}`);
        ui.info(`Multisig: ${reqApprovals.toString()}-of-${signers.toString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── signers ────────────────────────────────────────

  dao
    .command("signers")
    .description("View multisig signer info")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Loading signer info...");
        const reqApprovals = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "requiredApprovals",
        })) as bigint;

        const signerCount = (await publicClient.readContract({
          address: govAddr,
          abi: govAbi,
          functionName: "signerCount",
        })) as bigint;

        spin.succeed("Multisig configuration");
        ui.info(`Signer count: ${signerCount.toString()}`);
        ui.info(`Required approvals: ${reqApprovals.toString()}`);
        ui.info(`Threshold: ${reqApprovals.toString()}-of-${signerCount.toString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── setup-roles ─────────────────────────────────────
  // Submits admin proposals for all missing cross-contract role grants.
  // Mirrors GrantMissingRoles.s.sol — checks hasRole on-chain first.

  dao
    .command("setup-roles")
    .description("Submit admin proposals for all missing cross-contract role grants")
    .option("--deployer <address>", "Address for X402 operational roles (FACILITATOR/POOL_MANAGER)")
    .option("--dry-run", "Check roles without submitting proposals")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        // Resolve all contract addresses
        const reputationSystem = getContractAddress(ws.config, "reputationSystem");
        const stakingManager = getContractAddress(ws.config, "stakingManager");
        const escrowEngine = getContractAddress(ws.config, "escrowEngine");
        const disputeArbitration = getContractAddress(ws.config, "disputeArbitration");
        const loanEngine = getContractAddress(ws.config, "loanEngine");
        const x402Credit = getContractAddress(ws.config, "x402CreditFacility");
        const sybilGuard = getContractAddress(ws.config, "sybilGuard");
        const insurancePool = getContractAddress(ws.config, "insurancePool");

        // Role hashes — keccak256 of role name, same as Solidity
        const RECORDER_ROLE = keccak256(toHex("RECORDER_ROLE"));
        const SLASHER_ROLE = keccak256(toHex("SLASHER_ROLE"));
        const LOCKER_ROLE = keccak256(toHex("LOCKER_ROLE"));

        type RoleGrant = {
          target: Address;
          targetLabel: string;
          role: `0x${string}`;
          roleLabel: string;
          grantee: Address;
          granteeLabel: string;
          description: string;
        };

        const roleGrants: RoleGrant[] = [
          // RECORDER_ROLE on ReputationSystem (5 grants)
          { target: reputationSystem, targetLabel: "ReputationSystem", role: RECORDER_ROLE, roleLabel: "RECORDER_ROLE", grantee: escrowEngine, granteeLabel: "EscrowEngine", description: "Grant RECORDER_ROLE on ReputationSystem to EscrowEngine" },
          { target: reputationSystem, targetLabel: "ReputationSystem", role: RECORDER_ROLE, roleLabel: "RECORDER_ROLE", grantee: disputeArbitration, granteeLabel: "DisputeArbitration", description: "Grant RECORDER_ROLE on ReputationSystem to DisputeArbitration" },
          { target: reputationSystem, targetLabel: "ReputationSystem", role: RECORDER_ROLE, roleLabel: "RECORDER_ROLE", grantee: loanEngine, granteeLabel: "LoanEngine", description: "Grant RECORDER_ROLE on ReputationSystem to LoanEngine" },
          { target: reputationSystem, targetLabel: "ReputationSystem", role: RECORDER_ROLE, roleLabel: "RECORDER_ROLE", grantee: x402Credit, granteeLabel: "X402CreditFacility", description: "Grant RECORDER_ROLE on ReputationSystem to X402CreditFacility" },
          { target: reputationSystem, targetLabel: "ReputationSystem", role: RECORDER_ROLE, roleLabel: "RECORDER_ROLE", grantee: insurancePool, granteeLabel: "InsurancePool", description: "Grant RECORDER_ROLE on ReputationSystem to InsurancePool" },
          // SLASHER_ROLE on StakingManager (4 grants)
          { target: stakingManager, targetLabel: "StakingManager", role: SLASHER_ROLE, roleLabel: "SLASHER_ROLE", grantee: disputeArbitration, granteeLabel: "DisputeArbitration", description: "Grant SLASHER_ROLE on StakingManager to DisputeArbitration" },
          { target: stakingManager, targetLabel: "StakingManager", role: SLASHER_ROLE, roleLabel: "SLASHER_ROLE", grantee: sybilGuard, granteeLabel: "SybilGuard", description: "Grant SLASHER_ROLE on StakingManager to SybilGuard" },
          { target: stakingManager, targetLabel: "StakingManager", role: SLASHER_ROLE, roleLabel: "SLASHER_ROLE", grantee: loanEngine, granteeLabel: "LoanEngine", description: "Grant SLASHER_ROLE on StakingManager to LoanEngine" },
          { target: stakingManager, targetLabel: "StakingManager", role: SLASHER_ROLE, roleLabel: "SLASHER_ROLE", grantee: x402Credit, granteeLabel: "X402CreditFacility", description: "Grant SLASHER_ROLE on StakingManager to X402CreditFacility" },
          // LOCKER_ROLE on StakingManager (2 grants)
          { target: stakingManager, targetLabel: "StakingManager", role: LOCKER_ROLE, roleLabel: "LOCKER_ROLE", grantee: loanEngine, granteeLabel: "LoanEngine", description: "Grant LOCKER_ROLE on StakingManager to LoanEngine" },
          { target: stakingManager, targetLabel: "StakingManager", role: LOCKER_ROLE, roleLabel: "LOCKER_ROLE", grantee: x402Credit, granteeLabel: "X402CreditFacility", description: "Grant LOCKER_ROLE on StakingManager to X402CreditFacility" },
        ];

        // Optionally add X402 operational roles (FACILITATOR + POOL_MANAGER)
        if (opts.deployer) {
          const FACILITATOR_ROLE = keccak256(toHex("FACILITATOR_ROLE"));
          const POOL_MANAGER_ROLE = keccak256(toHex("POOL_MANAGER_ROLE"));
          const deployer = opts.deployer as Address;
          roleGrants.push(
            { target: x402Credit, targetLabel: "X402CreditFacility", role: FACILITATOR_ROLE, roleLabel: "FACILITATOR_ROLE", grantee: deployer, granteeLabel: "Deployer", description: `Grant FACILITATOR_ROLE on X402CreditFacility to ${deployer.slice(0, 10)}...` },
            { target: x402Credit, targetLabel: "X402CreditFacility", role: POOL_MANAGER_ROLE, roleLabel: "POOL_MANAGER_ROLE", grantee: deployer, granteeLabel: "Deployer", description: `Grant POOL_MANAGER_ROLE on X402CreditFacility to ${deployer.slice(0, 10)}...` },
          );
        }

        const spin = ui.spinner(`Checking ${roleGrants.length} role grants on-chain...`);
        const missing: RoleGrant[] = [];
        const granted: RoleGrant[] = [];

        for (const grant of roleGrants) {
          const has = (await publicClient.readContract({
            address: grant.target,
            abi: accessControlAbi,
            functionName: "hasRole",
            args: [grant.role, grant.grantee],
          })) as boolean;

          if (has) {
            granted.push(grant);
          } else {
            missing.push(grant);
          }
        }

        spin.succeed(`${granted.length} already granted, ${missing.length} missing`);

        if (granted.length > 0) {
          for (const g of granted) {
            ui.info(`  OK  ${g.targetLabel}: ${g.roleLabel} -> ${g.granteeLabel}`);
          }
        }

        if (missing.length === 0) {
          ui.info("All cross-contract roles are properly configured!");
          return;
        }

        ui.info("");
        for (const m of missing) {
          ui.warn(`  MISS ${m.targetLabel}: ${m.roleLabel} -> ${m.granteeLabel}`);
        }

        if (opts.dryRun) {
          ui.info("");
          ui.info(`Dry run complete. ${missing.length} role grant proposals needed.`);
          return;
        }

        // Submit proposals for missing roles
        ui.info("");
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        let submitted = 0;
        let failed = 0;

        for (const grant of missing) {
          const calldata = encodeFunctionData({
            abi: accessControlAbi,
            functionName: "grantRole",
            args: [grant.role, grant.grantee],
          });

          const txSpin = ui.spinner(`Submitting: ${grant.description}...`);
          try {
            const tx = await walletClient.writeContract({
              address: govAddr,
              abi: govAbi,
              functionName: "createAdminProposal",
              args: [grant.target, calldata, grant.description],
            });
            await publicClient.waitForTransactionReceipt({ hash: tx });
            txSpin.succeed(`Submitted: ${grant.description}`);
            submitted++;
          } catch (txErr) {
            txSpin.fail(`Failed: ${grant.description} - ${(txErr as Error).message.slice(0, 80)}`);
            failed++;
          }
        }

        ui.info("");
        ui.info(`Proposals submitted: ${submitted}, failed: ${failed}, already granted: ${granted.length}`);
        if (submitted > 0) {
          ui.info("");
          ui.info("Next steps:");
          ui.info("  1. Other signers run: lobstr dao approve-pending");
          ui.info("  2. After 24h timelock: lobstr dao execute-ready");
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── approve-pending ─────────────────────────────────
  // Batch approves all pending admin proposals this wallet hasn't approved yet.

  dao
    .command("approve-pending")
    .description("Batch approve all pending admin proposals you haven't approved yet")
    .option("--dry-run", "Show what would be approved without sending transactions")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient, address } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Scanning admin proposals...");
        const pending: { id: bigint; description: string; approvalCount: bigint }[] = [];

        for (let i = 1; i <= 100; i++) {
          try {
            const result = (await publicClient.readContract({
              address: govAddr,
              abi: govAbi,
              functionName: "getAdminProposal",
              args: [BigInt(i)],
            })) as any;
            const p = {
              id: result.id ?? result[0],
              status: result.status ?? result[5],
              approvalCount: result.approvalCount ?? result[6],
              description: result.description ?? result[4],
              createdAt: result.createdAt ?? result[7],
            };
            if (p.id === 0n) break;

            // Only consider Pending proposals (status 0) that aren't expired
            const now = Math.floor(Date.now() / 1000);
            const EXPIRY = 7 * 24 * 60 * 60; // 7 days
            if (p.status !== 0 || now > Number(p.createdAt) + EXPIRY) continue;

            // Check if we already approved
            const alreadyApproved = (await publicClient.readContract({
              address: govAddr,
              abi: govAbi,
              functionName: "adminProposalApprovals",
              args: [p.id, address],
            })) as boolean;

            if (!alreadyApproved) {
              pending.push({ id: p.id, description: p.description, approvalCount: p.approvalCount });
            }
          } catch {
            break;
          }
        }

        if (pending.length === 0) {
          spin.succeed("No pending admin proposals to approve");
          return;
        }

        spin.succeed(`${pending.length} proposal(s) need your approval`);

        if (opts.dryRun) {
          for (const p of pending) {
            ui.info(`  #${p.id} (${p.approvalCount}/3): ${p.description}`);
          }
          ui.info("");
          ui.info("Dry run — no transactions sent.");
          return;
        }

        let approved = 0;
        for (const p of pending) {
          const txSpin = ui.spinner(`Approving #${p.id}: ${p.description}...`);
          try {
            const tx = await walletClient.writeContract({
              address: govAddr,
              abi: govAbi,
              functionName: "approveAdminProposal",
              args: [p.id],
            });
            await publicClient.waitForTransactionReceipt({ hash: tx });
            txSpin.succeed(`Approved #${p.id} (now ${Number(p.approvalCount) + 1}/3): ${p.description}`);
            approved++;
          } catch (txErr) {
            txSpin.fail(`Failed #${p.id}: ${(txErr as Error).message.slice(0, 80)}`);
          }
        }

        ui.info("");
        ui.info(`Approved ${approved} of ${pending.length} proposals`);
        ui.info("Once 3/3 approvals reached, 24h timelock starts.");
        ui.info("Then run: lobstr dao execute-ready");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── execute-ready ───────────────────────────────────
  // Batch executes all approved admin proposals past their 24h timelock.

  dao
    .command("execute-ready")
    .description("Batch execute all approved admin proposals past their 24h timelock")
    .option("--dry-run", "Show what would be executed without sending transactions")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const govAddr = getContractAddress(ws.config, "treasuryGovernor");

        const spin = ui.spinner("Scanning admin proposals...");

        const CONTRACT_LABELS: Record<string, string> = {
          "0xd41a40145811915075f6935a4755f8688e53c8db": "ReputationSystem",
          "0xcb7790d3f9b5bfe171eb30c253ab3007d43c441b": "StakingManager",
          "0x576235a56e0e25feb95ea198d017070ad7f78360": "EscrowEngine",
          "0xffbded2dba5e27ad5a56c6d4c401124e942ada04": "DisputeArbitration",
          "0xf5ab9f1a5c6cc60e1a68d50b4c943d72fd97487a": "LoanEngine",
          "0x0d1d8583561310adeefe18cb3a5729e2666ac14c": "X402CreditFacility",
          "0x545a01e48cfb6a76699ef12ec1e998c1a275c84e": "SybilGuard",
          "0xe1d68167a15afa7c4e22df978dc4a66a0b4114fe": "InsurancePool",
        };

        const ready: { id: bigint; description: string; target: string; timelockEnd: bigint }[] = [];
        const waiting: { id: bigint; description: string; timelockEnd: bigint }[] = [];
        const now = Math.floor(Date.now() / 1000);
        const EXPIRY = 7 * 24 * 60 * 60;

        for (let i = 1; i <= 100; i++) {
          try {
            const result = (await publicClient.readContract({
              address: govAddr,
              abi: govAbi,
              functionName: "getAdminProposal",
              args: [BigInt(i)],
            })) as any;
            const p = {
              id: result.id ?? result[0],
              target: result.target ?? result[2],
              description: result.description ?? result[4],
              status: result.status ?? result[5],
              createdAt: result.createdAt ?? result[7],
              timelockEnd: result.timelockEnd ?? result[8],
            };
            if (p.id === 0n) break;

            // Only consider Approved proposals (status 1) that aren't expired
            if (p.status !== 1 || now > Number(p.createdAt) + EXPIRY) continue;

            if (now >= Number(p.timelockEnd)) {
              ready.push({ id: p.id, description: p.description, target: p.target, timelockEnd: p.timelockEnd });
            } else {
              waiting.push({ id: p.id, description: p.description, timelockEnd: p.timelockEnd });
            }
          } catch {
            break;
          }
        }

        if (ready.length === 0 && waiting.length === 0) {
          spin.succeed("No approved admin proposals found");
          return;
        }

        spin.succeed(`${ready.length} ready to execute, ${waiting.length} still in timelock`);

        if (waiting.length > 0) {
          for (const w of waiting) {
            const unlockDate = new Date(Number(w.timelockEnd) * 1000);
            ui.info(`  WAIT #${w.id}: unlocks ${unlockDate.toISOString()} — ${w.description}`);
          }
        }

        if (ready.length === 0) {
          ui.info("Nothing to execute yet. Check back after timelock expires.");
          return;
        }

        if (opts.dryRun) {
          for (const r of ready) {
            const label = CONTRACT_LABELS[r.target.toLowerCase()] || r.target.slice(0, 10) + "...";
            ui.info(`  READY #${r.id} (${label}): ${r.description}`);
          }
          ui.info("");
          ui.info("Dry run — no transactions sent.");
          return;
        }

        let executed = 0;
        for (const r of ready) {
          const label = CONTRACT_LABELS[r.target.toLowerCase()] || r.target.slice(0, 10) + "...";
          const txSpin = ui.spinner(`Executing #${r.id} (${label}): ${r.description}...`);
          try {
            const tx = await walletClient.writeContract({
              address: govAddr,
              abi: govAbi,
              functionName: "executeAdminProposal",
              args: [r.id],
            });
            await publicClient.waitForTransactionReceipt({ hash: tx });
            txSpin.succeed(`Executed #${r.id}: ${r.description}`);
            executed++;
          } catch (txErr) {
            txSpin.fail(`Failed #${r.id}: ${(txErr as Error).message.slice(0, 80)}`);
          }
        }

        ui.info("");
        ui.info(`Executed ${executed} of ${ready.length} proposals`);
        if (executed > 0) {
          ui.info("Role grants are now active on-chain!");
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
