import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { oneClickLane } from "../../src/lifi/near-oneclick-lanes.js";
import { bridgeConflictDomain, evmConflictDomain, railConflictDomain, SOLANA_BRIDGE_CHAIN_ID } from "../../src/operation-conflict-domain.js";
import { admitOperation } from "../../src/operation-index/admission.js";
import { circleApprovalAdapter } from "../../src/operation-index/adapters/circle-approval.js";
import { circleSourceAdapter } from "../../src/operation-index/adapters/circle-source.js";
import { evmClaim, namedProfileClaim, UNSTARTED_DEADLINE_MARGIN_MS } from "../../src/operation-index/adapters/family-claims.js";
import { GASLESS_USDT_CHAIN_ID, gaslessUsdtAdapter } from "../../src/operation-index/adapters/gasless-usdt.js";
import { merchantAdapter } from "../../src/operation-index/adapters/merchant.js";
import { metaMaskNativeAdapter } from "../../src/operation-index/adapters/metamask-native.js";
import { permit2Adapter } from "../../src/operation-index/adapters/permit2.js";
import { oneClickSourceAdapter } from "../../src/operation-index/adapters/oneclick.js";
import { stargateNativeAdapter, stargateTokenAdapter } from "../../src/operation-index/adapters/stargate.js";
import { swapAdapter, swapClaims } from "../../src/operation-index/adapters/swap.js";
import { UNISWAP_TOKEN_CHAIN_ID, uniswapTokenAdapter } from "../../src/operation-index/adapters/uniswap-token.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { operationRegistry } from "../../src/operation-index/registry.js";
import { OPERATION_FAMILIES, type OperationFamily } from "../../src/operation-index/types.js";
import { OperationService, type StoredMoneyOperation } from "../../src/operation-service.js";
import { FileStargateNativeJournal } from "../../src/stargate-v2/native-journal.js";
import { FileStargateTokenJournal } from "../../src/stargate-v2/token-journal.js";
import { StateStore } from "../../src/state.js";
import { TRON_GENESIS } from "../../src/tron/constants.js";
import { temporaryState } from "./helpers.js";
import { journalFixture } from "./x402-permit2-production-journal-fixture.js";
import { bindArgv } from "../../src/command-binder.js";
import { executeBoundCommand } from "../../src/runtime-factory.js";

/**
 * Phase 4b WP2: every money family claims through the operation index. The matrix runs each family's own admission
 * (the call its prepare makes before its first RPC read) against the facade families on the same network and account,
 * in both orders, while the first one is still inside its prepare body without a record.
 */
const A = "0x0b4dd0c3da001fa146eed3f80b01860bef6b8a14", B = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const S = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", T = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const PROFILE = "default";
let counter = 0;
const next = (label: string) => sha256(`${label}\0${counter += 1}`);

interface Side { readonly name: string; admit(state: StateStore, work: () => Promise<unknown>): Promise<unknown> }
function facade(kind: StoredMoneyOperation["kind"], name: string, domain: () => ReturnType<typeof evmConflictDomain>): Side {
  return { name, admit: async (state, work) => await new OperationService(state).admit({ kind, profileHash: state.profileHash(PROFILE),
    operationId: next(name), idempotencyHash: next(`${name}-key`), requestHash: next(`${name}-request`) }, { domains: () => [domain()] }, work) };
}
function family(family: OperationFamily, name: string, claims: () => ReturnType<typeof evmClaim>[]): Side {
  return { name, admit: async (state, work) => await admitOperation(state, { family, profileHash: state.profileHash(PROFILE),
    operationId: next(name), idempotencyHash: null, requestHash: null }, claims(), work) };
}
const direct = (chainId: number, account = A) => facade("direct_transfer", `direct-${chainId}`, () => evmConflictDomain(chainId, account));
const rail = (kind: "solana" | "tron", account: string) => facade("rail_transfer", `rail-${kind}`, () => railConflictDomain(kind, account));
const bridge = (chainId: number | string, account: string) => facade("bridge_route", `bridge-${chainId}`, () => bridgeConflictDomain(chainId, account));
/** A swap admits with the quote's own profile hash and holds the state's profile name too (GuardedSwapRuntime.prepare). */
const swap = (chain: string, account: string): Side => ({ name: `swap-${chain}`, admit: async (state, work) => {
  const quote = { profile: PROFILE, account, sourceAsset: { chain } };
  return await admitOperation(state, { family: "swap", profileHash: domainHash("apn.swap-quote.v1", `profile\0${PROFILE}`), operationId: next("swap"),
    idempotencyHash: null, requestHash: null }, swapClaims({ quote } as never), work, [namedProfileClaim(PROFILE)]);
} });
/** Stargate prepares admit through their file journals (prepareStargateV2*). */
const stargateNative = (account = A): Side => ({ name: "stargate-native", admit: async (state, work) =>
  await new FileStargateNativeJournal(state.root, state).admit({ operationId: next("stargate-native"), profile: PROFILE, owner: account as `0x${string}` }, work) });
