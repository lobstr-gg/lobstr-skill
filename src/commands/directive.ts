import { Command } from "commander";
import { parseAbi, keccak256, toBytes, type Address } from "viem";
import {
  ensureWorkspace,
  createPublicClient,
  createWalletClient,
  getContractAddress,
} from "openclaw";
import * as ui from "openclaw";

const DIRECTIVE_TYPE_NAMES: Record<number, string> = {
  0: "DisputeReview",
  1: "ModAlert",
  2: "AgentTask",
  3: "SystemBroadcast",
  4: "GovernanceAction",
};

const DIRECTIVE_STATUS_NAMES: Record<number, string> = {
  0: "Active",
  1: "Executed",
  2: "Cancelled",
};

const DIRECTIVE_BOARD_ABI = parseAbi([
  "function postDirective(uint8 directiveType, address target, bytes32 contentHash, string contentURI, uint256 expiresAt) external returns (uint256)",
  "function markExecuted(uint256 id) external",
  "function cancelDirective(uint256 id) external",
  "function getDirective(uint256 id) external view returns ((uint256 id, uint8 directiveType, address poster, address target, bytes32 contentHash, string contentURI, uint8 status, uint256 createdAt, uint256 expiresAt))",
  "function getActiveDirectives(address target) external view returns (uint256[])",
  "function getDirectivesByType(uint8 directiveType) external view returns (uint256[])",
]);

export function registerDirectiveCommands(program: Command): void {
  const dir = program
    .command("directive")
    .description("DirectiveBoard commands");

  // ── list ──────────────────────────────────────────────

  dir
    .command("list")
    .description("List active directives")
    .option("--type <type>", "Filter by type (0-4 or name)")
    .option("--target <address>", "Filter by target address")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const boardAddr = getContractAddress(ws.config, "directiveBoard");

        const spin = ui.spinner("Loading directives...");
        let ids: bigint[];

        if (opts.type !== undefined) {
          const typeNum = resolveType(opts.type);
          ids = (await publicClient.readContract({
            address: boardAddr,
            abi: DIRECTIVE_BOARD_ABI,
            functionName: "getDirectivesByType",
            args: [typeNum],
          })) as bigint[];
        } else {
          const target = opts.target || "0x0000000000000000000000000000000000000000";
          ids = (await publicClient.readContract({
            address: boardAddr,
            abi: DIRECTIVE_BOARD_ABI,
            functionName: "getActiveDirectives",
            args: [target as Address],
          })) as bigint[];
        }

        if (ids.length === 0) {
          spin.succeed("No active directives found");
          return;
        }

        const rows: string[][] = [];
        for (const id of ids) {
          const d = (await publicClient.readContract({
            address: boardAddr,
            abi: DIRECTIVE_BOARD_ABI,
            functionName: "getDirective",
            args: [id],
          })) as any;

          rows.push([
            d.id.toString(),
            DIRECTIVE_TYPE_NAMES[d.directiveType] || "Unknown",
            d.target === "0x0000000000000000000000000000000000000000" ? "broadcast" : d.target.slice(0, 10) + "...",
            DIRECTIVE_STATUS_NAMES[d.status] || "Unknown",
            d.contentURI.length > 40 ? d.contentURI.slice(0, 37) + "..." : d.contentURI,
          ]);
        }

        spin.succeed(`${ids.length} directive(s)`);
        ui.table(["ID", "Type", "Target", "Status", "URI"], rows);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── view ──────────────────────────────────────────────

  dir
    .command("view <id>")
    .description("View directive details")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const boardAddr = getContractAddress(ws.config, "directiveBoard");

        const spin = ui.spinner("Loading directive...");
        const d = (await publicClient.readContract({
          address: boardAddr,
          abi: DIRECTIVE_BOARD_ABI,
          functionName: "getDirective",
          args: [BigInt(id)],
        })) as any;

        spin.succeed(`Directive #${id}`);
        ui.info(`Type: ${DIRECTIVE_TYPE_NAMES[d.directiveType] || "Unknown"}`);
        ui.info(`Poster: ${d.poster}`);
        ui.info(`Target: ${d.target === "0x0000000000000000000000000000000000000000" ? "broadcast" : d.target}`);
        ui.info(`Status: ${DIRECTIVE_STATUS_NAMES[d.status] || "Unknown"}`);
        ui.info(`Content URI: ${d.contentURI}`);
        ui.info(`Content Hash: ${d.contentHash}`);
        ui.info(`Created: ${new Date(Number(d.createdAt) * 1000).toISOString()}`);
        ui.info(`Expires: ${d.expiresAt === 0n ? "never" : new Date(Number(d.expiresAt) * 1000).toISOString()}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── execute ───────────────────────────────────────────

  dir
    .command("execute <id>")
    .description("Mark directive as executed")
    .action(async (id) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const boardAddr = getContractAddress(ws.config, "directiveBoard");

        const spin = ui.spinner(`Executing directive #${id}...`);
        const tx = await walletClient.writeContract({
          address: boardAddr,
          abi: DIRECTIVE_BOARD_ABI,
          functionName: "markExecuted",
          args: [BigInt(id)],
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Directive #${id} marked as executed`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── post ──────────────────────────────────────────────

  dir
    .command("post <type> <target> <contentURI>")
    .description("Post a new directive (requires POSTER_ROLE)")
    .option("--expires <seconds>", "Expiry in seconds from now", "0")
    .action(async (type, target, contentURI, opts) => {
      try {
        const ws = ensureWorkspace();
        const publicClient = createPublicClient(ws.config);
        const { client: walletClient } = await createWalletClient(ws.config, ws.path);
        const boardAddr = getContractAddress(ws.config, "directiveBoard");

        const typeNum = resolveType(type);
        const contentHash = keccak256(toBytes(contentURI));
        const expiresAt = opts.expires === "0" ? 0n : BigInt(Math.floor(Date.now() / 1000) + Number(opts.expires));

        const spin = ui.spinner("Posting directive...");
        const tx = await walletClient.writeContract({
          address: boardAddr,
          abi: DIRECTIVE_BOARD_ABI,
          functionName: "postDirective",
          args: [typeNum, target as Address, contentHash, contentURI, expiresAt],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
        spin.succeed(`Directive posted (tx: ${receipt.transactionHash})`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}

function resolveType(input: string): number {
  const num = Number(input);
  if (!isNaN(num) && num >= 0 && num <= 4) return num;

  const lower = input.toLowerCase();
  for (const [k, v] of Object.entries(DIRECTIVE_TYPE_NAMES)) {
    if (v.toLowerCase() === lower) return Number(k);
  }
  throw new Error(`Unknown directive type: ${input}. Use 0-4 or: ${Object.values(DIRECTIVE_TYPE_NAMES).join(", ")}`);
}
