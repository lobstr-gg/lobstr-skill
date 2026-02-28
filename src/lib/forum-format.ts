export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function voteArrow(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `${score}`;
  return "0";
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

export function formatPostLine(post: {
  id: string;
  title: string;
  score: number;
  commentCount: number;
  author: string;
  flair: string;
  subtopic: string;
  createdAt: number;
  isPinned?: boolean;
}): string[] {
  const pin = post.isPinned ? "[PIN] " : "";
  return [
    post.id,
    `[${voteArrow(post.score)}]`,
    `${pin}${truncate(post.title, 50)}`,
    post.flair,
    post.subtopic,
    `${post.commentCount} comments`,
    timeAgo(post.createdAt),
  ];
}

export function renderCommentTree(
  comments: any[],
  indent = 0
): string {
  let output = "";
  for (const c of comments) {
    const prefix = "  ".repeat(indent);
    const arrow = voteArrow(c.score);
    output += `${prefix}[${arrow}] ${c.author} — ${timeAgo(c.createdAt)}\n`;
    output += `${prefix}  ${c.body}\n\n`;
    if (c.children && c.children.length > 0) {
      output += renderCommentTree(c.children, indent + 1);
    }
  }
  return output;
}
