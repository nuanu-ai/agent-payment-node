import { setTimeout as wait } from "node:timers/promises";
import { ApnError } from "../errors.js";
import { UNISWAP_API, UNISWAP_ROUTER_VERSION } from "./uniswap-pin.js";

export interface UniswapHttpTransportResponse { readonly status: number; readonly body: string }
export interface UniswapHttpTransport { post(url: string, headers: Readonly<Record<string, string>>, body: string,
  timeoutMs: number): Promise<UniswapHttpTransportResponse> }
export class FetchUniswapHttpTransport implements UniswapHttpTransport {
  async post(url: string, headers: Readonly<Record<string, string>>, body: string, timeoutMs: number): Promise<UniswapHttpTransportResponse> {
    const response = await fetch(url, { method: "POST", redirect: "error", headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await response.text() };
  }
}
export class UniswapTradingApi {
  constructor(private readonly apiKey: string, private readonly transport: UniswapHttpTransport = new FetchUniswapHttpTransport(),
    private readonly timeoutMs = 8_000, private readonly retries = 1) {
    if (!/^[\x21-\x7e]{8,512}$/u.test(apiKey) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000 ||
        !Number.isSafeInteger(retries) || retries < 0 || retries > 2) throw new ApnError("APN_HTTP_CONFIG", "Uniswap HTTP configuration is invalid.");
  }
  quote(body: unknown): Promise<unknown> { return this.safeUnsignedRead("/quote", body); }
  swap(body: unknown): Promise<unknown> { return this.safeUnsignedRead("/swap", body); }
  checkApproval(): never {
    throw new ApnError("APN_OPERATION_BLOCKED", "Native ETH input has no token or Permit2 approval operation.", { reason: "uniswap_native_no_approval" });
  }
  private async safeUnsignedRead(path: "/quote" | "/swap", input: unknown): Promise<unknown> {
    const body = JSON.stringify(input); if (Buffer.byteLength(body) > 262_144) protocol("request size");
    for (let attempt = 0; ; attempt++) {
      let result: UniswapHttpTransportResponse;
      try { result = await this.transport.post(`${UNISWAP_API}${path}`, { "content-type": "application/json", "x-api-key": this.apiKey,
        "x-universal-router-version": UNISWAP_ROUTER_VERSION, "x-erc20eth-enabled": "false", "x-permit2-disabled": "false" }, body, this.timeoutMs); }
      catch (error) { if (attempt < this.retries) { await wait(50 * (attempt + 1)); continue; }
        throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Uniswap Trading API request failed before any chain effect.", { reason: "uniswap_transport" }); }
      if ([429, 500, 502, 503, 504].includes(result.status) && attempt < this.retries) { await wait(50 * (attempt + 1)); continue; }
      if (result.status !== 200) throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Uniswap Trading API returned a non-success status.",
        { reason: "uniswap_http_status", status: String(result.status) });
      if (Buffer.byteLength(result.body) > 524_288) protocol("response size");
      try { return JSON.parse(result.body) as unknown; } catch { return protocol("response JSON"); }
    }
  }
}
function protocol(part: string): never { throw new ApnError("APN_PROVIDER_PROTOCOL", `Uniswap ${part} is invalid.`); }