const stargateToken = (account = A): Side => ({ name: "stargate-token", admit: async (state, work) =>
  await new FileStargateTokenJournal(state.root, state).admit({ operationId: next("stargate-token"), profile: PROFILE, owner: account as `0x${string}` }, work) });
const uniswapToken = (account = A) => family("uniswap_token", "uniswap-token", () => [evmClaim(UNISWAP_TOKEN_CHAIN_ID, account)]);
const usdt = (account = A) => family("gasless_usdt", "gasless-usdt", () => [evmClaim(GASLESS_USDT_CHAIN_ID, account)]);
const native = (chainId: number, account = A) => family("metamask_native", `metamask-native-${chainId}`, () => [evmClaim(chainId, account)]);
const oneClick = (lane: string, account = A) => family("oneclick_source", `oneclick-${lane}`, () => [evmClaim(oneClickLane(lane).origin.chainId, account)]);
const circleSource = (account = A) => family("circle_source", "circle-source", () => [evmClaim(8453, account)]);
const circleApproval = (account = A) => family("circle_approval", "circle-approval", () => [evmClaim(8453, account)]);

/** `first` is inside its prepare body (admitted, no record); `second` is refused before its body runs. */
async function excludes(state: StateStore, first: Side, second: Side, network: string, account: string): Promise<void> {
  let release!: () => void, entered!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; }), inside = new Promise<void>(resolve => { entered = resolve; });
  const held = first.admit(state, async () => { entered(); await holding; throw new Error("first released"); });
  await inside;
  let ran = false;
  await assert.rejects(second.admit(state, async () => { ran = true; }), (error: { code?: string; details?: Record<string, unknown> }) =>
    error.code === "APN_OPERATION_BLOCKED" && error.details?.blockingState === "admitted" &&
    error.details.blockingNetwork === network && error.details.blockingAccount === account, `${first.name} must refuse ${second.name}`);
  assert.equal(ran, false, `${second.name} ran while ${first.name} held ${network}:${account}`);
  release();
  await assert.rejects(held, /first released/u);
}
async function pair(t: test.TestContext, facadeSide: Side, familySide: Side, network: string, account: string): Promise<void> {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  await excludes(state, facadeSide, familySide, network, account);
  await excludes(state, familySide, facadeSide, network, account);
}

const MATRIX: ReadonlyArray<readonly [Side, Side, string, string]> = [
  [direct(1), swap("eip155:1", A), "evm:1", A], [direct(1), uniswapToken(), "evm:1", A], [direct(1), stargateNative(), "evm:1", A],
  [direct(1), usdt(), "evm:1", A], [direct(1), native(1), "evm:1", A], [direct(1), oneClick("ethereum-eth-to-tron-trx"), "evm:1", A],
  [direct(8453), swap("eip155:8453", A), "evm:8453", A], [direct(8453), circleSource(), "evm:8453", A], [direct(8453), circleApproval(), "evm:8453", A],
  [direct(8453), oneClick("base-usdc-to-tron-usdt"), "evm:8453", A],
  [bridge(10, A), stargateToken(), "evm:10", A], [bridge(10, A), native(10), "evm:10", A],
  [bridge(8453, A), oneClick("base-usdc-to-tron-usdt"), "evm:8453", A], [bridge(8453, A), circleSource(), "evm:8453", A],
  [bridge(8453, A), circleApproval(), "evm:8453", A], [bridge(1, A), stargateNative(), "evm:1", A], [bridge(1, A), uniswapToken(), "evm:1", A],
  [rail("solana", S), swap(`solana:${SOLANA_GENESIS}`, S), `solana:${SOLANA_GENESIS}`, S],
  [bridge(SOLANA_BRIDGE_CHAIN_ID, S), swap(`solana:${SOLANA_GENESIS}`, S), `solana:${SOLANA_GENESIS}`, S],
  [rail("tron", T), swap(`tron:${TRON_GENESIS}`, T), `tron:${TRON_GENESIS}`, T],
];
for (const [facadeSide, familySide, network, account] of MATRIX) {
  test(`${facadeSide.name} and ${familySide.name} exclude each other on ${network} in both orders`, async (t) => {
    await pair(t, facadeSide, familySide, network, account);
  });
}

