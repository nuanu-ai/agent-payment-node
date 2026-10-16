/** Shared harness for the Relay any-profile end-to-end tests (QA RELAY-001..008).
 *
 * Identity: two generated keys that belong to nobody (`keccak256("apn-relay-qa-payer-v1")` and
 * `keccak256("apn-relay-qa-recipient-v1")`). The `generated-*-quote-20261017.json` fixtures are keyless Relay
 * `quote/v2` responses captured on 2026-10-17 for exactly these addresses (free, no signing, no money): the solver's
 * signed orders name the generated payer as depositor and the generated recipient as payee, so the real validators
 * run unchanged. Chains are an in-memory JSON-RPC simulator; signing is real (the payer's encrypted local wallet). */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { decodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, toBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalCode } from "../../src/approval-code.js";
import { runCli } from "../../src/cli.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { RELAY_ROUTER_V3 } from "../../src/relay/destination-proof.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";

export const QA_PAYER_KEY = keccak256(toBytes("apn-relay-qa-payer-v1"));
export const QA_RECIPIENT_KEY = keccak256(toBytes("apn-relay-qa-recipient-v1"));
export const QA_PAYER = privateKeyToAccount(QA_PAYER_KEY).address;
export const QA_RECIPIENT = privateKeyToAccount(QA_RECIPIENT_KEY).address;
/** Unix seconds just after the generated quotes were captured; each fixture's signed deadline is seven days later. */
export const QA_CAPTURED_AT = 1792190430;
export const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const OWNER_ADDRESSES = ["0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", "0x823a3a5bab1186141b32fc65f8e25ca24c679ce7",
  "0x991e254b5c8e0aaf6c244eaa2706bad059809b04", "0xf41170df51aab52aaa04fbc3ff325cf051644aca"];
const OWNER_PROFILES = ["default", "evm-live-buyer", "evm-live-seller", "metamask-live-v042"];

export const wrapping: WrappingSecretPort = { load: async () => Buffer.alloc(32, 9), create: async () => Buffer.alloc(32, 9) };
export type QuoteName = "ethereum-usdc-bnb-native" | "ethereum-usdc-base-eth" | "bnb-native-polygon-native" | "bnb-native-monad-native" |
  "base-native-megaeth-usdm" | "base-native-polygon-native" | "arbitrum-usdc-ethereum-usdc";
export const quotePath = (name: QuoteName) => `tests/core/relay-fixtures/generated-${name}-quote-20261017.json`;
export const quoteFixture = async (name: QuoteName): Promise<any> => JSON.parse(await readFile(quotePath(name), "utf8"));

/** The test identities are nobody's: neither address nor profile is one the code ever pinned. */
export function assertNonOwner(profile: string, ...addresses: string[]): void {
  assert.equal(OWNER_PROFILES.includes(profile), false);
  for (const address of addresses) assert.equal(OWNER_ADDRESSES.includes(address.toLowerCase()), false);
}

export interface QaWorld {
  readonly root: string;
  readonly clock: { now(): Date };
  readonly cli: (argv: readonly string[], options?: Record<string, unknown>) => ReturnType<typeof runCli>;
  readonly quoteRequests: Record<string, unknown>[];
  readonly keyFile: string;
}

/** A fresh state root, a wall clock that starts at the capture instant and advances in real time, and a mocked
 * `fetch` that answers the keyless Relay quote endpoint with `quote` and the status endpoint with `status()`. */
export async function qaWorld(t: TestContext, quote: QuoteName | null, status: () => unknown = () => ({ status: "waiting" })): Promise<QaWorld> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "apn-relay-qa-")));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const startedAt = Date.now(), wall = Date.now.bind(Date);
  const now = () => QA_CAPTURED_AT * 1000 + (wall() - startedAt);
  t.mock.method(Date, "now", now);
  const raw = quote === null ? null : await quoteFixture(quote);
  const quoteRequests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://api.relay.link/quote/v2" && init?.method === "POST" && raw !== null) {
      quoteRequests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(raw), { status: 200 });
    }
    if (url.startsWith("https://api.relay.link/intents/status/v3?requestId=")) return new Response(JSON.stringify(status()), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
  const root = join(directory, "state");
  const clock = { now: () => new Date(now()) };
  const cli = (argv: readonly string[], options: Record<string, unknown> = {}) =>
    runCli([...argv], {}, { stateRoot: root, wrappingSecret: wrapping, clock, ...options });
  // The payer's key enters through the real `wallet import` command (owner-only key file).
  const keyFile = join(directory, "payer.env");
  await writeFile(keyFile, `QA_RELAY_PAYER='${QA_PAYER_KEY}'\n`, { mode: 0o600 });
  return { root, clock, cli, quoteRequests, keyFile };
}

