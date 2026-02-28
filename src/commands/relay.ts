import { Command } from "commander";
import { apiGet, apiPost } from "../lib/api";
import { signRelayMessage, generateNonce } from "../lib/relay";
import * as ui from "openclaw";

export function registerRelayCommands(program: Command): void {
  const relay = program
    .command("relay")
    .description("Signed relay messaging commands");

  // ── send ──────────────────────────────────────────────

  relay
    .command("send <to> <type> <payload>")
    .description("Sign and send a relay message")
    .action(async (to, type, payload) => {
      try {
        const spin = ui.spinner("Signing message...");
        const nonce = generateNonce();
        const { signature } = await signRelayMessage(type, to, payload, nonce);

        spin.text = "Sending relay message...";
        const result = await apiPost("/api/relay/send", {
          type,
          to,
          payload,
          signature,
          nonce,
        });

        spin.succeed(`Message sent (${result.messageId})`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── inbox ─────────────────────────────────────────────

  relay
    .command("inbox")
    .description("Check relay inbox")
    .option("--type <type>", "Filter by message type")
    .option("--unread", "Only unread messages")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const params = new URLSearchParams();
        if (opts.type) params.set("type", opts.type);
        if (opts.unread) params.set("unread", "true");

        const spin = opts.json ? null : ui.spinner("Loading inbox...");
        const data = await apiGet(`/api/relay/inbox?${params.toString()}`, true);

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const messages = data.messages || [];
        if (messages.length === 0) {
          spin!.succeed("Inbox empty");
          return;
        }

        spin!.succeed(`${messages.length} message(s)`);
        ui.table(
          ["ID", "Type", "From", "Read", "Time"],
          messages.map((m: any) => [
            m.id,
            m.type,
            m.from.slice(0, 10) + "...",
            m.read ? "yes" : "NO",
            new Date(m.createdAt).toISOString().slice(0, 16),
          ])
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── read ──────────────────────────────────────────────

  relay
    .command("read <messageId>")
    .description("Mark a message as read")
    .action(async (messageId) => {
      try {
        const spin = ui.spinner("Marking as read...");
        await apiPost("/api/relay/inbox", { messageIds: [messageId] });
        spin.succeed(`Message ${messageId} marked as read`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── ack ───────────────────────────────────────────────

  relay
    .command("ack <messageId>")
    .description("Send ack for a received message")
    .action(async (messageId) => {
      try {
        const spin = ui.spinner("Sending ack...");
        const nonce = generateNonce();
        const payload = JSON.stringify({ ackFor: messageId });
        // Send to "broadcast" since we may not know the sender address easily
        // The refId links it back to the original message
        const { signature } = await signRelayMessage(
          "ack",
          "broadcast",
          payload,
          nonce
        );

        await apiPost("/api/relay/send", {
          type: "ack",
          to: "broadcast",
          payload,
          signature,
          nonce,
          refId: messageId,
        });

        // Also mark original as read
        await apiPost("/api/relay/inbox", { messageIds: [messageId] });

        spin.succeed(`Ack sent for ${messageId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── broadcast ─────────────────────────────────────────

  relay
    .command("broadcast <type> <payload>")
    .description("Send to all agents")
    .action(async (type, payload) => {
      try {
        const spin = ui.spinner("Signing broadcast...");
        const nonce = generateNonce();
        const { signature } = await signRelayMessage(
          type,
          "broadcast",
          payload,
          nonce
        );

        spin.text = "Sending broadcast...";
        const result = await apiPost("/api/relay/send", {
          type,
          to: "broadcast",
          payload,
          signature,
          nonce,
        });

        spin.succeed(`Broadcast sent (${result.messageId})`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
