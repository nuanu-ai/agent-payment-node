import assert from "node:assert/strict";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import type { SwapAdmissionMechanism } from "../../src/swap/route-admission.js";
import { BNB_UNISWAP_QUOTER_V2, BNB_UNISWAP_SWAP_ROUTER_02, BNB_USDC, BNB_USDT, BNB_WBNB } from "../../src/swap/uniswap-bnb/pins.js";
import { BNB_UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-bnb/token-route.js";
import { BNB_UNISWAP_TOKEN_LANE } from "../../src/swap/uniswap-bnb/token-lane.js";
import { envelopeOf } from "../../src/swap/uniswap-v3/token-custody.js";
import type { TokenEffectKind } from "../../src/swap/uniswap-v3/token-execution.js";
import type { UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import type { TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { createUniswapTokenLaneRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";

export const BNB_TOKEN_PROFILE = "bnb-token-swap";
export const BNB_TOKEN_KEY = `0x${"0".repeat(63)}1` as Hex;
export const BNB_TOKEN_ACCOUNT = privateKeyToAccount(BNB_TOKEN_KEY).address;
/** Ten units of an 18-decimal Binance-Peg token. */
export const BNB_TOKEN_AMOUNT_IN = "10000000000000000000";
/**
 * QuoterV2 quoteExactInputSingle of ten units, read on BNB Smart Chain at block 135304528 (0xc2064d37…c1c4b, 2026-11-24):
 * USDT and USDC into WBNB over their 0.05% pools, USDT into USDC and USDC into USDT over the 0.01% pool.
 */
export const BNB_TOKEN_QUOTES = { usdtToBnb: 17_659_060_907_517_660n, usdcToBnb: 17_680_191_673_163_667n,
  usdtToUsdc: 9_989_964_119_138_571_277n, usdcToUsdt: 10_008_038_124_170_607_260n } as const;
/** WETH9's Withdrawal(address indexed src, uint256 wad); WBNB is a WETH9. */
export const WITHDRAWAL_TOPIC = "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65" as const;
export const BNB_HEAD = 0x64n;
export const BNB_HEAD_HASH = `0x${"b".repeat(64)}` as const;
const WIDE = "1000000000000000000000";

export const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;
export const topic = (address: string): Hex => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const quantity = (value: bigint | string): string => `0x${BigInt(value).toString(16)}`;

/** Binance-Peg USDT and USDC and native BNB admitted for the swap rail with one mechanism (the token lane's own by default here). */
export async function activateBnbTokenPolicy(root: string, now: Date, mechanism: SwapAdmissionMechanism = BNB_UNISWAP_TOKEN_MECHANISM_PIN,
  assets: readonly ("usdt" | "usdc" | "native")[] = ["usdt", "usdc", "native"]): Promise<{ readonly policyDigest: string }> {
  const admissions = assets.map((asset) => asset === "native"
    ? { chain: "eip155:56", kind: "native" as const, rail: "swap" as const, maximumPerTransferAtomic: WIDE, dailyLimitAtomic: WIDE, mechanism }
    : { chain: "eip155:56", kind: "token" as const, identifier: asset === "usdt" ? BNB_USDT : BNB_USDC, rail: "swap" as const,
      maximumPerTransferAtomic: WIDE, dailyLimitAtomic: WIDE, mechanism });
  return await activateDirectPolicy(root, BNB_TOKEN_PROFILE, { accounts: { evm: BNB_TOKEN_ACCOUNT }, admissions, now });
}

/**
 * A deterministic chain-56 reader and sender for one direction. Every read answers at head 0x64; the input token holds
 * 20 units until the swap lands (10 after, at 0x64), the output token credits `quoted` at 0x64 to the recipient once
 * landed. Raw transactions are kept, nothing leaves the process.
 */
export class BnbTokenChain {
  readonly sends: Hex[] = [];
  readonly quoterCalls: Hex[] = [];
  readonly chainCalls: string[] = [];
  chainId = "0x38";
  allowance = 0n;
  quoted: bigint;
  landed = false;
  observedTx: unknown = null;
  observedReceipt: unknown = null;
  constructor(readonly inputToken: string, readonly outputToken: string, quoted: bigint) { this.quoted = quoted; }
  readonly raw = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    this.chainCalls.push(method);
    if (method === "eth_chainId") return this.chainId;
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "eth_getCode") return "0x00";
    if (method === "eth_getBlockByNumber") return { number: quantity(BNB_HEAD), hash: BNB_HEAD_HASH, parentHash: `0x${"a".repeat(64)}`, baseFeePerGas: "0x0",
      timestamp: "0x6b000000" };
    if (method === "eth_getBalance") return quantity(10n ** 18n);
    if (method === "eth_estimateGas") return "0x5208";
    if (method === "eth_maxPriorityFeePerGas") return "0x1";
    if (method === "eth_sendRawTransaction") { const raw = params[0] as Hex; this.sends.push(raw); return keccak256(raw); }
    if (method === "eth_getTransactionByHash") return this.observedTx;
    if (method === "eth_getTransactionReceipt") return this.observedReceipt;
    if (method === "eth_call") {
      const tx = params[0] as { readonly to?: string; readonly data?: Hex }, data = tx.data ?? "0x", tag = params[1];
      if (tx.to === BNB_UNISWAP_QUOTER_V2) { this.quoterCalls.push(data); return `0x${word(this.quoted).slice(2)}${word(0n).slice(2)}${word(1n).slice(2)}${word(80_000n).slice(2)}`; }
      if (data.startsWith("0xdd62ed3e")) return word(this.allowance);
      if (data.startsWith("0x70a08231")) return word(this.balance(tx.to!, tag));
      return "0x";
    }
    throw new Error(`unexpected ${method}`);
  };
  /** A token RPC with strict batches of at most three reads, answered by `raw`. */
  call(): TokenRpcCall {
    const call = (async (method: string, params: readonly unknown[]) => await this.raw(method, params)) as TokenRpcCall;
    Object.defineProperty(call, "batch", { value: async (_route: string, items: readonly { readonly method: string; readonly params: readonly unknown[] }[]) => {
      assert.ok(items.length >= 1 && items.length <= 3); return await Promise.all(items.map((item) => this.raw(item.method, item.params))); } });
    return call;
  }
  private balance(token: string, tag: unknown): bigint {
    const after = this.landed && tag === quantity(BNB_HEAD);
    if (token === this.inputToken) return after ? 10n * 10n ** 18n : 20n * 10n ** 18n;
    if (token === this.outputToken) return after ? this.quoted : 0n;
    throw new Error(`unexpected balance of ${token}`);
  }
  /**
   * The mined transaction and receipt of one effect at head 0x64, built from its own envelope. A landed native swap's
   * receipt carries the router's WBNB Withdrawal of `withdrawal` (null: no unwrap log at all).
   */
  observe(op: UniswapTokenOperation, kind: TokenEffectKind, status: 0 | 1, withdrawal: bigint | null = this.quoted): void {
    const attempt = kind === "approval" ? op.approvalAttempt! : kind === "swap" ? op.swapAttempt! : op.cleanupAttempt!, envelope = envelopeOf(op, kind, attempt.nonce),
      hash = attempt.transactionHash!, at = { blockNumber: quantity(BNB_HEAD), blockHash: BNB_HEAD_HASH };
    this.observedTx = { hash, chainId: quantity(BigInt(envelope.chainId)), from: op.account, to: envelope.to, input: envelope.data, value: "0x0",
      nonce: quantity(envelope.nonce), gas: quantity(envelope.gasLimit), maxFeePerGas: quantity(envelope.maxFeePerGas),
      maxPriorityFeePerGas: quantity(envelope.maxPriorityFeePerGas), type: "0x2", ...at };
    const native = kind === "swap" && status === 1 && "output" in op.route && op.route.output === "native" && withdrawal !== null;
    this.observedReceipt = { transactionHash: hash, from: op.account, to: envelope.to, status: `0x${status}`, gasUsed: "0x5208", effectiveGasPrice: "0x1", ...at,
      logs: native ? [{ address: BNB_WBNB, topics: [WITHDRAWAL_TOPIC, topic(BNB_UNISWAP_SWAP_ROUTER_02)], data: word(withdrawal), transactionHash: hash,
        removed: false, logIndex: "0x0", ...at }] : [] };
    this.landed = kind === "swap" && status === 1;
  }
  clearObservation(): void { this.observedTx = null; this.observedReceipt = null; }
}

/** The local encrypted wallet of the test account under the BNB token profile. */
export async function bnbTokenWallet(root: string): Promise<{ readonly state: StateStore; readonly wrapping: { load(): Promise<Buffer>; create(): Promise<Buffer> } }> {
  const state = new StateStore(root), master = Buffer.alloc(32, 73), wrapping = { load: async () => Buffer.from(master), create: async () => Buffer.from(master) };
  await state.initialize(); await new EncryptedWalletStore(state, wrapping).importNew(BNB_TOKEN_PROFILE, BNB_TOKEN_KEY, BNB_TOKEN_ACCOUNT);
  return { state, wrapping };
}

/** A terminal that types back the code it is shown, and keeps every screen it was shown. */
export function typingTerminal(): { readonly screens: string[]; readonly tty: { isTerminal(): boolean; openTerminal(): Promise<unknown> } } {
  const screens: string[] = []; let phrase = "";
  const openTerminal = async () => ({ fd: 1, write: async (screen: string) => { screens.push(screen); phrase = /Type ([a-z0-9-]+) and/u.exec(screen)?.[1] ?? ""; },
    read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => undefined });
  return { screens, tty: { isTerminal: () => true, openTerminal } };
}

/** The BNB token lane's production runtime over the fake chain; the code pins are the only reads replaced (their bytes are not here). */
export function bnbTokenRuntime(input: { readonly state: StateStore; readonly wrapping: { load(): Promise<Buffer>; create(): Promise<Buffer> };
  readonly chain: BnbTokenChain; readonly now: Date; readonly foreground: "approve" | "cleanup" | "refuse"; readonly tty?: unknown }) {
  return createUniswapTokenLaneRuntime(BNB_UNISWAP_TOKEN_LANE, { state: input.state, wrapping: input.wrapping, clock: { now: () => input.now },
    call: input.chain.call(), foreground: input.foreground, ...(input.tty === undefined ? {} : { tty: input.tty as never }), verifyPins: async () => undefined });
}

/** A quote request of the BNB token lane; `output` is `native` or the other token's address. */
export function bnbTokenQuoteRequest(now: Date, sourceToken: string, output: string, minimumOutputAtomic: string) {
  return { command: "swap.uniswap-bnb-token.quote" as const, profile: BNB_TOKEN_PROFILE, account: BNB_TOKEN_ACCOUNT, recipient: BNB_TOKEN_ACCOUNT,
    sourceToken, outputToken: output, amountAtomic: BNB_TOKEN_AMOUNT_IN, minimumOutputAtomic, approvalCapAtomic: BNB_TOKEN_AMOUNT_IN,
    deadline: Math.floor(now.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "300000", maxCleanupGasLimit: "100000",
    maxFeePerGas: "2", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1000000" };
}
