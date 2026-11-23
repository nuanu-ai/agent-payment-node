import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { decodeFunctionData, parseAbi, parseTransaction, type Hex } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { BNB_UNISWAP_MECHANISM_PIN, BNB_UNISWAP_SWAP_ROUTER_02, BNB_USDC, BNB_USDT, BNB_WBNB } from "../../src/swap/uniswap-bnb/pins.js";
import { occupiedBnbUniswapTokenNonces, occupiedUniswapTokenNonces } from "../../src/swap/uniswap-v3/token-nonce-ownership.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { UniswapTokenJournal, type UniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { uniswapTokenNextActions } from "../../src/swap/uniswap-command-service.js";
import { temporaryState } from "./helpers.js";
import { activateBnbTokenPolicy, BNB_TOKEN_ACCOUNT, BNB_TOKEN_AMOUNT_IN, BNB_TOKEN_PROFILE, BNB_TOKEN_QUOTES, BnbTokenChain, bnbTokenQuoteRequest,
  bnbTokenRuntime, bnbTokenWallet, typingTerminal } from "./uniswap-bnb-token-helpers.js";

const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const blocked = (reason: string) => (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === reason;
/** Each reviewed direction: its input, the quote's `--output-token`, the pool's output token, the measured quote and a floor below it. */
const DIRECTIONS = [
  { name: "USDT to BNB", input: BNB_USDT, output: "native", poolOutput: BNB_WBNB, quoted: BNB_TOKEN_QUOTES.usdtToBnb, minimum: "17000000000000000" },
  { name: "USDC to BNB", input: BNB_USDC, output: "native", poolOutput: BNB_WBNB, quoted: BNB_TOKEN_QUOTES.usdcToBnb, minimum: "17000000000000000" },
  { name: "USDT to USDC", input: BNB_USDT, output: BNB_USDC, poolOutput: BNB_USDC, quoted: BNB_TOKEN_QUOTES.usdtToUsdc, minimum: "9900000000000000000" },
  { name: "USDC to USDT", input: BNB_USDC, output: BNB_USDT, poolOutput: BNB_USDT, quoted: BNB_TOKEN_QUOTES.usdcToUsdt, minimum: "9900000000000000000" },
] as const;
type Direction = (typeof DIRECTIONS)[number];

/** Quote, prepare and the foreground exact approval of one direction; the approval is then observed at its safe block. */
async function approved(t: TestContext, direction: Direction) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(), policy = await activateBnbTokenPolicy(temporary.root, now), { state, wrapping } = await bnbTokenWallet(temporary.root);
  const chain = new BnbTokenChain(direction.input, direction.poolOutput, direction.quoted), terminal = typingTerminal();
  const runtime = (foreground: "approve" | "cleanup" | "refuse") => bnbTokenRuntime({ state, wrapping, chain, now, foreground, tty: terminal.tty });
  const quote = await runtime("refuse").quote(bnbTokenQuoteRequest(now, direction.input, direction.output, direction.minimum)) as { readonly quoteHash: string;
    readonly policyDigest: string };
  assert.equal(quote.policyDigest, policy.policyDigest);
  let op = await runtime("refuse").prepare({ command: "swap.uniswap-bnb-token.prepare", profile: BNB_TOKEN_PROFILE, quoteHash: quote.quoteHash,
    idempotencyKey: "bnb-token-flow-0001" });
  assert.equal(op.phase, "prepared");
  op = await runtime("approve").approve(op.operationId);
  assert.equal(op.phase, "approval_submitted", op.cleanupReason ?? undefined);
  const approval = parseTransaction(chain.sends[0]!);
  assert.deepEqual([approval.type, approval.chainId, approval.to?.toLowerCase(), approval.value ?? 0n, approval.nonce],
    ["eip1559", 56, direction.input.toLowerCase(), 0n, 7]);
  assert.deepEqual(decodeFunctionData({ abi: ERC20, data: approval.data! }).args, [BNB_UNISWAP_SWAP_ROUTER_02, BigInt(BNB_TOKEN_AMOUNT_IN)]);
  chain.allowance = BigInt(BNB_TOKEN_AMOUNT_IN); chain.observe(op, "approval", 1);
  op = await runtime("refuse").status(op.operationId);
  assert.equal(op.phase, "approval_observed");
  chain.clearObservation();
  return { root: temporary.root, state, wrapping, chain, terminal, runtime, op, now };
}

