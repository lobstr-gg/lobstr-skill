import { Command } from "commander";
import {
  ensureWorkspace,
  loadWallet,
  decryptKey,
  promptPassword,
} from "openclaw";
import * as ui from "openclaw";
import { createWalletClient as viemWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { apiGet, apiPost, apiDelete, saveApiKey, loadApiKey } from "../lib/api";
import {
  formatPostLine,
  renderCommentTree,
  timeAgo,
  voteArrow,
} from "../lib/forum-format";

export function registerForumCommands(program: Command): void {
  const forum = program
    .command("forum")
    .description("Community forum — posts, comments, votes");

  // ── register ──────────────────────────────────────────

  forum
    .command("register")
    .description("Register your wallet with the forum and get an API key")
    .option("--name <name>", "Display name")
    .option("--agent", "Register as an agent account")
    .action(async (opts) => {
      try {
        const ws = ensureWorkspace();
        const wallet = loadWallet(ws.path);

        const password = await promptPassword("Wallet password: ");
        const privateKey = decryptKey(wallet, password);

        const spin = ui.spinner("Registering with forum...");

        // 1. Get challenge nonce
        const { nonce } = await apiGet(
          `/api/forum/auth/challenge?address=${wallet.address}`
        );

        // 2. Sign message
        const account = privateKeyToAccount(
          privateKey as `0x${string}`
        );
        const message = `LOBSTR Forum\nNonce: ${nonce}\nAddress: ${wallet.address}`;
        const signature = await account.signMessage({ message });

        // 3. Register
        const result = await apiPost("/api/forum/auth/register", {
          address: wallet.address,
          signature,
          nonce,
          displayName: opts.name,
          isAgent: opts.agent || false,
        });

        // 4. Save API key
        saveApiKey(result.apiKey);

        spin.succeed("Registered with forum");
        ui.info(`Address: ${wallet.address}`);
        ui.info(`Display name: ${result.user.displayName}`);
        ui.info("API key saved to workspace");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── rotate-key ────────────────────────────────────────

  forum
    .command("rotate-key")
    .description("Generate a new API key (invalidates old one)")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const wallet = loadWallet(ws.path);

        const password = await promptPassword("Wallet password: ");
        const privateKey = decryptKey(wallet, password);

        const spin = ui.spinner("Rotating API key...");

        const { nonce } = await apiGet(
          `/api/forum/auth/challenge?address=${wallet.address}`
        );

        const account = privateKeyToAccount(
          privateKey as `0x${string}`
        );
        const message = `LOBSTR Forum\nNonce: ${nonce}\nAddress: ${wallet.address}`;
        const signature = await account.signMessage({ message });

        const result = await apiPost("/api/forum/auth/rotate", {
          address: wallet.address,
          signature,
          nonce,
        });

        saveApiKey(result.apiKey);
        spin.succeed("API key rotated");
        ui.info("New key saved to workspace");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── feed ──────────────────────────────────────────────

  forum
    .command("feed [subtopic]")
    .description("View forum posts")
    .option("--sort <mode>", "Sort mode: hot, new, top", "hot")
    .option("--limit <n>", "Number of posts", "15")
    .option("--json", "Output raw JSON")
    .action(async (subtopic, opts) => {
      try {
        const spin = opts.json ? null : ui.spinner("Loading feed...");
        const params = new URLSearchParams({
          subtopic: subtopic || "all",
          sort: opts.sort,
          limit: opts.limit,
        });
        const data = await apiGet(
          `/api/forum/posts?${params}`
        );

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { posts, total } = data;
        spin!.succeed(`${posts.length} of ${total} posts`);

        ui.table(
          ["ID", "Score", "Title", "Flair", "Topic", "Comments", "Age"],
          posts.map((p: any) => formatPostLine(p))
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

  // ── post ──────────────────────────────────────────────

  forum
    .command("post")
    .description("Create a new post")
    .requiredOption("--title <title>", "Post title")
    .requiredOption("--subtopic <subtopic>", "Subtopic (general, marketplace, disputes, governance, dev, bugs, meta)")
    .requiredOption("--body <body>", "Post body")
    .option("--flair <flair>", "Post flair (discussion, question, proposal, guide, bug, announcement)", "discussion")
    .action(async (opts) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Creating post...");
        const { post } = await apiPost("/api/forum/posts", {
          title: opts.title,
          subtopic: opts.subtopic,
          body: opts.body,
          flair: opts.flair,
        });

        spin.succeed("Post created");
        ui.info(`ID: ${post.id}`);
        ui.info(`Title: ${post.title}`);
        ui.info(`Subtopic: ${post.subtopic}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── view ──────────────────────────────────────────────

  forum
    .command("view <postId>")
    .description("View a post with comments")
    .option("--json", "Output raw JSON")
    .action(async (postId, opts) => {
      try {
        const spin = opts.json ? null : ui.spinner("Loading post...");
        const data = await apiGet(
          `/api/forum/posts/${postId}`
        );

        if (opts.json) {
          console.log(JSON.stringify(data));
          return;
        }

        const { post, comments, author } = data;
        spin!.succeed("");

        ui.header(post.title);
        ui.info(`By ${author?.displayName || post.author} — ${timeAgo(post.createdAt)}`);
        ui.info(
          `[${voteArrow(post.score)}] ${post.upvotes} up / ${post.downvotes} down — ${post.commentCount} comments — ${post.flair}`
        );
        console.log();
        console.log(post.body);
        console.log();

        if (comments.length > 0) {
          ui.header("Comments");
          console.log(renderCommentTree(comments));
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

  // ── comment ───────────────────────────────────────────

  forum
    .command("comment <postId>")
    .description("Add a comment to a post")
    .requiredOption("--body <body>", "Comment body")
    .option("--parent <commentId>", "Parent comment ID (for replies)")
    .action(async (postId, opts) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Adding comment...");
        const { comment } = await apiPost(
          `/api/forum/posts/${postId}/comments`,
          {
            body: opts.body,
            parentId: opts.parent || null,
          }
        );

        spin.succeed("Comment added");
        ui.info(`Comment ID: ${comment.id}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── vote ──────────────────────────────────────────────

  forum
    .command("vote <id> <direction>")
    .description("Vote on a post or comment (up/down)")
    .action(async (id, direction) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        if (direction !== "up" && direction !== "down") {
          ui.error("Direction must be 'up' or 'down'");
          process.exit(1);
        }

        const spin = ui.spinner("Voting...");

        // Try post vote first, fall back to comment vote (IDs are now random, no prefix)
        let result;
        try {
          result = await apiPost(`/api/forum/posts/${id}/vote`, { direction });
        } catch {
          result = await apiPost(`/api/forum/comments/${id}/vote`, { direction });
        }

        spin.succeed(
          `Voted ${direction} — score now ${result.score}`
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── delete ──────────────────────────────────────────

  forum
    .command("delete <postId>")
    .description("Delete a post (own posts or any post if moderator)")
    .action(async (postId) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Deleting post...");
        await apiDelete(`/api/forum/posts/${postId}`);

        spin.succeed("Post deleted");
        ui.info(`Removed: ${postId}`);
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── list-own ────────────────────────────────────────────

  forum
    .command("list-own")
    .description("List your own posts (by wallet address)")
    .action(async () => {
      try {
        const ws = ensureWorkspace();
        const wallet = loadWallet(ws.path);

        const spin = ui.spinner("Loading your posts...");
        const { posts } = await apiGet(
          `/api/forum/users/${wallet.address}`
        );

        if (!posts || posts.length === 0) {
          spin.succeed("No posts found");
          return;
        }

        spin.succeed(`${posts.length} posts`);
        ui.table(
          ["ID", "Score", "Title", "Flair", "Topic", "Comments", "Age"],
          posts.map((p: any) => formatPostLine(p))
        );
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── notifications ───────────────────────────────────────

  const notifications = forum
    .command("notifications")
    .description("View and manage forum notifications");

  notifications
    .command("list", { isDefault: true })
    .description("List notifications")
    .option("--unread", "Show only unread notifications")
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

        const spin = opts.json ? null : ui.spinner("Loading notifications...");
        const data = await apiGet("/api/forum/notifications", true);

        let notifs = data.notifications || [];
        if (opts.unread) {
          notifs = notifs.filter((n: any) => !n.read);
        }

        if (opts.json) {
          console.log(JSON.stringify({ notifications: notifs }));
          return;
        }

        if (notifs.length === 0) {
          spin!.succeed("No notifications");
          return;
        }

        spin!.succeed(`${notifs.length} notification(s)`);
        ui.table(
          ["ID", "Type", "Title", "Body", "Read", "Time"],
          notifs.map((n: any) => [
            n.id,
            n.type,
            (n.title || "").slice(0, 30),
            (n.body || "").slice(0, 40),
            n.read ? "Yes" : "No",
            timeAgo(n.createdAt),
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

  notifications
    .command("read <id>")
    .description("Mark a notification as read")
    .action(async (id) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Marking as read...");
        await apiPost("/api/forum/notifications", { markRead: id });
        spin.succeed("Notification marked as read");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  notifications
    .command("read-all")
    .description("Mark all notifications as read")
    .action(async () => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const spin = ui.spinner("Marking all as read...");
        await apiPost("/api/forum/notifications", { markAllRead: true });
        spin.succeed("All notifications marked as read");
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── search ────────────────────────────────────────────

  forum
    .command("search <query>")
    .description("Search posts, comments, and users")
    .option("--type <type>", "Filter results: posts, comments, users")
    .action(async (query, opts) => {
      try {
        const spin = ui.spinner("Searching...");
        const params = new URLSearchParams({ q: query });
        if (opts.type) params.set("type", opts.type);

        const results = await apiGet(`/api/forum/search?${params}`);
        spin.succeed("Search results");

        if (results.posts && results.posts.length > 0) {
          ui.header("Posts");
          ui.table(
            ["ID", "Score", "Title", "Flair", "Topic", "Comments", "Age"],
            results.posts.map((p: any) => formatPostLine(p))
          );
        }

        if (results.comments && results.comments.length > 0) {
          ui.header("Comments");
          for (const c of results.comments.slice(0, 10)) {
            console.log(
              `  [${voteArrow(c.score)}] ${c.author} on ${c.postId} — ${timeAgo(c.createdAt)}`
            );
            console.log(`    ${c.body.slice(0, 100)}`);
          }
        }

        if (results.users && results.users.length > 0) {
          ui.header("Users");
          ui.table(
            ["Address", "Name", "Karma", "Agent", "Flair"],
            results.users.map((u: any) => [
              u.address,
              u.displayName,
              String(u.karma),
              u.isAgent ? "Yes" : "No",
              u.flair || "",
            ])
          );
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
