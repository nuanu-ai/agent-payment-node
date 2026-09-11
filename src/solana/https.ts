import { request } from "node:https";
import { rootCertificates } from "node:tls";
import { ApnError } from "../errors.js";
import { resolvePublicAddresses, type PinnedAddress } from "../network-policy.js";

/** Production transport pins one validated public address and built-in TLS roots. */
export const solanaHttpsFetch: typeof fetch = async (input, init) => {
  if (!(input instanceof URL) || typeof init?.body !== "string" || init.signal === undefined || init.signal === null) invalid();
  const endpoint = input; const signal = init.signal; const body = init.body;
  const addresses = await resolveBounded(endpoint, signal);
  const selected = addresses[0]; if (selected === undefined || signal.aborted) invalid();
  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finish = (response?: Response): void => {
      if (settled) return; settled = true; signal.removeEventListener("abort", abort);
      if (response === undefined) reject(new ApnError("APN_RPC_PROTOCOL", "The bounded Solana HTTPS transport did not return valid evidence."));
      else resolve(response);
    };
    const outgoing = request(endpoint, { method: "POST", family: selected.family, ca: [...rootCertificates],
      headers: { "content-type": "application/json", accept: "application/json", "content-length": Buffer.byteLength(body).toString() },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (incoming) => {
      const contentType = incoming.headers["content-type"] ?? "";
      const declared = Number(incoming.headers["content-length"] ?? "0");
      if (incoming.statusCode !== 200 || !contentType.includes("application/json") || !Number.isSafeInteger(declared) || declared < 0 || declared > 2_097_152) {
        incoming.destroy(); finish(); return;
      }
      const chunks: Buffer[] = []; let total = 0;
      incoming.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 2_097_152) { incoming.destroy(); finish(); return; }
        chunks.push(chunk);
      });
      incoming.on("end", () => finish(new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "content-type": contentType }, status: 200 })));
      incoming.on("error", () => finish()); incoming.on("aborted", () => finish());
    });
    const abort = (): void => { outgoing.destroy(); finish(); };
    signal.addEventListener("abort", abort, { once: true });
    outgoing.on("error", () => finish());
    if (signal.aborted) abort(); else outgoing.end(body);
  });
};
async function resolveBounded(endpoint: URL, signal: AbortSignal): Promise<readonly PinnedAddress[]> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([resolvePublicAddresses(endpoint, "APN_RPC_CONFIG", "Solana RPC endpoint"), new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ApnError("APN_RPC_PROTOCOL", "Solana RPC address validation exceeded its deadline."));
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    })]);
  } finally { if (abort !== undefined) signal.removeEventListener("abort", abort); }
}
function invalid(): never { throw new ApnError("APN_RPC_CONFIG", "The bounded Solana HTTPS request is invalid."); }
