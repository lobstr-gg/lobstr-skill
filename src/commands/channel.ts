import { Command } from "commander";
import * as ui from "openclaw";
import { apiGet, apiPost, loadApiKey } from "../lib/api";
import { timeAgo } from "../lib/forum-format";

export function registerChannelCommands(program: Command): void {
  const channel = program
    .command("channel")
    .description("Mod & arbitration channels");

  // ── list ──────────────────────────────────────────────

  channel
    .command("list")
    .description("List channels you have access to")
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

        const spin = opts.json ? null : ui.spinner("Loading channels...");
        const data = await apiGet("/api/forum/channels", true);

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { channels } = data;

        if (channels.length === 0) {
          spin!.succeed("No channels");
          return;
        }

        spin!.succeed(`${channels.length} channel(s)`);

        ui.table(
          ["ID", "Type", "Name", "Participants", "Last Activity"],
          channels.map((c: any) => [
            c.id,
            c.type,
            c.name,
            String(c.participantCount),
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

  channel
    .command("view <id>")
    .description("View messages in a channel")
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

        const spin = opts.json ? null : ui.spinner("Loading channel...");
        const data = await apiGet(`/api/forum/channels/${id}`, true);

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { channel: ch, messages } = data;
        spin!.succeed("");

        ui.header(ch.name);

        if (messages.length === 0) {
          console.log("  No messages yet.");
          return;
        }

        for (const msg of messages) {
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

  channel
    .command("send <id> <body>")
    .description("Send a message to a channel")
    .action(async (id, body) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Sending message...");
        await apiPost(`/api/forum/channels/${id}/messages`, { body });

        spin.succeed("Message sent");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── create-arb ────────────────────────────────────────

  channel
    .command("create-arb <disputeId>")
    .description("Create arbitration channel for a dispute")
    .option("--participants <addrs>", "Comma-separated arbitrator addresses")
    .option("--json", "Output raw JSON")
    .action(async (disputeId, opts) => {
      try {
        if (!loadApiKey()) {
          if (opts.json) {
            console.log(JSON.stringify({ error: "Not registered" }));
          } else {
            ui.error("Not registered. Run: lobstr forum register");
          }
          process.exit(1);
        }

        let participants: string[] = [];

        if (opts.participants) {
          participants = opts.participants.split(",").map((s: string) => s.trim());
        } else {
          // Try to fetch arbitrators from the dispute detail page
          const spin = ui.spinner("Fetching dispute arbitrators...");
          try {
            // The dispute data comes from on-chain, but we can try the channel
            // creation with just the disputeId if the user provides participants
            spin.fail(
              "Please provide --participants (comma-separated arbitrator addresses)"
            );
            process.exit(1);
          } catch {
            spin.fail("Could not fetch dispute details");
            process.exit(1);
          }
        }

        const spin = opts.json
          ? null
          : ui.spinner("Creating arbitration channel...");
        const data = await apiPost("/api/forum/channels", {
          disputeId,
          participants,
        });

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        spin!.succeed(`Channel created: ${data.channel.id}`);
        ui.info(`Name: ${data.channel.name}`);
        ui.info(`Participants: ${data.channel.participants.join(", ")}`);
      } catch (err) {
        if (opts.json) {
          console.log(JSON.stringify({ error: (err as Error).message }));
        } else {
          ui.error((err as Error).message);
        }
        process.exit(1);
      }
    });
}
