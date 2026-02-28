import {
  ensureWorkspace,
  createWalletClient,
} from "openclaw";
import { randomUUID } from "crypto";

export function buildRelayPayload(
  type: string,
  to: string,
  payload: string,
  nonce: string
): string {
  return `LOBSTR Relay\nType: ${type}\nTo: ${to}\nPayload: ${payload}\nNonce: ${nonce}`;
}

export async function signRelayMessage(
  type: string,
  to: string,
  payload: string,
  nonce: string
): Promise<{ signature: string; address: string }> {
  const ws = ensureWorkspace();
  const { client: walletClient, address } = await createWalletClient(
    ws.config,
    ws.path
  );

  const message = buildRelayPayload(type, to, payload, nonce);
  const signature = await walletClient.signMessage({ message });

  return { signature, address };
}

export function generateNonce(): string {
  return randomUUID();
}
