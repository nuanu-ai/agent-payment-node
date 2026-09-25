import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { PaymentRequired } from "@x402/core/types";
import { ApnError } from "../../src/errors.js";
import { temporaryState } from "./helpers.js";
import { Permit2ExecutionIntentJournal, type Permit2IntentInput, type Permit2IntentReadPort } from
  "../../src/x402-permit2/execution-intent.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { hashChallenge, preparePermit2Payment, type Permit2PrepareInput } from "../../src/x402-permit2/prepare.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from
  "../../src/x402-permit2/registry.js";

const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as
  { accepts: unknown[] }).accepts;
const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as `0x${string}`;
const challenge: PaymentRequired = { x402Version: 2, resource: { url: "https://seller.example/data" },
  accepts: accepts as PaymentRequired["accepts"] };
const selection = selectPermit2Offer(accepts, payer);
const original: Permit2PrepareInput = {
  payer, localWallet: true, challenge,
  expected: { index: selection.index, requirement: selection.requirement, challengeHash: hashChallenge(challenge) },
  owner: { active: true, account: payer, chain: asset.chain, token: asset.token, rail: "x402",
    mechanism: X402_PERMIT2_MECHANISM, maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000",
    usedTodayAtomic: "5000", policyDigest: "a".repeat(64) },
  evidence: { chainId: 43114, account: payer, observedAtSeconds: 1_789_719_995,
    balanceAtomic: "20000", allowanceAtomic: "10000", tokenDomainSeparator: asset.tokenDomainSeparator,
    proxyCodeHash: asset.proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: "0",
    nonceBitmapWord: `0x${"0".repeat(64)}`, eip2612Nonce: null,
    facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
      assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
      eip2612GasSponsoring: false } }, nowSeconds: 1_789_720_000, nonce: 7n,
};
const prepared = preparePermit2Payment(original);
const request: Permit2IntentInput = { profile: "owner", idempotencyKey: "permit2-test-key-001", prepared,
  challenge, merchantOrigin: "https://seller.example", resourceUrl: "https://seller.example/data",
  facilitatorEndpoint: "https://facilitator.payai.network", minimumGasAtomic: "100", nowSeconds: 1_789_720_005 };
const port = (changes: Partial<Awaited<ReturnType<Permit2IntentReadPort["read"]>>> = {}): Permit2IntentReadPort =>
  ({ read: async () => ({ owner: original.owner,
    evidence: { ...original.evidence, observedAtSeconds: request.nowSeconds }, gasBalanceAtomic: "1000",
    binding: { walletProfile: "owner", walletAccount: payer, policyProfile: "owner",
      policyDigest: original.owner.policyDigest },
    facilitatorEndpoint: request.facilitatorEndpoint, ...changes }) });
const errorCode = (code: string) => (error: unknown) => error instanceof ApnError && error.code === code;

test("concurrent identical intent is one durable blocked operation with an intended reservation", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const a = new Permit2ExecutionIntentJournal(state.root), b = new Permit2ExecutionIntentJournal(state.root);
  const [first, second] = await Promise.all([a.create(request, port()), b.create(request, port())]);
  assert.deepEqual(first, second);
  assert.equal(first.capability, "execution_blocked");
  assert.equal(first.reservationState, "intended");
  assert.equal(first.token, asset.token);
  assert.equal(first.merchantOrigin, request.merchantOrigin);
  assert.match(first.typedDataDigest, /^0x[0-9a-f]{64}$/u);
  assert.deepEqual(await b.load(first.operationId), first);
});

