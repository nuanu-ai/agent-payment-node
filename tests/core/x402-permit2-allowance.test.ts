import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, keccak256, parseAbi, parseTransaction, type Hex } from "viem";
import * as cliRuntime from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import type { Permit2AllowanceRpc } from "../../src/x402-permit2/allowance/chain.js";
import { PERMIT2_ADDRESS } from "../../src/x402-permit2/registry.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { ASSET_LIMITS, admitAsset, assetFixture } from "./x402-any-asset-helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const BASE_USDC = { label: "Base USDC", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const, name: "USD Coin", version: "2", decimals: 6 };
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const quantity = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: string | bigint) => `0x${(typeof value === "bigint" ? value.toString(16) : value.slice(2).toLowerCase()).padStart(64, "0")}`;
type Status = { readonly operation_id: string; readonly state: string; readonly transaction_hash: string | null; readonly outcome: { readonly kind: string } | null };
const data = (envelope: OutputEnvelope) => envelope.data as Status;

/** A synthetic Base node: the latest, safe and finalized heads, the owner's nonces, allowance and one sent transaction's fate. */
class AllowanceRpc implements Permit2AllowanceRpc {
  readonly origin = "https://rpc.example";
  owner = ""; nonce = 7n; pending = 7n; finalizedNonce = 7n; allowance = 0n; estimate = 50_000n;
  readonly heads = { latest: { number: 1_000n, hash: word("0xaa") }, safe: { number: 1_200n, hash: word("0xbb") }, finalized: { number: 1_190n, hash: word("0xcc") } };
  readonly sent: Hex[] = [];
  receipt: { readonly status: bigint; readonly blockNumber: bigint; readonly blockHash: string; readonly log: boolean } | null = null;
  readonly calls: string[] = [];
  async batch(calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]): Promise<readonly unknown[]> {
    return calls.map((call) => { this.calls.push(call.method); return this.respond(call.method, call.params); });
  }
  async send(raw: Hex): Promise<Hex> { this.sent.push(raw); return keccak256(raw); }
  private respond(method: string, params: readonly unknown[]): unknown {
    const hash = this.sent.length === 0 ? null : keccak256(this.sent[0]!);
    switch (method) {
      case "eth_chainId": return "0x2105";
      case "eth_getBlockByNumber": {
        const tag = params[0] as string;
        if (tag === "latest" || tag === "safe" || tag === "finalized") {
          const head = this.heads[tag]; return { number: quantity(head.number), hash: head.hash, baseFeePerGas: quantity(1_000_000n) };
        }
        return { number: tag, hash: this.receipt?.blockHash ?? word("0xdd") };
      }
      case "eth_getTransactionCount": return quantity(params[1] === "pending" ? this.pending : params[1] === "finalized" ? this.finalizedNonce : this.nonce);
      case "eth_call": return word(this.allowance);
      case "eth_getBalance": return quantity(10n ** 18n);
      case "eth_getCode": return "0x6080";
      case "eth_estimateGas": return quantity(this.estimate);
      case "eth_getTransactionReceipt": return this.receipt === null || hash === null ? null : { transactionHash: hash, blockNumber: quantity(this.receipt.blockNumber),
        blockHash: this.receipt.blockHash, status: quantity(this.receipt.status), logs: this.receipt.log ? [{ address: BASE_USDC.token,
          topics: [APPROVAL_TOPIC, word(this.owner), word(PERMIT2_ADDRESS)], data: word(5_000_000n) }] : [] };
      // The era block (the latest head at prepare) holds one transaction this node indexes; the sent approve is unknown.
      case "eth_getBlockTransactionCountByNumber": return "0x1";
      case "eth_getTransactionByBlockNumberAndIndex": return { hash: word("0xee"), blockHash: this.heads.latest.hash, blockNumber: quantity(this.heads.latest.number) };
      case "eth_getTransactionByHash": return params[0] === word("0xee") ? { hash: word("0xee"), blockHash: this.heads.latest.hash, blockNumber: quantity(this.heads.latest.number) } : null;
      default: throw new Error(`unexpected ${method}`);
    }
  }
}

