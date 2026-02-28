import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const OPENCLAW_DIR = ".openclaw";

function getApiUrl(): string {
  return process.env.LOBSTR_API_URL || "http://localhost:3000";
}

function getActiveWorkspace(): string | null {
  const activePath = path.join(os.homedir(), OPENCLAW_DIR, ".active");
  if (!fs.existsSync(activePath)) return null;
  return fs.readFileSync(activePath, "utf-8").trim();
}

function getKeyPath(): string | null {
  const ws = getActiveWorkspace();
  if (!ws) return null;
  return path.join(os.homedir(), OPENCLAW_DIR, ws, "forum-key.json");
}

export function loadApiKey(): string | null {
  const keyPath = getKeyPath();
  if (!keyPath || !fs.existsSync(keyPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    return data.apiKey || null;
  } catch {
    return null;
  }
}

export function saveApiKey(apiKey: string): void {
  const keyPath = getKeyPath();
  if (!keyPath) throw new Error("No active workspace");
  fs.writeFileSync(keyPath, JSON.stringify({ apiKey }, null, 2));
}

async function request(
  method: string,
  urlPath: string,
  body?: unknown,
  auth?: boolean
): Promise<any> {
  const url = `${getApiUrl()}${urlPath}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth !== false) {
    const key = loadApiKey();
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return json;
}

export function apiGet(urlPath: string, auth = false): Promise<any> {
  return request("GET", urlPath, undefined, auth);
}

export function apiPost(urlPath: string, body: unknown): Promise<any> {
  return request("POST", urlPath, body, true);
}

export function apiPatch(urlPath: string, body: unknown): Promise<any> {
  return request("PATCH", urlPath, body, true);
}

export function apiDelete(urlPath: string): Promise<any> {
  return request("DELETE", urlPath, undefined, true);
}
