import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli.js";
import { decodePermit2PaymentSignatureHeader } from "../../src/x402-codec.js";
import { TtyPermit2ForegroundApproval, type Permit2ApprovalDisplay } from "../../src/x402-permit2/production-approval.js";
import { Permit2ProductionRepository, permit2ProductionId } from "../../src/x402-permit2/production-repository.js";
import { X402_EXACT_PERMIT2_PROXY, X402_EXACT_PERMIT2_PROXY_CODE_HASH, canonicalPermit2Code } from "../../src/x402-permit2/registry.js";
import { inspectPermit2Offer } from "../../src/x402-permit2/inspection.js";
import { BASE_USDC, SELLER_URL, baseChallenge, baseFixture, permit2RuntimeFor } from "./x402-permit2-any-chain-fixture.js";

const RPC = "https://8.8.8.8/base-rpc";
const KEY = "base-permit2-key-0001";
type Fixture = Awaited<ReturnType<typeof baseFixture>>;
const approve = (f: Fixture) => runCli(["x402", "permit2", "approve", "--profile", "owner", "--url", SELLER_URL, "--rpc-url", RPC, "--idempotency-key", KEY], {},
  { stateRoot: f.root, native: f.native, wrappingSecret: f.wrapping, clock: { now: f.now } });

test("Permit2 runtime is recognised on any chain by its template and own immutables, never another chain's", () => {
  for (const chainId of [1, 10, 56, 137, 143, 480, 8453, 42161, 42220, 43114]) {
    assert.equal(canonicalPermit2Code(permit2RuntimeFor(chainId), chainId), true, String(chainId));
    assert.equal(canonicalPermit2Code(permit2RuntimeFor(chainId), chainId === 1 ? 10 : 1), false);
  }
  assert.equal(canonicalPermit2Code(`${permit2RuntimeFor(8453)}00`, 8453), false);
});

test("Base USDC offered only through Permit2 pays end to end: owner row, chain-verified contracts, one signature bundle, one paid GET, finalized nonce proof", async (t) => {
  const f = await baseFixture(t); const displays: Permit2ApprovalDisplay[] = [];
  // Trusted synthetic consent fixture only; it does not establish actual human approval.
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async (display: Permit2ApprovalDisplay) => { displays.push(display); });
  const result = await approve(f);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(displays.length, 1);
  assert.equal(displays[0]!.chain, "eip155:8453"); assert.equal(displays[0]!.token, BASE_USDC); assert.equal(displays[0]!.tokenUnit, "USDC, 6 decimals");
  assert.equal(f.paid.length, 1);
  // The seller lists Base USDC first by EIP-3009: the Permit2 command pays only the Permit2 offer (index 1).
  const payload = decodePermit2PaymentSignatureHeader(f.paid[0]!.signature);
  assert.equal(payload.accepted.network, "eip155:8453"); assert.equal((payload.accepted.extra as { assetTransferMethod?: string }).assetTransferMethod, "permit2");
  const authorization = payload.payload.permit2Authorization as { readonly permitted: { readonly token: string }; readonly spender: string };
  assert.equal(authorization.permitted.token, BASE_USDC);
  assert.equal(authorization.spender, X402_EXACT_PERMIT2_PROXY);
  assert.equal(payload.extensions, undefined, "the existing allowance pays; no token permit is signed");
  const saved = (await new Permit2ProductionRepository(f.root).findOperation(permit2ProductionId("owner", KEY)))!;
  assert.equal(saved.state, "settled");
  assert.equal(saved.material.owner.chain, "eip155:8453");
  assert.deepEqual({ ...saved.material.asset, networkName: undefined }, { chain: "eip155:8453", chainId: 8453, networkName: undefined, token: BASE_USDC,
    symbol: "USDC", decimals: 6, tokenDomain: { name: "USD Coin", version: "2" }, tokenDomainSeparator: null, proxyCodeHash: X402_EXACT_PERMIT2_PROXY_CODE_HASH });
  // Pre-sign facts are read at the newest block; settlement is proven at the finalized one; every read named chain 8453.
  const tags = f.calls.filter((call) => call.method === "eth_getBlockByNumber").map((call) => call.params[0]);
  assert.ok(tags.includes("latest")); assert.ok(tags.includes("finalized"));
  assert.equal(f.calls.filter((call) => call.method === "eth_getCode").length >= 2, true);
  assert.equal(f.calls.some((call) => /send|sign/iu.test(call.method)), false);
});

test("a Base chain+token the owner did not admit for Permit2 is refused before any RPC, key or paid request", async (t) => {
  const f = await baseFixture(t, "none");
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { throw new Error("No approval prompt"); });
  const result = await approve(f);
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_X402_UNSUPPORTED_OFFER");
  assert.equal(f.paid.length, 0); assert.equal(f.calls.length, 0);
});

test("an RPC presenting another chain's Permit2 runtime holds before approval, signature or paid request", async (t) => {
  const f = await baseFixture(t); f.wire.permit2Code = permit2RuntimeFor(43114);
  t.mock.method(TtyPermit2ForegroundApproval.prototype, "approve", async () => { throw new Error("No approval prompt"); });
  const result = await approve(f);
  assert.equal(result.ok, false); assert.equal(f.paid.length, 0);
  assert.equal(await new Permit2ProductionRepository(f.root).findOperation(permit2ProductionId("owner", KEY)), null);
});

test("inspect shows the lowest-index Permit2 offer on any EVM chain without owner state", () => {
  const offer = inspectPermit2Offer({ accepts: baseChallenge().accepts, payer: "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" });
  assert.equal(offer.index, 1); assert.equal(offer.network, "eip155:8453"); assert.equal(offer.asset, BASE_USDC);
});