async function ready(context: test.TestContext, admit = true) {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC);
  if (admit) await admitAsset(fixture, BASE_USDC); else await fixture.core.wallet.ensure("default");
  const wallet = (await fixture.state.loadWallet(fixture.state.profileHash("default")))!;
  const rpc = new AllowanceRpc(); rpc.owner = wallet.address;
  const screens: string[] = [];
  const tty = { isTerminal: () => true, openTerminal: async () => {
    let phrase = "";
    return { fd: 1, write: async (text: string) => { screens.push(text); phrase = /Type ([a-f0-9]{6})/u.exec(text)?.[1] ?? phrase; },
      read: async function* () { yield Buffer.from(`${phrase}\n`); }, close: async () => {} };
  } };
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping, policy: fixture.policy, permit2AllowanceRpc: rpc,
    permit2AllowanceTtyOptions: tty, clock: { now: () => new Date() } };
  return { root: temporary.root, rpc, options, screens, owner: wallet.address };
}
const args = (action: "set" | "revoke", key: string, amount = "5000000") => ["x402", "permit2", "allowance", action, "--profile", "default",
  "--chain", "eip155:8453", "--asset", BASE_USDC.token, ...(action === "set" ? ["--amount", amount] : []), "--rpc-url", "https://rpc.example",
  "--max-gas-limit", "80000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "1000000", "--idempotency-key", key];

test("allowance set approves exactly the owner's amount to Permit2 once and completes on a receipt at the chain's proof tag", async (context) => {
  const f = await ready(context);
  const sent = await runCli(args("set", "allow-0001"), {}, f.options);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(data(sent).state, "submitted");
  assert.ok(f.screens.some((screen) => screen.includes(`Spender: Permit2 ${PERMIT2_ADDRESS}`) && screen.includes("New allowance: 5000000 atomic")));
  assert.equal(f.rpc.sent.length, 1);
  const tx = parseTransaction(f.rpc.sent[0]!);
  assert.equal(tx.chainId, 8453); assert.equal(tx.to?.toLowerCase(), BASE_USDC.token.toLowerCase()); assert.equal(tx.nonce, 7); assert.equal(tx.gas, 80_000n);
  const call = decodeFunctionData({ abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]), data: tx.data! });
  assert.deepEqual(call.args, [PERMIT2_ADDRESS, 5_000_000n]);
  // A replay of the same key never sends again.
  assert.equal(data(await runCli(args("set", "allow-0001"), {}, f.options)).state, "submitted");
  assert.equal(f.rpc.sent.length, 1);
  f.rpc.receipt = { status: 1n, blockNumber: 1_100n, blockHash: word("0x11"), log: true };
  const observed = await runCli(["x402", "permit2", "allowance", "observe", "--operation", data(sent).operation_id, "--rpc-url", "https://rpc.example"], {}, f.options);
  assert.equal(data(observed).state, "completed", JSON.stringify(observed));
  const entry = await new OperationIndex(new SecureStateStore(f.root)).find(data(sent).operation_id);
  assert.equal(entry?.state, "terminal"); assert.deepEqual(entry?.claims, []);
});

test("a sent approve the chain can never include ends superseded on the shared finalized never-lands proof", async (context) => {
  const f = await ready(context);
  const sent = await runCli(args("revoke", "revoke-0001"), {}, { ...f.options, permit2AllowanceRpc: Object.assign(f.rpc, { allowance: 5_000_000n }) });
  assert.equal(data(sent).state, "submitted", JSON.stringify(sent));
  const observe = ["x402", "permit2", "allowance", "observe", "--operation", data(sent).operation_id, "--rpc-url", "https://rpc.example"];
  assert.equal(data(await runCli(observe, {}, f.options)).state, "submitted", "the finalized nonce is not past yet");
  f.rpc.finalizedNonce = 8n;
  const ended = await runCli(observe, {}, f.options);
  assert.equal(data(ended).state, "superseded", JSON.stringify(ended));
  assert.equal(data(ended).outcome?.kind, "never_lands");
});

test("allowances are owner-admitted and bounded, and refusals sign nothing", async (context) => {
  const unadmitted = await ready(context, false);
  const refused = await runCli(args("set", "allow-0002"), {}, unadmitted.options);
  assert.equal(refused.error?.details?.reason, "x402_permit2_allowance_not_admitted", JSON.stringify(refused));
  const f = await ready(context);
  const above = await runCli(args("set", "allow-0003", (BigInt(ASSET_LIMITS.maxBalanceUsdcAtomic) + 1n).toString()), {}, f.options);
  assert.equal(above.error?.details?.reason, "x402_permit2_allowance_above_cap");
  f.rpc.pending = 8n;
  assert.equal((await runCli(args("set", "allow-0004"), {}, f.options)).error?.details?.reason, "x402_permit2_allowance_nonce_pending");
  f.rpc.pending = 7n; f.rpc.estimate = 90_000n;
  assert.equal((await runCli(args("set", "allow-0005"), {}, f.options)).error?.details?.reason, "x402_permit2_allowance_gas_cap");
  assert.equal(f.rpc.sent.length + unadmitted.rpc.sent.length, 0);
});

test("the owner abandons a sent approve no proof decides; status and the MCP handoff name the family commands", async (context) => {
  const f = await ready(context);
  const sent = await runCli(args("set", "allow-0006"), {}, f.options);
  const approvals: string[] = [];
  const abandoned = await runCli(["operation", "abandon", "--operation", data(sent).operation_id], {},
    { ...f.options, operationAbandonApproval: { approve: async (intent) => { approvals.push(intent.assetLabel); } } });
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned));
  assert.deepEqual(approvals, [`allowance of ${BASE_USDC.token} to Permit2`]);
  const status = await runCli(["x402", "permit2", "allowance", "status", "--operation", data(sent).operation_id], {}, f.options);
  assert.equal(data(status).state, "abandoned_unknown");
});
