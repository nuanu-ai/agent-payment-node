import { request as httpsRequest } from "node:https";
import type { ClientRequest } from "node:http";
import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";
import { ApnError, type ErrorCode } from "../errors.js";
import { rpcProviderFamily } from "../lifi/rpc-scheduler.js";
import { parsePublicHttpsUrl, resolvePublicAddresses, sameIpAddress, type PinnedAddress } from "../network-policy.js";

export interface GaslessTransport {
  request(endpoint: string, method: "POST" | "GET", body: string | null, maxBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", beforeSend?: () => void):
    Promise<{ readonly status: number; readonly body: string }>;
}

/** HTTP refusal is decided from the status line before untrusted headers or body are parsed. */
export function gaslessResponseDisposition(status: number, encoding: string | string[] | undefined,
  declared: string | string[] | undefined, maximumBytes: number): "terminal" | "reject" | "read" {
  if (status !== 200) return "terminal";
  if (encoding !== undefined && encoding !== "identity") return "reject";
  if (declared !== undefined && (typeof declared !== "string" ||
    !/^(?:0|[1-9][0-9]*)$/u.test(declared) || BigInt(declared) > BigInt(maximumBytes))) {
    return "reject";
  }
  return "read";
}

interface Deadline { readonly signal: AbortSignal; assert(): void }
interface Waiter { grant(): boolean }

/** One queue per provider family, shared by all gasless HTTPS clients in this process. */
export class GaslessPostPacer {
  private readonly families = new Map<string, { tail: Promise<void>; lastStart: number | null }>();
  constructor(private readonly now: () => number = Date.now,
    private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void> =
      async (milliseconds, signal) => { await pause(milliseconds, undefined, { signal }); }) {}

  async run<T>(endpoint: string, signal: AbortSignal, sendPost: () => Promise<T>): Promise<T> {
    const family = rpcProviderFamily(endpoint);
    const state = this.families.get(family) ?? { tail: Promise.resolve(), lastStart: null };
    this.families.set(family, state);
    const previous = state.tail;
    let release!: () => void;
    state.tail = new Promise<void>(resolve => { release = resolve; });
    try {
      await abortable(previous, signal);
      if (signal.aborted) throw signal.reason;
      if (state.lastStart !== null) {
        const next = state.lastStart + 750;
        while (this.now() < next) {
          await this.wait(next - this.now(), signal);
          if (signal.aborted) throw signal.reason;
        }
      }
      if (signal.aborted) throw signal.reason;
      state.lastStart = this.now();
      return await sendPost();
    } finally { release(); }
  }
}

const sharedPostPacer = new GaslessPostPacer();

/** Finite public HTTPS transport: DNS pinning, default TLS, no redirects and no retries. */
export class GaslessHttps implements GaslessTransport {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  constructor(private readonly pacer: GaslessPostPacer = sharedPostPacer) {}

  async request(endpointInput: string, method: "POST" | "GET", body: string | null, maximumBytes: number,
    code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", beforeSend?: () => void):
    Promise<{ readonly status: number; readonly body: string }> {
    const expires = performance.now() + 15_000;
    const endpoint = parsePublicHttpsUrl(endpointInput, code, "Gasless endpoint", 2048);
    if (body !== null && Buffer.byteLength(body, "utf8") > 256 * 1024) throw failure(code, "request_size");
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) {
      throw failure(code, "response_bound");
    }
    const controller = new AbortController(), expired = failure(code, "request_deadline");
    const deadline: Deadline = { signal: controller.signal, assert() {
      if (performance.now() >= expires) controller.abort(expired);
      if (controller.signal.aborted) throw expired;
    } };
    deadline.assert();
    const timer = setTimeout(() => controller.abort(expired), Math.max(1, expires - performance.now()));
    let release: (() => void) | undefined;
    try {
      release = await this.acquire(deadline, code);
      deadline.assert();
      const addresses = await abortable(resolvePublicAddresses(endpoint, code, "Gasless endpoint"), deadline.signal);
      deadline.assert();
      if (method === "POST") return await this.pacer.run(endpoint.origin, deadline.signal, async () => {
        deadline.assert();
        beforeSend?.();
        return await send(endpoint, method, body, addresses, maximumBytes, deadline, code);
      });
      beforeSend?.();
      return await send(endpoint, method, body, addresses, maximumBytes, deadline, code);
    } finally {
      clearTimeout(timer);
      release?.();
    }
  }
  private async acquire(deadline: Deadline, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"): Promise<() => void> {
    deadline.assert();
    if (this.active < 2) { this.active += 1; return this.releaser(); }
    if (this.waiting.length >= 32) throw failure(code, "concurrency_bound");
    return await new Promise<() => void>((resolve, reject) => {
      const cancel = () => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) this.waiting.splice(index, 1);
        deadline.signal.removeEventListener("abort", cancel);
        reject(deadline.signal.reason);
      };
      const waiter: Waiter = { grant: () => {
        deadline.signal.removeEventListener("abort", cancel);
        try { deadline.assert(); } catch (error) { reject(error); return false; }
        this.active += 1; resolve(this.releaser()); return true;
      } };
      this.waiting.push(waiter); deadline.signal.addEventListener("abort", cancel, { once: true });
      if (deadline.signal.aborted) cancel();
    });
  }
  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true; this.active -= 1;
      while (this.active < 2 && this.waiting.length !== 0) this.waiting.shift()!.grant();
    };
  }
}

