import { request as httpsRequest } from "node:https";
import { ApnError, type ErrorCode } from "../errors.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress, type PinnedAddress } from "../network-policy.js";
import type { LifiResponse } from "./ports.js";

/** Shared finite transport: public DNS pin, default TLS, no redirect or implicit retry. */
export class BridgeHttps {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly resolveAddresses: typeof resolvePublicAddresses = resolvePublicAddresses) {}
  async request(endpointInput: string, method: "GET" | "POST", body: string | null, maximumBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<LifiResponse> {
    const endpoint = parsePublicHttpsUrl(endpointInput, code, "Bridge endpoint", 2048);
    if (body !== null && Buffer.byteLength(body, "utf8") > 256 * 1024) throw failure(code, "request_size");
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) throw failure(code, "response_bound");
    if (this.active >= 2) {
      if (this.waiting.length >= 32) throw failure(code, "concurrency_bound");
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active += 1;
    const deadline = Date.now() + 15_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([
        this.resolveAddresses(endpoint, code, "Bridge endpoint"),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(failure(code, "DNS_deadline")), 15_000); }),
      ]);
      clearTimeout(timeout); timeout = undefined;
      const remaining = deadline - Date.now();
      if (remaining < 1) throw failure(code, "request_deadline");
      return await send(endpoint, method, body, addresses, maximumBytes, remaining, code);
    } finally {
      clearTimeout(timeout);
      const release = this.waiting.shift();
      if (release === undefined) this.active -= 1;
      else release();
    }
  }
}
function failure(code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", reason: string): ApnError {
  const error: ErrorCode = code === "APN_RPC_CONFIG" ? "APN_RPC_AMBIGUOUS" : "APN_PROVIDER_UNAVAILABLE";
  return new ApnError(error, `Bridge transport failed: ${reason}.`);
}
function send(endpoint: URL, method: "GET" | "POST", body: string | null, addresses: readonly PinnedAddress[],
  maximumBytes: number, remaining: number, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<LifiResponse> {
  return new Promise((resolve, reject) => {
    const selected = addresses[0];
    if (selected === undefined) { reject(failure(code, "DNS_empty")); return; }
    let settled = false;
    const finish = (error: unknown, value?: LifiResponse) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error !== null) reject(error instanceof ApnError ? error : failure(code, "request_interrupted"));
      else resolve(value!);
    };
    const request = httpsRequest(endpoint, { method, agent: false, family: selected.family,
      headers: { accept: "application/json", "accept-encoding": "identity", ...(body === null ? {} : {
        "content-type": "application/json", "content-length": Buffer.byteLength(body).toString(),
      }) }, lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      const status = response.statusCode ?? 0, encoding = response.headers["content-encoding"];
      if ((status >= 300 && status < 400) || (encoding !== undefined && encoding !== "identity")) {
        response.destroy(); finish(failure(code, "redirect_or_encoding")); return;
      }
      const declared = response.headers["content-length"];
      if (declared !== undefined && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || BigInt(declared) > BigInt(maximumBytes))) {
        response.destroy(); finish(failure(code, "response_size")); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximumBytes) { response.destroy(); finish(failure(code, "response_size")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { finish(null, { status, body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)) }); }
        catch { finish(failure(code, "response_utf8")); }
      });
      response.on("aborted", () => finish(failure(code, "response_aborted")));
      response.on("error", () => finish(failure(code, "response_interrupted")));
    });
    const timer = setTimeout(() => { request.destroy(); finish(failure(code, "request_deadline")); }, remaining);
    request.on("socket", (socket) => socket.on("connect", () => {
      if (socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
        request.destroy(); finish(failure(code, "pinned_address_changed"));
      }
    }));
    request.on("error", () => finish(failure(code, "request_interrupted")));
    request.end(body ?? undefined);
  });
}