for (const direction of DIRECTIONS) {
  test(`${direction.name}: exact approval of SwapRouter02, one swap on chain 56 and its receipt proof`, async (t) => {
    const flow = await approved(t, direction), { chain, terminal, runtime } = flow;
    // The approval screen names the network, both assets at 18 decimals, the router and the pool.
    const screen = terminal.screens[0]!;
    for (const part of ["Agent Payment Node Uniswap V3 token swap approval (BNB Smart Chain)", "Network: BNB Smart Chain (eip155:56)",
      `Exact input: ${BNB_TOKEN_AMOUNT_IN} atomic (18 decimals) of`, `Router: ${BNB_UNISWAP_SWAP_ROUTER_02} (SwapRouter02)`,
      direction.output === "native" ? `wei of native BNB (the router unwraps WBNB ${BNB_WBNB})` : `atomic (18 decimals) of`]) assert.ok(screen.includes(part), part);
    let op = await runtime("refuse").execute(flow.op.operationId);
    assert.equal(op.phase, "submitted", op.cleanupReason ?? undefined);
    const swap = parseTransaction(chain.sends[1]!);
    assert.deepEqual([swap.type, swap.chainId, swap.to?.toLowerCase(), swap.value ?? 0n, swap.nonce, swap.data],
      ["eip1559", 56, BNB_UNISWAP_SWAP_ROUTER_02.toLowerCase(), 0n, 8, op.route.calldata]);
    chain.allowance = 0n; chain.observe(op, "swap", 1);
    op = await runtime("refuse").status(op.operationId);
    assert.equal(op.phase, "observed");
    assert.deepEqual([op.receipt?.inputDebitAtomic, op.receipt?.outputCreditAtomic, op.receipt?.residualAllowanceAtomic, op.usageState],
      [BNB_TOKEN_AMOUNT_IN, direction.quoted.toString(), "0", "finalized"]);
    // The principal is charged to the BNB token's own usage; the BNB lane's nonces stay out of the Ethereum lane's space.
    const usage = await new AssetUsageLedger(flow.root).usage({ account: BNB_TOKEN_ACCOUNT, chain: "eip155:56", asset: { kind: "token", identifier: direction.input } }, flow.now);
    assert.equal(usage.amountAtomic, BNB_TOKEN_AMOUNT_IN);
    assert.deepEqual([...await occupiedBnbUniswapTokenNonces(flow.root, BNB_TOKEN_ACCOUNT)].sort(), [7n, 8n]);
    assert.deepEqual(await occupiedUniswapTokenNonces(flow.root, BNB_TOKEN_ACCOUNT), []);
    assert.equal(chain.sends.length, 2);
  });
}

test("a reverted BNB swap requires the owner's cleanup, which revokes SwapRouter02 to zero on chain 56", async (t) => {
  const flow = await approved(t, DIRECTIONS[0]), { chain, terminal, runtime } = flow;
  let op = await runtime("refuse").execute(flow.op.operationId);
  assert.equal(op.phase, "submitted");
  chain.observe(op, "swap", 0);
  op = await runtime("refuse").status(op.operationId);
  assert.deepEqual([op.phase, op.cleanupReason, op.usageState], ["cleanup_required", "swap_reverted", "failed_confirmed_revert"]);
  assert.deepEqual(uniswapTokenNextActions(op), [`apn swap bnb uniswap-token cleanup --operation ${op.operationId}`]);
  chain.clearObservation();
  op = await runtime("cleanup").cleanup(op.operationId);
  assert.equal(op.phase, "cleanup_submitted");
  const cleanup = parseTransaction(chain.sends[2]!);
  assert.deepEqual([cleanup.chainId, cleanup.to?.toLowerCase(), cleanup.nonce], [56, BNB_USDT.toLowerCase(), 9]);
  assert.deepEqual(decodeFunctionData({ abi: ERC20, data: cleanup.data! }).args, [BNB_UNISWAP_SWAP_ROUTER_02, 0n]);
  const screen = terminal.screens[1]!;
  for (const part of ["Agent Payment Node Uniswap token allowance cleanup (BNB Smart Chain)", `Token/spender: USDT ${BNB_USDT} / ${BNB_UNISWAP_SWAP_ROUTER_02}`,
    "Replacement allowance: 0", "Reason: swap_reverted"]) assert.ok(screen.includes(part), part);
  chain.allowance = 0n; chain.observe(op, "cleanup", 1);
  op = await runtime("refuse").status(op.operationId);
  assert.equal(op.phase, "cleaned");
  assert.equal(chain.sends.length, 3);
});