export async function importPayer(world: QaWorld, profile: string): Promise<void> {
  const imported = await world.cli(["wallet", "import", "--profile", profile, "--key-file", world.keyFile, "--key-name", "QA_RELAY_PAYER",
    "--expected-address", QA_PAYER]);
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
}

/** Stage and activate the profile's own owner policy: one bridge admission with the Relay mechanism pin and caps. */
export async function admitBridge(world: QaWorld, profile: string, input: { readonly chain: string; readonly asset: string | null;
  readonly reference: string; readonly maximumPerTransferAtomic: string; readonly dailyLimitAtomic: string;
  readonly recipients?: readonly string[] }): Promise<void> {
  await activateDirectPolicy(world.root, profile, { accounts: { evm: QA_PAYER }, now: world.clock.now(), admissions: [{
    chain: input.chain, ...(input.asset === null ? { kind: "native" as const } : { kind: "token" as const, identifier: input.asset }),
    rail: "bridge", maximumPerTransferAtomic: input.maximumPerTransferAtomic, dailyLimitAtomic: input.dailyLimitAtomic,
    mechanism: { provider: "relay", reference: input.reference },
    ...(input.recipients === undefined ? {} : { recipients: [...input.recipients] }) } as never] });
}

/** Foreground consent that types the exact approval code and records every screen. */
export function consent(operationId: string, quoteDigest: string, screens: string[] = []) {
  return { relayExecuteTtyOptions: { isTerminal: () => true, openTerminal: async () => {
    let screen = "";
    return { fd: 0, write: async (value: string) => { screen += value; },
      read: async function* () { screens.push(screen); yield Buffer.from(`${approvalCode("bridge", operationId, quoteDigest)}\n`); },
      close: async () => {} };
  } } };
}

const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const hex = (value: bigint) => `0x${value.toString(16)}`;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
export const APPROVAL_TOPIC = keccak256(toBytes("Approval(address,address,uint256)"));
export const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));
const SOLVER_NATIVE_TRANSFER_TOPIC = "0xd35467972d1fda5b63c735f59d3974fa51785a41a92aa3ed1b70832836f8dba6";
const APPROVE = parseAbi(["function approve(address spender, uint256 amount)"]);
const L1_ORACLE = "0x420000000000000000000000000000000000000f";
type Call = { readonly method: string; readonly params: readonly unknown[] };
interface SimLog { readonly address: string; readonly topics: readonly string[]; readonly data: string }
interface SimTx {
  readonly hash: Hex; readonly from: string; readonly to: string; readonly input: string; readonly value: bigint; readonly nonce: bigint;
  readonly gas: bigint; readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint;
  blockNumber: bigint | null; logs: SimLog[]; readonly status: 0n | 1n;
}

/** An in-memory EVM chain that answers the read methods the Relay readers use, accepts raw signed transactions,
 * and mines them on `mine()`. Destination payouts are added with `payout*`. Every batch is one counted POST. */
export class SimChain {
  head = 1000n;
  posts = 0;
  readonly sent: Hex[] = [];
  readonly methods: string[] = [];
  private readonly txs = new Map<string, SimTx>();
  private readonly balances = new Map<string, bigint>();
  private readonly tokenBalances = new Map<string, bigint>();
  private readonly allowances = new Map<string, bigint>();
  constructor(readonly chainId: number, private readonly safeLag = 2n, private readonly l1Fee = 1000n) {}