/** DNS lookup itself may finish later, but its abandoned result can never start an HTTP request. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

function failure(code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG", reason: string): ApnError {
  const publicCode: ErrorCode = code === "APN_RPC_CONFIG" ? "APN_RPC_AMBIGUOUS" : "APN_PROVIDER_UNAVAILABLE";
  return new ApnError(publicCode, `Gasless transport failed: ${reason}.`);
}

function send(endpoint: URL, method: "POST" | "GET", body: string | null, addresses: readonly PinnedAddress[],
  maximumBytes: number, deadline: Deadline, code: "APN_RPC_CONFIG" | "APN_HTTP_CONFIG"):
  Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    deadline.assert();
    const selected = addresses[0];
    if (selected === undefined) { reject(failure(code, "DNS_empty")); return; }
    let settled = false, request: ClientRequest | undefined;
    const abort = () => finish(deadline.signal.reason);
    const finish = (error: unknown, value?: { readonly status: number; readonly body: string }) => {
      if (settled) return;
      settled = true; deadline.signal.removeEventListener("abort", abort);
      if (error !== null) {
        request?.destroy(); reject(error instanceof ApnError ? error : failure(code, "request_interrupted"));
      }
      else resolve(value!);
    };
    const live = (): boolean => {
      if (settled) return false;
      try { deadline.assert(); return true; } catch (error) { finish(error); return false; }
    };
    deadline.signal.addEventListener("abort", abort, { once: true });
    try {
    request = httpsRequest(endpoint, {
      method, agent: false, family: selected.family,
      headers: {
        accept: "application/json", "accept-encoding": "identity",
        ...(body === null ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body).toString() }),
      },
      lookup: (_host, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      if (!live()) { response.destroy(); return; }
      const status = response.statusCode ?? 0;
      const declared = response.headers["content-length"];
      const disposition = gaslessResponseDisposition(status, response.headers["content-encoding"], declared, maximumBytes);
      if (disposition === "terminal") { finish(null, { status, body: "" }); response.destroy(); return; }
      if (disposition === "reject") { finish(failure(code, "redirect_or_encoding_or_size")); return; }
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        if (!live()) return;
        size += chunk.length;
        if (size > maximumBytes) { finish(failure(code, "response_size")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        if (!live()) return;
        try {
          if (declared !== undefined && BigInt(declared) !== BigInt(size)) { finish(failure(code, "response_length")); return; }
          finish(null, { status, body: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)) });
        } catch { finish(failure(code, "response_utf8")); }
      });
      response.on("aborted", () => finish(failure(code, "response_aborted")));
      response.on("error", () => finish(failure(code, "response_interrupted")));
    });
    request.on("socket", (socket) => socket.on("connect", () => {
      if (!live()) return;
      if (socket.remoteAddress === undefined || !sameIpAddress(socket.remoteAddress, selected.address)) {
        finish(failure(code, "pinned_address_changed"));
      }
    }));
    request.on("error", () => finish(failure(code, "request_interrupted")));
    if (live()) request.end(body ?? undefined);
    } catch (error) { finish(error); }
  });
}