test("BNB refusals: a native swap without the router's unwrap, another lane's runtime, and a quote of another lane", async (t) => {
  const flow = await approved(t, DIRECTIONS[1]), { chain, runtime } = flow;
  let op: UniswapTokenOperation = await runtime("refuse").execute(flow.op.operationId);
  assert.equal(op.phase, "submitted");
  // The receipt proves the native credit only by the router's one WBNB Withdrawal; a receipt without it is refused.
  chain.allowance = 0n; chain.observe(op, "swap", 1, null);
  await assert.rejects(runtime("refuse").status(op.operationId), blocked("uniswap_token_unwrap_conflict"));
  op = (await new UniswapTokenJournal(flow.root).load(op.operationId))!;
  assert.equal(op.phase, "submitted");
  // The Ethereum token runtime refuses this BNB operation before any read and names the BNB command.
  const ethereum = createUniswapTokenRuntime({ state: flow.state, wrapping: flow.wrapping, clock: { now: () => flow.now }, call: chain.call(), foreground: "refuse",
    verifyPins: async () => undefined });
  const before = chain.chainCalls.length;
  await assert.rejects(ethereum.status(op.operationId), (error: any) => blocked("uniswap_token_lane_mismatch")(error) &&
    error.details?.nextActions?.[0] === `apn swap bnb uniswap-token status --operation ${op.operationId}`);
  assert.equal(chain.chainCalls.length, before);
  // A saved BNB quote is not the Ethereum lane's to prepare, nor the BNB lane's under the Ethereum command.
  const fresh = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb);
  const bnb = bnbTokenRuntime({ state: flow.state, wrapping: flow.wrapping, chain: fresh, now: flow.now, foreground: "refuse" });
  const quote = await bnb.quote(bnbTokenQuoteRequest(flow.now, BNB_USDT, "native", "17000000000000000")) as { readonly quoteHash: string };
  await assert.rejects(ethereum.prepare({ command: "swap.uniswap-token.prepare", profile: BNB_TOKEN_PROFILE, quoteHash: quote.quoteHash,
    idempotencyKey: "bnb-token-cross-0001" }), blocked("uniswap_token_quote_binding"));
  await assert.rejects(bnb.prepare({ command: "swap.uniswap-token.prepare", profile: BNB_TOKEN_PROFILE, quoteHash: quote.quoteHash,
    idempotencyKey: "bnb-token-cross-0002" }), blocked("uniswap_token_quote_binding"));
});

test("BNB owner admission: native BNB must be admitted, with the token lane's own route", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(), { state, wrapping } = await bnbTokenWallet(temporary.root);
  const request = bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000");
  const refusal = (gap: string, side: string, asset: string) => (error: any) => blocked("swap_owner_admission_required")(error) &&
    error.details?.admissionGap === gap && error.details?.side === side && error.details?.chain === "eip155:56" && error.details?.asset === asset &&
    error.details?.nextActions?.includes("apn swap bnb uniswap-token inventory");
  await activateBnbTokenPolicy(temporary.root, now, undefined, ["usdt", "usdc"]);
  const chain = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb);
  await assert.rejects(bnbTokenRuntime({ state, wrapping, chain, now, foreground: "refuse" }).quote(request), refusal("asset_not_listed", "destination", "native"));
  // The native BNB lane's route (two pools, no USDT/USDC pool) does not admit token input.
  await activateBnbTokenPolicy(temporary.root, now, BNB_UNISWAP_MECHANISM_PIN);
  await assert.rejects(bnbTokenRuntime({ state, wrapping, chain, now, foreground: "refuse" }).quote(request), refusal("swap_route_not_admitted", "source", BNB_USDT));
  await activateBnbTokenPolicy(temporary.root, now);
  const quote = await bnbTokenRuntime({ state, wrapping, chain, now, foreground: "refuse" }).quote(request) as { readonly route: { readonly output: string } };
  assert.equal(quote.route.output, "native");
});

test("a BNB token runtime refuses a chain-1 RPC before it reads anything else", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const now = new Date(); await activateBnbTokenPolicy(temporary.root, now); const { state, wrapping } = await bnbTokenWallet(temporary.root);
  const chain = new BnbTokenChain(BNB_USDT, BNB_WBNB, BNB_TOKEN_QUOTES.usdtToBnb); chain.chainId = "0x1";
  await assert.rejects(bnbTokenRuntime({ state, wrapping, chain, now, foreground: "refuse" }).quote(bnbTokenQuoteRequest(now, BNB_USDT, "native", "17000000000000000")),
    { code: "APN_CHAIN_MISMATCH" });
  assert.deepEqual(chain.chainCalls, ["eth_chainId", "eth_getBlockByNumber"]);
  assert.equal((chain.sends as Hex[]).length, 0);
});
