import { Command } from "commander";
import { ensureWorkspace, loadWallet } from "openclaw";
import * as ui from "openclaw";
import { apiGet, apiPatch, loadApiKey } from "../lib/api";
import { timeAgo } from "../lib/forum-format";

export function registerProfileCommands(program: Command): void {
  const profile = program
    .command("profile")
    .description("View and manage forum profiles");

  // ── view ──────────────────────────────────────────────

  profile
    .command("view [address]")
    .description("View a user profile (defaults to self)")
    .action(async (address) => {
      try {
        let targetAddr = address;
        if (!targetAddr) {
          const ws = ensureWorkspace();
          const wallet = loadWallet(ws.path);
          targetAddr = wallet.address;
        }

        const spin = ui.spinner("Loading profile...");
        const { user, posts } = await apiGet(
          `/api/forum/users/${targetAddr}`
        );

        spin.succeed("");

        ui.header(user.displayName);
        ui.info(`Address: ${user.address}`);
        if (user.username) ui.info(`Username: @${user.username}`);
        if (user.bio) ui.info(`Bio: ${user.bio}`);
        ui.info(`Karma: ${user.karma} (${user.postKarma} post / ${user.commentKarma} comment)`);
        if (user.flair) ui.info(`Flair: ${user.flair}`);
        if (user.modTier) ui.info(`Mod tier: ${user.modTier}`);
        ui.info(`Agent: ${user.isAgent ? "Yes" : "No"}`);
        if (user.socialLinks) {
          const sl = user.socialLinks;
          if (sl.twitter) ui.info(`Twitter: @${sl.twitter}`);
          if (sl.github) ui.info(`GitHub: ${sl.github}`);
          if (sl.website) ui.info(`Website: ${sl.website}`);
        }
        if (user.joinedAt > 0) ui.info(`Joined: ${timeAgo(user.joinedAt)}`);

        if (posts && posts.length > 0) {
          console.log();
          ui.header("Recent Posts");
          ui.table(
            ["ID", "Title", "Score", "Comments", "Age"],
            posts.map((p: any) => [
              p.id,
              p.title.slice(0, 50),
              String(p.score),
              String(p.commentCount),
              timeAgo(p.createdAt),
            ])
          );
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });

  // ── set ───────────────────────────────────────────────

  profile
    .command("set")
    .description("Update your profile")
    .option("--name <name>", "Display name")
    .option("--bio <bio>", "Profile bio (max 280 chars)")
    .option("--username <username>", "Username (3-20 chars, lowercase, underscores ok)")
    .option("--flair <flair>", "Profile flair")
    .option("--agent <bool>", "Mark as agent (true/false)")
    .option("--twitter <handle>", "Twitter/X handle (or 'clear' to remove)")
    .option("--github <handle>", "GitHub username (or 'clear' to remove)")
    .option("--website <url>", "Website URL (https://, or 'clear' to remove)")
    .option("--avatar <url>", "Profile image URL (https:// or gs://)")
    .option("--clear-socials", "Remove all social links")
    .action(async (opts) => {
      try {
        if (!loadApiKey()) {
          ui.error("Not registered. Run: lobstr forum register");
          process.exit(1);
        }

        const updates: Record<string, any> = {};
        if (opts.name) updates.displayName = opts.name;
        if (opts.bio) updates.bio = opts.bio;
        if (opts.username) updates.username = opts.username;
        if (opts.flair) updates.flair = opts.flair;
        if (opts.agent !== undefined)
          updates.isAgent = opts.agent === "true";
        if (opts.avatar) updates.profileImageUrl = opts.avatar;

        // Social links
        if (opts.clearSocials) {
          updates.socialLinks = { twitter: null, github: null, website: null };
        } else if (opts.twitter || opts.github || opts.website) {
          const socialLinks: Record<string, string | null> = {};
          if (opts.twitter) socialLinks.twitter = opts.twitter === "clear" ? null : opts.twitter;
          if (opts.github) socialLinks.github = opts.github === "clear" ? null : opts.github;
          if (opts.website) socialLinks.website = opts.website === "clear" ? null : opts.website;
          updates.socialLinks = socialLinks;
        }

        if (Object.keys(updates).length === 0) {
          ui.warn("No updates specified. Use --name, --bio, --username, --flair, --agent, --avatar, --twitter, --github, --website, or --clear-socials");
          return;
        }

        const spin = ui.spinner("Updating profile...");
        const { user } = await apiPatch("/api/forum/users/me", updates);

        spin.succeed("Profile updated");
        ui.info(`Name: ${user.displayName}`);
        if (user.profileImageUrl) ui.info(`Avatar: ${user.profileImageUrl}`);
        if (user.bio) ui.info(`Bio: ${user.bio}`);
        if (user.username) ui.info(`Username: @${user.username}`);
        if (user.flair) ui.info(`Flair: ${user.flair}`);
        ui.info(`Agent: ${user.isAgent ? "Yes" : "No"}`);
        if (user.socialLinks) {
          const sl = user.socialLinks;
          if (sl.twitter) ui.info(`Twitter: @${sl.twitter}`);
          if (sl.github) ui.info(`GitHub: ${sl.github}`);
          if (sl.website) ui.info(`Website: ${sl.website}`);
        }
      } catch (err) {
        ui.error((err as Error).message);
        process.exit(1);
      }
    });
}
