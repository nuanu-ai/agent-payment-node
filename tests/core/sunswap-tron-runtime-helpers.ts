import { utils } from "tronweb";
import { compileAllowlistPolicyOverlay, type AllowlistPolicyOverlayInput } from "../../src/allowlist-policy-overlay.js";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import type { AssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import type { ChainWalletStoragePort } from "../../src/direct-rail-ports.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { SUNSWAP_TRON_CHAIN, SUNSWAP_USDT } from "../../src/swap/sunswap-tron/catalog.js";
import { SUNSWAP_V2_KEYLESS_MECHANISM_PIN } from "../../src/swap/sunswap-tron/mechanism.js";
import { createSunSwapKeylessRuntime } from "../../src/swap/sunswap-tron/runtime-factory.js";
import type { SunSwapUnsignedTransaction } from "../../src/swap/sunswap-tron/transaction.js";
import type { GuardedSwapPolicyResolver } from "../../src/swap/runtime.js";
import type { TronMethod } from "../../src/tron/rpc.js";
import { tronHex } from "../../src/tron/codec.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { FakeSunSwapRpc, blockId, v2Output, v2Receipt } from "./sunswap-tron-fixtures.js";

export const SEED = Buffer.alloc(32, 29);
export const OWNER = utils.crypto.getBase58CheckAddress(utils.crypto.getAddressFromPriKey([...SEED]));
export const PROFILE = "sunswap-runtime";
export const AMOUNT = "5000000";

class Wrapping implements WrappingSecretPort {
  readonly value = Buffer.alloc(32, 41);
  async load(): Promise<Buffer | null> { return Buffer.from(this.value); }
  async create(): Promise<Buffer> { return Buffer.from(this.value); }
}

/** TRON full node plus broadcast and full/solidified history. Nothing leaves the process; broadcasts are counted. */
export class SunSwapChain extends FakeSunSwapRpc {
  broadcasts: Record<string, unknown>[] = [];
  broadcastLost = false;
  outcome: "none" | "pending" | "success" | "revert" = "none";
  constructor() { super(); this.account = { address: tronHex(OWNER), balance: 100_000_000n }; }

  override async call(method: TronMethod, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    if (method === "wallet/broadcasttransaction") {
      this.calls.push({ method, body }); this.broadcasts.push({ ...body });
      if (this.broadcastLost) throw new Error("connection reset");
      return { result: true, txid: body.txID };
    }
    if (method === "walletsolidity/getnowblock") return { blockID: blockId(124n), block_header: { raw_data: { number: 124n, timestamp: 1n } } };
    if (method.endsWith("gettransactionbyid") || method.endsWith("gettransactioninfobyid")) return this.history(method, body.value as string);
    return await super.call(method, body);
  }

  private history(method: TronMethod, txid: string): unknown {
    const sent = this.broadcasts[0] as unknown as SunSwapUnsignedTransaction | undefined;
    if (sent === undefined || sent.txID !== txid || this.outcome === "none") return {};
    if (this.outcome === "pending" && method.startsWith("walletsolidity/")) return {};
    const info = method.endsWith("infobyid");
    if (this.outcome === "revert") {
      const transaction = { txID: sent.txID, raw_data_hex: sent.raw_data_hex, raw_data: structuredClone(sent.raw_data), ret: [{ contractRet: "REVERT" }] };
      return info ? { id: sent.txID, blockNumber: "123", fee: "3000000", result: "FAILED", resMessage: "5245564552",
        receipt: { result: "REVERT", energy_fee: "3000000", energy_usage_total: "30000" } } : transaction;
    }
    const receipt = v2Receipt(sent, OWNER, BigInt(AMOUNT), v2Output(BigInt(AMOUNT)));
    return info ? receipt.info : receipt.transaction;
  }
}

export function sunSwapPolicy(now: Date, caps: { readonly trx: string; readonly trxDaily: string }, version = "sunswap-runtime.1"): AssetPolicyRegistry {
  const inventory = loadAllowlistInventory();
  const overlay: AllowlistPolicyOverlayInput = { overlayVersion: version, profile: PROFILE, account: OWNER,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256, inventorySha256: inventory.inventorySha256,
    effectiveAt: new Date(now.getTime() - 60_000).toISOString(), expiresAt: new Date(now.getTime() + 7_200_000).toISOString(), admissions: [
      { chain: SUNSWAP_TRON_CHAIN, kind: "native", rail: "swap", maximumPerTransferAtomic: caps.trx, dailyLimitAtomic: caps.trxDaily,
        mechanism: SUNSWAP_V2_KEYLESS_MECHANISM_PIN },
      { chain: SUNSWAP_TRON_CHAIN, kind: "token", identifier: SUNSWAP_USDT, rail: "swap", maximumPerTransferAtomic: "10000000",
        dailyLimitAtomic: "10000000", mechanism: SUNSWAP_V2_KEYLESS_MECHANISM_PIN },
    ] };
  return compileAllowlistPolicyOverlay(overlay).registry;
}

export interface FlowOptions {
  readonly typingMs?: number;
  readonly typed?: (code: string) => string;
  readonly policy?: GuardedSwapPolicyResolver;
  readonly caps?: { readonly trx: string; readonly trxDaily: string };
}

/** One profile with a local TRON key, an active policy, a fake terminal and a live-shaped TRON node. */
export async function sunSwapFlow(root: string, options: FlowOptions = {}) {
  let clockMs = Date.now(); const clock = { now: () => new Date(clockMs) }, start = clock.now();
  const state = new StateStore(root); await state.initialize();
  const store = new ChainAccountStore(root, new Wrapping());
  await store.ensureLocal({ profile: PROFILE, rail: "tron", create: async () => ({ address: OWNER, seed: Buffer.from(SEED) }) });
  let hideAccount = false;
  const accounts: ChainWalletStoragePort = { account: async (profile, rail) => hideAccount ? null : await store.account(profile, rail),
    ownerBinding: async (profile, rail) => await store.ownerBinding(profile, rail), ensureLocal: async (input) => await store.ensureLocal(input),
    ensureProvider: async (input) => await store.ensureProvider(input), withSeed: async (account, action) => await store.withSeed(account, action),
    effect: async (account, operationId, fingerprint) => await store.effect(account, operationId, fingerprint),
    saveEffect: async (account, effect) => await store.saveEffect(account, effect) };
  const registry = sunSwapPolicy(start, options.caps ?? { trx: AMOUNT, trxDaily: "10000000" }), rpc = new SunSwapChain();
  let printed = "";
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { clockMs += options.typingMs ?? 0; const code = [...printed.matchAll(/Type ([0-9a-f]{6}) and press Enter/gu)].at(-1)?.[1] ?? "";
      yield Buffer.from(`${(options.typed ?? ((value: string) => value))(code)}\n`); }, close: async () => undefined });
  const runtime = createSunSwapKeylessRuntime({ state, rpc, accounts, clock, foreground: "tty", tty: { isTerminal: () => true, openTerminal: terminal },
    policy: options.policy ?? (async (profile) => profile === PROFILE ? registry : null) });
  const deadline = Math.floor(start.getTime() / 1000) + 300;
  const quote = async () => await runtime.quote({ command: "swap.sunswap.quote", profile: PROFILE, account: OWNER, recipient: OWNER,
    amountAtomic: AMOUNT, slippageBps: 50, ownerSlippageCapBps: 50, feeLimitSun: "30000000", deadline }, clock.now()) as { quoteHash: string };
  return { runtime, rpc, state, clock, registry, quote, deadline, printed: () => printed, advance: (ms: number) => { clockMs += ms; },
    hideAccount: (value: boolean) => { hideAccount = value; },
    usage: async () => (await new AssetUsageLedger(root).usage({ account: OWNER, chain: SUNSWAP_TRON_CHAIN,
      asset: { kind: "native", identifier: null } }, clock.now())).amountAtomic };
}