test("changed material conflicts and tampered chain, recipient, digest, domain or merchant refuse", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  const first = await journal.create(request, port());
  await assert.rejects(journal.create({ ...request, minimumGasAtomic: "101" }, port()), errorCode("APN_IDEMPOTENCY_CONFLICT"));
  for (const altered of [
    { ...prepared, chain: "eip155:1" as typeof prepared.chain },
    { ...prepared, payTo: payer },
    { ...prepared, plan: { ...prepared.plan, permit2: { ...prepared.plan.permit2,
      domain: { ...prepared.plan.permit2.domain, chainId: 1 } } } },
    { ...prepared, plan: { ...prepared.plan, authorization: { ...prepared.plan.authorization, nonce: "8" } } },
  ]) await assert.rejects(journal.create({ ...request, idempotencyKey: "permit2-tamper-key-002", prepared: altered }, port()),
    errorCode("APN_OPERATION_BLOCKED"));
  await assert.rejects(journal.create({ ...request, merchantOrigin: "https://attacker.example" }, port()),
    errorCode("APN_OPERATION_BLOCKED"));
  await assert.rejects(journal.create({ ...request, idempotencyKey: "permit2-facilitator-003" },
    port({ facilitatorEndpoint: "https://other.example" })), errorCode("APN_OPERATION_BLOCKED"));
  assert.deepEqual(await journal.load(first.operationId), first);
});

test("insufficient token or gas and stale policy leave no partial intent or reservation", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  await assert.rejects(journal.create(request, port({ evidence: { ...original.evidence,
    observedAtSeconds: request.nowSeconds, balanceAtomic: "9999" } })), errorCode("APN_X402_UNSUPPORTED_OFFER"));
  await assert.rejects(journal.create(request, port({ gasBalanceAtomic: "99" })), errorCode("APN_INSUFFICIENT_GAS"));
  await assert.rejects(journal.create(request, port({ owner: { ...original.owner, policyDigest: "b".repeat(64) } })),
    errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("owner", request.idempotencyKey)), null);
});

test("two profiles cannot journal owner A material under profile B", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  const other = { ...request, profile: "other-owner" };
  await assert.rejects(journal.create(other, port()), errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("other-owner", request.idempotencyKey)), null);
  // A forged label for the other profile still fails when its authenticated wallet is distinct.
  await assert.rejects(journal.create(other, port({ binding: { walletProfile: "other-owner",
    walletAccount: "0x1111111111111111111111111111111111111111", policyProfile: "other-owner",
    policyDigest: original.owner.policyDigest } })), errorCode("APN_OPERATION_BLOCKED"));
  assert.equal(await journal.load(journal.operationId("other-owner", request.idempotencyKey)), null);
});

test("first use syncs the journal parent before publication and retries after a failed sync", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  class FailingFirstSync extends Permit2ExecutionIntentJournal {
    attempts = 0;
    protected override async syncIntentDirectoryParent(): Promise<void> {
      this.attempts++;
      if (this.attempts === 1) throw new Error("directory fsync unavailable");
      await super.syncIntentDirectoryParent();
    }
  }
  const journal = new FailingFirstSync(state.root);
  let reads = 0;
  const reader: Permit2IntentReadPort = { read: async (input) => {
    reads++;
    return port().read(input);
  } };
  await assert.rejects(journal.create(request, reader), errorCode("APN_STATE_SECURITY"));
  assert.equal(reads, 0);
  assert.deepEqual(await readdir(join(state.root, "permit2-intents")), []);
  const result = await journal.create(request, reader);
  assert.equal(result.capability, "execution_blocked");
  assert.ok(journal.attempts >= 2);
  assert.equal(reads, 1);
});

test("read only prepare creates no operation and has no paid outcome", async (t) => {
  const state = await temporaryState(); t.after(state.cleanup);
  const journal = new Permit2ExecutionIntentJournal(state.root);
  assert.equal(preparePermit2Payment(original).prepareHash, prepared.prepareHash);
  assert.equal(await journal.load(journal.operationId("owner", request.idempotencyKey)), null);
  const intent = await journal.create(request, port());
  assert.equal("paid" in intent, false);
  assert.equal("signature" in intent, false);
  assert.equal("transactionHash" in intent, false);
});