test("another account on the same network coexists with every family", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  let release!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; });
  const held = direct(1, A).admit(state, async () => { await holding; throw new Error("released"); });
  for (const side of [swap("eip155:1", B), uniswapToken(B), stargateNative(B), usdt(B), native(1, B), oneClick("ethereum-eth-to-tron-trx", B)]) {
    assert.equal(await side.admit(state, async () => side.name), side.name);
  }
  release(); await assert.rejects(held, /released/u);
});

test("a corrupt swap record blocks only the account its bytes still name, not its profile's swaps on another account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const ownerProfileHash = domainHash("apn.swap-quote.v1", `profile\0${PROFILE}`), operationId = next("corrupt-swap");
  await mkdir(join(temporary.root, "swap-operations", ownerProfileHash), { recursive: true, mode: 0o700 });
  await writeFile(join(temporary.root, "swap-operations", ownerProfileHash, `${operationId}.json`), `${canonicalJson({ schemaVersion: "tampered",
    operationId, ownerProfileHash, quote: { profile: PROFILE, account: A, sourceAsset: { chain: "eip155:1" } } })}\n`, { mode: 0o600 });
  assert.equal(await swap("eip155:1", B).admit(state, async () => "other account"), "other account");
  const unreadable = { code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: operationId, blockingReason: "blocking_record_unreadable",
    blockingNetwork: "evm:1", blockingAccount: A } };
  await assert.rejects(swap("eip155:1", A).admit(state, async () => "same account"), unreadable);
  await assert.rejects(new OperationService(state).assertEvmAccountAvailable(state.profileHash(PROFILE), 1, A), unreadable);
  assert.equal((await new OperationIndex(state).find(operationId))?.state, "unreadable");
});

