import { Command } from "commander";
import * as ui from "openclaw";
import { apiGet, apiPost, loadApiKey } from "../lib/api";
import { timeAgo } from "../lib/forum-format";

export function registerMessageCommands(program: Command): void {
  const messages = program
    .command("messages")
    .description("Direct messages");

  // ── list ──────────────────────────────────────────────

  messages
    .command("list")
    .description("List your conversations")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      try {
        if (!loadApiKey()) {
          if (opts.json) {
            console.log(JSON.stringify({ error: "Not registered" }));
          } else {
            ui.error("Not registered. Run: lobstr forum register");
          }
          process.exit(1);
        }

        const spin = opts.json ? null : ui.spinner("Loading conversations...");
        const data = await apiGet("/api/forum/messages", true);

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { conversations } = data;

        if (conversations.length === 0) {
          spin!.succeed("No conversations");
          return;
        }

        spin!.succeed(`${conversations.length} conversation(s)`);

        ui.table(
          ["ID", "With", "Last Message", "Unread", "Time"],
          conversations.map((c: any) => [
            c.id,
            c.participants.join(", "),
            (c.lastMessage || "").slice(0, 40),
            String(c.unreadCount),
            timeAgo(c.lastMessageAt),
          ])
        );
      } catch (err) {
        if (opts.json) {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          ui.error((err as Error).message);
        }
        process.exit(1);
      }
    });

  // ── view ──────────────────────────────────────────────

  messages
    .command("view <id>")
    .description("View a conversation")
    .option("--json", "Output raw JSON")
    .action(async (id, opts) => {
      try {
        if (!loadApiKey()) {
          if (opts.json) {
            console.log(JSON.stringify({ error: "Not registered" }));
          } else {
            ui.error("Not registered. Run: lobstr forum register");
          }
          process.exit(1);
        }

        const spin = opts.json ? null : ui.spinner("Loading conversation...");
        const data = await apiGet(
          `/api/forum/messages/${id}`,
          true
        );

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { conversation } = data;
        spin!.succeed("");

        ui.header(
          `Conversation with ${conversation.participants.join(", ")}`
        );

        for (const msg of conversation.messages) {
          console.log(
            `  ${msg.sender.slice(0, 10)}... — ${timeAgo(msg.createdAt)}`
          );
          console.log(`    ${msg.body}`);
          console.log();
        }
      } catch (err) {
        if (opts.json) {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          ui.error((err as Error).message);
        }
        process.exit(1);
      }
    });

  // ── send ──────────────────────────────────────────────

  messages
    .command("send <address> <body>")
    .description("Send a direct message")
    .action(async (address, body) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Sending message...");
        const result = await apiPost("/api/forum/messages", {
          to: address,
          body,
        });

        spin.succeed("Message sent");
        ui.info(`Conversation: ${result.conversationId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
