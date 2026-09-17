import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { tronAddress } from "../../tron/codec.js";
import { createSwapQuote, type SwapQuoteSnapshot, type SwapSimulationProof } from "../quote.js";
import { SUNSWAP_NATIVE_TRX, SUNSWAP_QUOTE_URL, SUNSWAP_USDT, loadSunSwapPinCatalog } from "./catalog.js";

export interface SunSwapQuoteRoute {
  readonly inputAmountAtomic: string;
  readonly roadForAddr: readonly string[];
  readonly roadForName: readonly string[];
  readonly pool: readonly string[];
  readonly amount: string;
  readonly amountOutAtomic: string;
  readonly inUsd: string;
  readonly outUsd: string;
  readonly impact: string;
  readonly fee: string;
  readonly routeHash: string;
}

export interface SunSwapQuoteRequest { readonly inputAmountAtomic: string }
export interface SunSwapQuoteSnapshotInput {
  readonly profile: string; readonly account: string; readonly recipient: string; readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string; readonly slippageBps: number; readonly effectiveAt: string; readonly expiresAt: string;
  readonly providerResponseHash: string; readonly unsignedTransactionPayloadHash: string; readonly route: SunSwapQuoteRoute;
  readonly simulation: SwapSimulationProof;
}

export function sunSwapQuoteUrl(input: SunSwapQuoteRequest): URL {
  loadSunSwapPinCatalog();
  if (!isPlainRecord(input) || !exactKeys(input, ["inputAmountAtomic"])) failInput();
  const amount = positiveAtomic(input.inputAmountAtomic);
  const url = new URL(SUNSWAP_QUOTE_URL);
  url.searchParams.set("fromTokenAddr", SUNSWAP_NATIVE_TRX);
  url.searchParams.set("toTokenAddr", SUNSWAP_USDT);
  url.searchParams.set("inAmount", amount);
  url.searchParams.set("fromToken", "TRX");
  url.searchParams.set("toToken", "USDT");
  url.searchParams.set("fromDecimal", "6");
  url.searchParams.set("toDecimal", "6");
  return url;
}

export function decodeSunSwapQuote(value: unknown, inputAmountAtomic: string): readonly SunSwapQuoteRoute[] {
  const inputAmount = positiveAtomic(inputAmountAtomic);
  if (!isPlainRecord(value) || !exactKeys(value, ["code", "message", "data"]) || value.code !== 0 || value.message !== "SUCCESS" ||
      !Array.isArray(value.data) || value.data.length < 1 || value.data.length > 3) fail();
  if (!dense(value.data)) fail();
  return value.data.map((raw) => {
    if (!isPlainRecord(raw)) fail();
    const keys = ["amount", "fee", "impact", "inUsd", "outUsd", "pool", "roadForAddr", "roadForName"];
    if (!exactKeys(raw, keys)) fail();
    if (!Array.isArray(raw.roadForAddr) || !Array.isArray(raw.roadForName) || !Array.isArray(raw.pool) || raw.roadForAddr.length < 2 ||
        raw.roadForAddr.length > 8 || raw.roadForName.length !== raw.roadForAddr.length || raw.pool.length + 1 !== raw.roadForAddr.length ||
        !dense(raw.roadForAddr) || !dense(raw.roadForName) || !dense(raw.pool) ||
        raw.roadForAddr.some((item) => typeof item !== "string" || !canonicalTronAddress(item)) ||
        raw.roadForName.some((item) => typeof item !== "string" || item.length < 1 || item.length > 32) ||
        raw.pool.some((item) => typeof item !== "string" || !/^[A-Za-z0-9._-]{1,32}$/u.test(item))) fail();
    const path = raw.roadForAddr as string[];
    if (path[0] !== SUNSWAP_NATIVE_TRX || path.at(-1) !== SUNSWAP_USDT) fail();
    for (const key of ["amount", "inUsd", "outUsd", "fee"] as const) if (typeof raw[key] !== "string" || !decimal(raw[key], false)) fail();
    if (typeof raw.impact !== "string" || !decimal(raw.impact, true)) fail();
    const amountOutAtomic = decimalToAtomic(raw.amount as string, 6);
    const body = { inputAmountAtomic: inputAmount, roadForAddr: path, roadForName: raw.roadForName as string[], pool: raw.pool as string[], amount: raw.amount as string,
      amountOutAtomic, inUsd: raw.inUsd as string, outUsd: raw.outUsd as string, impact: raw.impact as string, fee: raw.fee as string };
    return { ...body, routeHash: domainHash("apn.sunswap-tron-route.v1", canonicalJson(body)) };
  });
}

