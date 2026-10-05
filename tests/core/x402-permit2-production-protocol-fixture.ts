import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "../../src/canonical.js";
import { assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { checkPermit2Challenge } from "../../src/x402-permit2/checked-challenge.js";
import { createPermit2ProductionMaterial, reconstructPermit2ProductionMaterial, PERMIT2_PRODUCTION_SCHEMA } from "../../src/x402-permit2/production-material.js";
import { sealPermit2ProductionRecord, productionUsageKey, permit2ProductionId } from "../../src/x402-permit2/production-repository.js";
import { createPermit2ProductionSigned } from "../../src/x402-permit2/production-signed.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import type { X402PaymentRequired } from "../../src/x402-codec.js";

export const testPayer = privateKeyToAccount(`0x${"1".repeat(64)}`);
export const protocolSecond = 1_789_720_000;
export async function protocolFixture(sponsor = false) {
  const asset = X402_PERMIT2_ASSETS[0]!, account = testPayer.address, date = new Date(protocolSecond * 1000).toISOString();
  const challenge: X402PaymentRequired = { x402Version: 2,
    resource: { url: "https://seller.example/private-path?private=hidden", description: "Private resource", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: asset.chain, asset: asset.token, amount: "10000",
      payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: "permit2", ...asset.tokenDomain } }],
    ...(sponsor ? { extensions: { eip2612GasSponsoring: { info: { description: "EIP-2612", version: "1" }, schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
      properties: Object.fromEntries(["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"]
        .map(name => [name, { type: "string", pattern: ".*" }])),
      required: ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"],
    } } } } : {}) };
  const material = createPermit2ProductionMaterial({ checked: checkPermit2Challenge(challenge, {
    schemaVersion: "apn.http-request.v1", url: challenge.resource.url, method: "POST",
    headers: { "x-private-header": "private-header-value" }, bodyBase64: Buffer.from("private-body").toString("base64") }),
    wallet: { profile: "owner", profileHash: sha256("profile\0owner"), account, bindingHash: "b".repeat(64), provider: "local",
      providerRecordDigest: null, walletChainId: 8453, walletCreatedAt: date },
    checkpoint: { policyRevision: 1, registryVersion: "fixture-v1", activationDigest: "c".repeat(64), blockNumber: "42",
      blockHash: `0x${"d".repeat(64)}`, blockTimestamp: protocolSecond, facilitatorSupportedDigest: "e".repeat(64) },
    owner: { active: true, account, chain: asset.chain, token: asset.token, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", usedTodayAtomic: "0", policyDigest: "a".repeat(64) },
    evidence: { chainId: 43114, account, observedAtSeconds: protocolSecond, balanceAtomic: "20000",
      allowanceAtomic: sponsor ? "0" : "10000", tokenDomainSeparator: asset.tokenDomainSeparator, proxyCodeHash: asset.proxyCodeHash,
      permit2Deployed: true, nonceBitmapWordIndex: "0", nonceBitmapWord: `0x${"0".repeat(64)}`, eip2612Nonce: sponsor ? "9" : null,
      facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token, assetTransferMethod: "permit2",
        permit2Address: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY, eip2612GasSponsoring: sponsor } },
    signingSecond: protocolSecond, nonce: "7" });
  const operationId = permit2ProductionId("owner", "protocol-fixture-key");
  const record = sealPermit2ProductionRecord({ schemaVersion: PERMIT2_PRODUCTION_SCHEMA, operationId,
    profileHash: material.wallet.profileHash, idempotencyHash: "1".repeat(64), requestHash: "2".repeat(64), material,
    createdAt: date, updatedAt: date, state: "prepared", terminal: false, reservationStarted: false,
    usageReservationId: assetUsageReservationId({ account, chain: asset.chain, asset: { kind: "token", identifier: asset.token } }, productionUsageKey(operationId)),
    usageReservationDigest: null, exposureAt: null, releaseDigest: null });
  const prepared = reconstructPermit2ProductionMaterial(material);
  const permit2Signature = await testPayer.signTypedData(prepared.plan.permit2 as Parameters<typeof testPayer.signTypedData>[0]);
  const eip2612Signature = prepared.plan.eip2612 === null ? null : await testPayer.signTypedData(prepared.plan.eip2612.typedData as Parameters<typeof testPayer.signTypedData>[0]);
  const signed = await createPermit2ProductionSigned(record, permit2Signature, eip2612Signature, protocolSecond + 1);
  return { record, prepared, signed, permit2Signature, eip2612Signature };
}