  fund(account: string, wei: bigint, token?: { readonly address: string; readonly atomic: bigint }): this {
    this.balances.set(account.toLowerCase(), wei);
    if (token !== undefined) this.tokenBalances.set(`${token.address}:${account}`.toLowerCase(), token.atomic);
    return this;
  }
  blockHash(number: bigint): Hex { return keccak256(toHex(`apn-relay-qa:${this.chainId}:${number}`)); }
  private block(number: bigint) {
    // BNB Smart Chain has a zero base fee (its quotes set priority = max fee); the other chains carry one wei.
    return { number: hex(number), hash: this.blockHash(number), parentHash: this.blockHash(number - 1n), baseFeePerGas: this.chainId === 56 ? "0x0" : "0x1",
      timestamp: hex(BigInt(Math.floor(Date.now() / 1000))), transactions: [] };
  }
  private tag(value: unknown): bigint {
    if (value === "latest" || value === "pending" || (typeof value === "object" && value !== null)) return this.head;
    if (value === "safe" || value === "finalized") return this.head - this.safeLag;
    if (typeof value === "string" && /^0x[0-9a-f]+$/u.test(value)) return BigInt(value);
    throw new Error(`unexpected block tag ${String(value)}`);
  }
  private nonce(account: string, pending: boolean): bigint {
    return BigInt([...this.txs.values()].filter(tx => tx.from === account.toLowerCase() && (pending || tx.blockNumber !== null)).length);
  }
  private transaction(tx: SimTx) {
    return { hash: tx.hash, chainId: hex(BigInt(this.chainId)), type: "0x2", from: tx.from, to: tx.to, input: tx.input, value: hex(tx.value),
      nonce: hex(tx.nonce), gas: hex(tx.gas), maxFeePerGas: hex(tx.maxFeePerGas), maxPriorityFeePerGas: hex(tx.maxPriorityFeePerGas),
      blockNumber: hex(tx.blockNumber!), blockHash: this.blockHash(tx.blockNumber!), transactionIndex: "0x0" };
  }
  private receipt(tx: SimTx) {
    const blockHash = this.blockHash(tx.blockNumber!);
    return { transactionHash: tx.hash, blockNumber: hex(tx.blockNumber!), blockHash, status: hex(tx.status), from: tx.from, to: tx.to,
      type: "0x2", gasUsed: "0x7530", effectiveGasPrice: hex(tx.maxFeePerGas), cumulativeGasUsed: "0x7530",
      ...(this.chainId === 8453 ? { l1Fee: hex(this.l1Fee) } : {}),
      logs: tx.logs.map((log, index) => ({ ...log, transactionHash: tx.hash, blockHash, blockNumber: hex(tx.blockNumber!),
        logIndex: hex(BigInt(index)), transactionIndex: "0x0", removed: false })) };
  }
  private call(target: { to: string; data: string }): string {
    const to = target.to.toLowerCase(), data = target.data.toLowerCase();
    if (to === L1_ORACLE) return word(1000n);
    if (data.startsWith("0x70a08231")) return word(this.tokenBalances.get(`${to}:0x${data.slice(34, 74)}`) ?? 0n);
    if (data.startsWith("0xdd62ed3e")) return word(this.allowances.get(`${to}:0x${data.slice(34, 74)}:0x${data.slice(98, 138)}`) ?? 0n);
    throw new Error(`unexpected eth_call ${to} ${data.slice(0, 10)}`);
  }
  private answer(call: Call): unknown {
    this.methods.push(call.method);
    const [first, second] = call.params;
    switch (call.method) {
      case "eth_chainId": return hex(BigInt(this.chainId));
      case "eth_getBlockByNumber": { const number = this.tag(first); return number > this.head ? null : this.block(number); }
      case "eth_getBalance": return hex(this.balances.get(String(first).toLowerCase()) ?? 0n);
      case "eth_getTransactionCount": return hex(this.nonce(String(first), second === "pending"));
      case "eth_call": return this.call(first as { to: string; data: string });
      case "eth_estimateGas": return "0x7530";
      case "eth_maxPriorityFeePerGas": return "0x1";
      case "eth_getTransactionByHash": { const tx = this.txs.get(String(first).toLowerCase()); return tx?.blockNumber ? this.transaction(tx) : null; }
      case "eth_getTransactionReceipt": { const tx = this.txs.get(String(first).toLowerCase()); return tx?.blockNumber ? this.receipt(tx) : null; }
      default: throw new Error(`unexpected RPC ${call.method}`);
    }
  }
  readonly batchCall = async (calls: readonly Call[]): Promise<readonly unknown[]> => { this.posts++; return calls.map(call => this.answer(call)); };
  readonly submitRawTransaction = async (raw: Hex): Promise<Hex> => {
    this.posts++;
    const parsed = parseTransaction(raw), from = (await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase();
    assert.equal(parsed.chainId, this.chainId);
    const hash = keccak256(raw), to = parsed.to!.toLowerCase(), input = (parsed.data ?? "0x").toLowerCase();
    const logs: SimLog[] = [];
    if (input.startsWith("0x095ea7b3")) {
      const { args } = decodeFunctionData({ abi: APPROVE, data: input as Hex });
      this.allowances.set(`${to}:${from}:${args[0].toLowerCase()}`, args[1]);
      logs.push({ address: to, topics: [APPROVAL_TOPIC, topic(from), topic(args[0])], data: word(args[1]) });
    }
    // viem omits zero fee fields when parsing (Arbitrum quotes carry a zero priority fee).
    this.txs.set(hash, { hash, from, to, input, value: parsed.value ?? 0n, nonce: BigInt(parsed.nonce ?? 0), gas: parsed.gas ?? 0n,
      maxFeePerGas: parsed.maxFeePerGas ?? 0n, maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? 0n, blockNumber: null, logs, status: 1n });
    this.sent.push(raw);
    return hash;
  };
  /** Include every sent transaction in the next block and bury it under `depth` blocks (past safe/finalized/15-deep). */
  mine(depth = 40n): void {
    this.head += 1n;
    for (const tx of this.txs.values()) if (tx.blockNumber === null) tx.blockNumber = this.head;
    this.head += depth;
  }
  private payout(tx: Omit<SimTx, "blockNumber" | "nonce" | "gas" | "maxFeePerGas" | "maxPriorityFeePerGas" | "status">): Hex {
    this.head += 1n;
    this.txs.set(tx.hash, { ...tx, nonce: 0n, gas: 30000n, maxFeePerGas: 1000n, maxPriorityFeePerGas: 1n, blockNumber: this.head, status: 1n });
    this.head += 40n;
    return tx.hash;
  }
  /** A solver's direct native transfer to `recipient`. */
  payoutNative(recipient: string, wei: bigint): Hex {
    return this.payout({ hash: keccak256(toHex(`payout:${this.chainId}:${recipient}:${wei}`)), from: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      to: recipient.toLowerCase(), input: "0x", value: wei, logs: [] });
  }
  /** A Relay router v3 native transfer event crediting `recipient` (Base and Polygon contract payouts). */
  payoutRouter(recipient: string, wei: bigint): Hex {
    return this.payout({ hash: keccak256(toHex(`router:${this.chainId}:${recipient}:${wei}`)), from: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      to: RELAY_ROUTER_V3, input: "0x12345678", value: 0n,
      logs: [{ address: RELAY_ROUTER_V3, topics: [SOLVER_NATIVE_TRANSFER_TOPIC], data: `${topic(recipient)}${word(wei).slice(2)}` }] });
  }
  /** One ERC20 Transfer of `token` to `recipient`. */
  payoutToken(token: string, recipient: string, atomic: bigint): Hex {
    return this.payout({ hash: keccak256(toHex(`token:${this.chainId}:${recipient}:${atomic}`)), from: "0xf70da97812cb96acdf810712aa562db8dfa3dbef",
      to: token.toLowerCase(), input: "0xa9059cbb", value: 0n,
      logs: [{ address: token.toLowerCase(), topics: [TRANSFER_TOPIC, topic("0xf70da97812cb96acdf810712aa562db8dfa3dbef"), topic(recipient)], data: word(atomic) }] });
  }
}