export function validateSunSwapQuoteRoute(value: unknown): SunSwapQuoteRoute {
  if (!isPlainRecord(value) || !exactKeys(value, ["inputAmountAtomic", "amount", "amountOutAtomic", "fee", "impact", "inUsd", "outUsd",
    "pool", "roadForAddr", "roadForName", "routeHash"]) || typeof value.routeHash !== "string") fail();
  const decoded = decodeSunSwapQuote({ code: 0, message: "SUCCESS", data: [{ roadForAddr: value.roadForAddr, roadForName: value.roadForName,
    pool: value.pool, amount: value.amount, inUsd: value.inUsd, outUsd: value.outUsd, impact: value.impact, fee: value.fee }] },
    value.inputAmountAtomic as string)[0]!;
  if (decoded.amountOutAtomic !== value.amountOutAtomic || decoded.routeHash !== value.routeHash) fail();
  return value as unknown as SunSwapQuoteRoute;
}

export function assertSunSwapDirectRoute(value: unknown, minimumOutputAtomic: string): SunSwapQuoteRoute {
  const route = validateSunSwapQuoteRoute(value);
  if (route.roadForAddr.length !== 2 || route.pool.length !== 1 || route.pool[0] !== "v2" ||
      !/^[1-9][0-9]{0,77}$/u.test(minimumOutputAtomic) || BigInt(minimumOutputAtomic) > MAX_UINT256 ||
      BigInt(route.amountOutAtomic) < BigInt(minimumOutputAtomic)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The quote route cannot be represented by the admitted direct native-input command.");
  }
  return route;
}

export function createSunSwapQuoteSnapshot(input: SunSwapQuoteSnapshotInput): SwapQuoteSnapshot {
  if (!isPlainRecord(input) || !exactKeys(input, ["profile", "account", "recipient", "inputAmountAtomic", "minimumOutputAtomic", "slippageBps",
    "effectiveAt", "expiresAt", "providerResponseHash", "unsignedTransactionPayloadHash", "route", "simulation"]) ||
      !isPlainRecord(input.simulation) || !exactKeys(input.simulation, ["requestHash", "resultHash", "success", "blockNumber", "blockHash",
        "headBlockNumber", "maxHeadDrift", "gasEstimate"])) failInput();
  const route = assertSunSwapDirectRoute(input.route, input.minimumOutputAtomic);
  if (route.inputAmountAtomic !== input.inputAmountAtomic) throw new ApnError("APN_OPERATION_BLOCKED", "The quote route input amount does not match the frozen swap input.");
  return createSwapQuote({ profile: input.profile, account: input.account, recipient: input.recipient,
    sourceAsset: { chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", kind: "native", identifier: null },
    destinationAsset: { chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", kind: "token", identifier: SUNSWAP_USDT },
    inputAmountAtomic: input.inputAmountAtomic, expectedOutputAtomic: route.amountOutAtomic, minimumOutputAtomic: input.minimumOutputAtomic,
    slippageBps: input.slippageBps, effectiveAt: input.effectiveAt, expiresAt: input.expiresAt,
    providerResponseHash: input.providerResponseHash, routeHash: route.routeHash,
    unsignedTransactionPayloadHash: input.unsignedTransactionPayloadHash,
    simulation: input.simulation });
}

export class SunSwapQuoteAdapter {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async quote(input: SunSwapQuoteRequest): Promise<readonly SunSwapQuoteRoute[]> {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8_000); timeout.unref();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(sunSwapQuoteUrl(input), { method: "GET", headers: { accept: "application/json" },
        redirect: "error", credentials: "omit", signal: controller.signal });
      if (!response.ok || response.body === null || !(response.headers.get("content-type") ?? "").includes("application/json")) fail();
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 262_144) fail(); chunks.push(next.value); }
      return decodeSunSwapQuote(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))), input.inputAmountAtomic);
    } catch (error) { if (error instanceof ApnError) throw error; return fail(); }
    finally { clearTimeout(timeout); await reader?.cancel().catch(() => {}); }
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;
function positiveAtomic(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/u.test(value) || BigInt(value) > MAX_UINT256) failInput(); return value;
}
function dense(value: readonly unknown[]): boolean {
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}
function canonicalTronAddress(value: string): boolean { try { return tronAddress(value) === value; } catch { return false; } }
function decimal(value: string, signed: boolean): boolean {
  if (value.length > 96 || !(signed ? /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u : /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u).test(value)) return false;
  return value !== "-0";
}
function decimalToAtomic(value: string, decimals: number): string {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/u.exec(value); if (match === null || (match[2]?.length ?? 0) > decimals) fail();
  const result = BigInt(`${match[1]}${(match[2] ?? "").padEnd(decimals, "0")}`);
  if (result <= 0n || result > MAX_UINT256) fail(); return result.toString();
}
function failInput(): never { throw new ApnError("APN_INVALID_INPUT", "SunSwap quote input must be a positive canonical atomic amount."); }
function fail(): never { throw new ApnError("APN_PROVIDER_PROTOCOL", "SunSwap returned an untrusted or unsupported quote shape."); }
