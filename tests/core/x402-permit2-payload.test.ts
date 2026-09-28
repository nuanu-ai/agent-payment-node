import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { isPermit2Payload } from "@x402/evm";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { assemblePermit2PaymentPayload } from "../../src/x402-permit2/payload.js";
import { hashChallenge, preparePermit2Payment, type Permit2PrepareInput } from "../../src/x402-permit2/prepare.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import type { Permit2ExecutionIntent } from "../../src/x402-permit2/execution-intent.js";
import type { PaymentRequired } from "@x402/core/types";

const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
const asset = X402_PERMIT2_ASSETS[0]!;
const accepts = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as
  { accepts: PaymentRequired["accepts"] }).accepts;
const declaration = { info: { description: "EIP-2612", version: "1" }, schema: {
  $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
  properties: Object.fromEntries(["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"]
    .map(field => [field, { type: "string", pattern: ".+" }])),
  required: ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"],
} };
function fixture(sponsored: boolean) {
  const challenge: PaymentRequired = { x402Version: 2, resource: { url: "https://seller.example/data" }, accepts,
    ...(sponsored ? { extensions: { eip2612GasSponsoring: declaration } } : {}) };
  const selection = selectPermit2Offer(challenge.accepts, account.address);
  const input: Permit2PrepareInput = { payer: account.address, localWallet: true, challenge,
    expected: { index: selection.index, requirement: selection.requirement, challengeHash: hashChallenge(challenge) },
    owner: { active: true, account: account.address, chain: asset.chain, token: asset.token, rail: "x402",
      mechanism: X402_PERMIT2_MECHANISM, maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000",
      usedTodayAtomic: "0", policyDigest: "a".repeat(64) },
    evidence: { chainId: 43114, account: account.address, observedAtSeconds: 1_789_720_000,
      balanceAtomic: "20000", allowanceAtomic: sponsored ? "0" : "10000", tokenDomainSeparator: asset.tokenDomainSeparator,
      proxyCodeHash: asset.proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: "0",
      nonceBitmapWord: `0x${"0".repeat(64)}`, eip2612Nonce: sponsored ? "9" : null,
      facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
        assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
        eip2612GasSponsoring: sponsored } }, nowSeconds: 1_789_720_000, nonce: 7n };
  const prepared = preparePermit2Payment(input);
  const schemaVersion = "apn.x402-permit2.execution-intent.v1" as const;
  const body = { schemaVersion, operationId: "1".repeat(64), idempotencyHash: "2".repeat(64),
    profileHash: "3".repeat(64), requestHash: "4".repeat(64), prepareHash: prepared.prepareHash,
    challengeHash: prepared.challengeHash, merchantOrigin: "https://seller.example", resourceUrl: challenge.resource.url,
    facilitatorEndpoint: "https://facilitator.payai.network" as const, chain: prepared.chain, token: prepared.token,
    owner: prepared.payer, recipient: prepared.payTo, amountAtomic: prepared.amountAtomic,
    permit2Contract: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
    typedDataDigest: hashTypedData(prepared.plan.permit2 as Parameters<typeof hashTypedData>[0]),
    eip2612Digest: prepared.plan.eip2612 === null ? null :
      hashTypedData(prepared.plan.eip2612.typedData as Parameters<typeof hashTypedData>[0]),
    nonce: prepared.plan.authorization.nonce, deadline: prepared.expiresAtUnix, policyDigest: prepared.policyDigest,
    reservationId: "5".repeat(64), reservationState: "intended" as const, capability: "execution_blocked" as const,
    createdAtUnix: 1_789_720_005 };
  const intent: Permit2ExecutionIntent = { ...body, integrityHash: domainHash(schemaVersion, canonicalJson(body)) };
  return { challenge, prepared, intent };
}
async function signed(sponsored: boolean) {
  const values = fixture(sponsored);
  const permit2Signature = await account.signTypedData(values.prepared.plan.permit2 as Parameters<typeof account.signTypedData>[0]);
  const eip2612Signature = values.prepared.plan.eip2612 === null ? undefined :
    await account.signTypedData(values.prepared.plan.eip2612.typedData as Parameters<typeof account.signTypedData>[0]);
  return { ...values, permit2Signature, ...(eip2612Signature === undefined ? {} : { eip2612Signature }),
    nowSeconds: 1_789_720_010 };
}
const rejected = (error: unknown) => error instanceof ApnError;

test("assembles exact v2 Permit2 header accepted by official decoder and EVM type guard", async () => {
  const input = await signed(false);
  const result = await assemblePermit2PaymentPayload(input);
  assert.deepEqual(decodePaymentSignatureHeader(result.paymentSignatureHeader), result.payload);
  assert.equal(isPermit2Payload(result.payload.payload as Parameters<typeof isPermit2Payload>[0]), true);
  assert.deepEqual(result.payload.accepted, input.prepared.plan.selection.requirement);
  assert.equal(result.payload.extensions, undefined);
});

test("includes exact EIP-2612 info only when the plan requires it", async () => {
  const input = await signed(true);
  const result = await assemblePermit2PaymentPayload(input);
  assert.deepEqual(decodePaymentSignatureHeader(result.paymentSignatureHeader), result.payload);
  assert.deepEqual((result.payload.extensions as any).eip2612GasSponsoring.info,
    { ...input.prepared.plan.eip2612!.info, signature: input.eip2612Signature });
  const { eip2612Signature: _omitted, ...withoutPermitSignature } = input;
  await assert.rejects(assemblePermit2PaymentPayload(withoutPermitSignature), rejected);
});

test("refuses changed intent, merchant, typed data, signatures and expired deadline", async () => {
  const input = await signed(false);
  const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
  const wrongPayerSignature = await other.signTypedData(input.prepared.plan.permit2 as Parameters<typeof other.signTypedData>[0]);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, nowSeconds: Number(input.intent.deadline) }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, permit2Signature: undefined as never }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, permit2Signature: wrongPayerSignature }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, eip2612Signature: input.permit2Signature }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, challenge: { ...input.challenge, resource: { url: "https://evil.example/data" } } }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, prepared: { ...input.prepared, amountAtomic: "9999" } }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, prepared: { ...input.prepared, plan: { ...input.prepared.plan,
    permit2: { ...input.prepared.plan.permit2, domain: { ...input.prepared.plan.permit2.domain, chainId: 1 } } } } }), rejected);
  await assert.rejects(assemblePermit2PaymentPayload({ ...input, intent: { ...input.intent, recipient: account.address } }), rejected);
});