test("the registry covers every money family, each in its own store, and names each new family's generic commands", () => {
  const registry = operationRegistry();
  assert.deepEqual([...registry.keys()].sort(), [...OPERATION_FAMILIES].sort());
  const directories = [...registry.values()].flatMap(adapter => adapter.stores.map(store => store.directory));
  assert.equal(new Set(directories).size, directories.length);
  for (const family of OPERATION_FAMILIES.slice(OPERATION_FAMILIES.indexOf("swap"))) {
    const commands = registry.get(family)?.commands;
    assert.ok(commands !== undefined && [commands.status, commands.resume ?? "", commands.exit ?? ""].filter(Boolean)
      .every(command => command.startsWith("apn ") && command.includes("<operation-id>")), family);
  }
  // The families with an owner exit keep it behind the generic abandon (Circle approval's is phase 4c's exit 3).
  assert.deepEqual(OPERATION_FAMILIES.filter(family => registry.get(family)?.abandon !== undefined && OPERATION_FAMILIES.indexOf(family) >= OPERATION_FAMILIES.indexOf("swap")),
    ["swap", "circle_approval", "metamask_native"]);
});

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const PAST = ago(UNSTARTED_DEADLINE_MARGIN_MS + 60_000), RECENT = ago(60_000);
test("a family holds its account while it can still sign or land, and lets go once it can never start", () => {
  const terminal = (adapter: { terminal(record: never, root: string): boolean | Promise<boolean> }, record: unknown) => adapter.terminal(record as never, "/unused");
  const quote = (expiresAt: string) => ({ profile: PROFILE, account: A, expiresAt, sourceAsset: { chain: "eip155:1" } });
  assert.equal(terminal(swapAdapter, { state: "awaiting_approval", submissionMarker: null, quote: quote(PAST) }), true);
  assert.equal(terminal(swapAdapter, { state: "awaiting_approval", submissionMarker: null, quote: quote(RECENT) }), false, "inside the margin");
  assert.equal(terminal(swapAdapter, { state: "submitted", submissionMarker: {}, quote: quote(PAST) }), false, "a marked swap may land");
  assert.equal(terminal(swapAdapter, { state: "finalized", submissionMarker: {}, quote: quote(RECENT) }), true);
  assert.deepEqual(swapAdapter.claims({ quote: quote(RECENT) } as never)?.map(claim => claim.key), [`evm:1:${A}`, `profile:${sha256(`profile\0${PROFILE}`)}`]);
  const deadline = Math.floor(Date.parse(PAST) / 1000);
  assert.equal(terminal(uniswapTokenAdapter, { phase: "prepared", route: { deadline } }), true);
  assert.equal(terminal(uniswapTokenAdapter, { phase: "approval_submitted", route: { deadline } }), false);
  assert.equal(terminal(uniswapTokenAdapter, { phase: "cleaned", route: { deadline: deadline + 10_000 } }), true);
  assert.equal(terminal(stargateNativeAdapter, { phase: "approved", expiresAt: PAST }), true);
  assert.equal(terminal(stargateNativeAdapter, { phase: "submitted", expiresAt: PAST, transactionHash: `0x${"1".repeat(64)}` }), false);
  assert.equal(terminal(stargateTokenAdapter, { phase: "approved", expiresAt: PAST, approvalTransactionHash: `0x${"1".repeat(64)}` }), false);
  assert.equal(terminal(stargateTokenAdapter, { phase: "prepared", expiresAt: PAST }), true);
  assert.equal(terminal(gaslessUsdtAdapter, { state: "planned" }), false);
  assert.equal(terminal(gaslessUsdtAdapter, { state: "expired_never_landed" }), true);
  assert.equal(terminal(oneClickSourceAdapter, { phase: "sealed", effectiveDeadline: PAST }), true);
  assert.equal(terminal(oneClickSourceAdapter, { phase: "unknown_finality", effectiveDeadline: RECENT }), false, "a sent deposit may still land");
  assert.equal(terminal(oneClickSourceAdapter, { phase: "unknown_finality", effectiveDeadline: PAST }), true, "the family's own nonce rule");
  assert.equal(terminal(oneClickSourceAdapter, { phase: "source_observed", effectiveDeadline: RECENT }), true);
  assert.equal(terminal(circleSourceAdapter, { phase: "submitted_pending", createdAt: RECENT }), false);
  assert.equal(terminal(circleSourceAdapter, { phase: "submitted_pending", createdAt: PAST }), true);
  assert.equal(terminal(circleApprovalAdapter, { phase: "prepared", preparation: { expiresAt: PAST } }), true);
  assert.equal(terminal(circleApprovalAdapter, { phase: "signing_started", preparation: { expiresAt: PAST } }), false);
  assert.equal(terminal(circleApprovalAdapter, { phase: "completed", preparation: { expiresAt: RECENT } }), true);
  const context = (consentExpiresAt: string) => ({ consentExpiresAt, quote: { chainId: 1, sender: A } });
  assert.equal(terminal(metaMaskNativeAdapter, { state: "prepared", effectAttempts: 0, context: context(PAST) }), true);
  assert.equal(terminal(metaMaskNativeAdapter, { state: "effect_started", effectAttempts: 1, context: context(PAST) }), false);
  assert.equal(terminal(metaMaskNativeAdapter, { state: "abandoned_unknown", effectAttempts: 1, context: context(RECENT) }), true);
  // A merchant payment approve never signed (prepared, never approved) cannot sign past its local deadline.
  assert.equal(terminal(merchantAdapter, { state: "prepared", expiresAt: PAST }), true);
  assert.equal(terminal(merchantAdapter, { state: "prepared", expiresAt: RECENT }), false, "inside the margin");
  assert.equal(terminal(merchantAdapter, { state: "signing_started", expiresAt: PAST }), false, "signed bytes may exist");
});

test("observe ends a Permit2 authorization never exposed once its deadline passed, frees its hold and its claims", async (t) => {
  const f = await journalFixture(t), id = f.record.operationId, index = new OperationIndex(new StateStore(f.root));
  const observe = async () => await executeBoundCommand(bindArgv(["x402", "permit2", "observe", "--operation", id, "--rpc-url", "https://avax.example"]),
    { stateRoot: f.root, clock: { now: f.now } });
  assert.deepEqual([f.reserved.state, f.reserved.exposureAt, (await index.find(id))?.state], ["reserved", null, "active"]);
  const early = await observe();
  assert.equal((early.data as { code: string }).code, "not_exposed", "the deadline still holds");
  assert.equal((await f.journal.findOperation(id))?.state, "reserved");
  f.advance(120);
  const ended = await observe();
  assert.deepEqual([(ended.data as { code: string }).code, (await f.journal.findOperation(id))?.state], ["terminal", "released_unsubmitted"]);
  assert.equal((await f.lease()).state, "released_unsubmitted");
  assert.deepEqual([(await index.find(id))?.state, (await index.find(id))?.claims], ["terminal", []]);
  assert.equal(await permit2Adapter.terminal({ ...f.reserved, state: "exposure_unknown", exposureAt: f.reserved.updatedAt }, f.root), false);
});
