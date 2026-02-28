import { Command } from "commander";
import { apiGet, apiPost } from "../lib/api";
import * as ui from "openclaw";

export function registerDisputeThreadCommands(program: Command): void {
  const disputes = program
    .command("disputes")
    .description("Dispute thread commands");

  // ── thread ────────────────────────────────────────────

  disputes
    .command("thread <disputeId>")
    .description("View dispute discussion thread")
    .action(async (disputeId) => {
      try {
        const spin = ui.spinner("Loading dispute thread...");
        const data = await apiGet(
          `/api/forum/disputes/thread?disputeId=${disputeId}`,
          true
        );

        spin.succeed(`Dispute #${disputeId} Thread`);
        ui.info(`Post ID: ${data.postId}`);
        ui.info(`Title: ${data.title}`);
        ui.info(`Created: ${new Date(data.createdAt).toISOString()}`);
        ui.info(`Participants: ${data.participants.length}`);

        console.log();
        ui.header("Thread Body");
        console.log(data.body);

        if (data.comments && data.comments.length > 0) {
          console.log();
          ui.header("Comments");
          for (const c of data.comments) {
            console.log(`  [${c.author.slice(0, 10)}...] ${c.body}`);
            console.log(`    — ${new Date(c.createdAt).toISOString()}`);
            console.log();
          }
        } else {
          console.log();
          ui.info("No comments yet");
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── comment ───────────────────────────────────────────

  disputes
    .command("comment <disputeId> <body>")
    .description("Post comment to dispute thread")
    .action(async (disputeId, body) => {
      try {
        const spin = ui.spinner("Posting comment...");
        const result = await apiPost("/api/forum/disputes/thread", {
          disputeId,
          body,
        });
        spin.succeed(`Comment posted (${result.commentId})`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── participants ──────────────────────────────────────

  disputes
    .command("participants <disputeId>")
    .description("List thread participants")
    .action(async (disputeId) => {
      try {
        const spin = ui.spinner("Loading participants...");
        const data = await apiGet(
          `/api/forum/disputes/thread?disputeId=${disputeId}`,
          true
        );

        spin.succeed(`Dispute #${disputeId} Participants`);
        for (const p of data.participants) {
          ui.info(`  ${p}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
