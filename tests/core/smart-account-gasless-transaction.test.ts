import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "../../src/model.js";
import { verifySmartAccountOuterTransaction } from "../../src/smart-account-gasless/chain/transaction.js";
import { verifySmartAccountRedemption } from "../../src/smart-account-gasless/chain/redemption.js";
import { SA_OUTER, saRedemptionFixture, saSignedOuter, saWord } from "./smart-account-gasless-chain-fixtures.js";

const rejected = { message: /Smart Account gasless operation could not advance safely/u };

test("Smart Account outer verifier authenticates public synthetic signed types 0 through 4", async () => {
  const fixture = saRedemptionFixture();
  for (const type of [0, 1, 2, 3, 4] as const) {
    const signed = await saSignedOuter(type, fixture.calldata, fixture.intent);
    const verified = await verifySmartAccountOuterTransaction(signed.rpc, signed.hash, fixture.intent);
    assert.equal(verified.typeAtomic, String(type));
    assert.equal(verified.from, SA_OUTER.address.toLowerCase());
    assert.equal(verified.to, fixture.intent.binding.delegationManager);
    assert.equal(verified.input, fixture.calldata);
    assert.equal(verified.valueAtomic, "0");
    assert.equal(verified.authorizationOwners.length, type === 4 ? 1 : 0);
  }
});

test("Smart Account outer verifier rejects copied hashes with altered envelope fields", async () => {
  const fixture = saRedemptionFixture(), signed = await saSignedOuter(2, fixture.calldata, fixture.intent);
  const mutations = [
    { ...signed.rpc, from: fixture.intent.binding.ownerAddress },
    { ...signed.rpc, input: "0x1234" },
    { ...signed.rpc, chainId: "0x1" },
    { ...signed.rpc, to: fixture.intent.binding.ownerAddress },
    { ...signed.rpc, r: saWord(0n) },
    { ...signed.rpc, s: saWord(0n) },
    { ...signed.rpc, yParity: "0x2" },
    { ...signed.rpc, maxPriorityFeePerGas: "0x77359401" },
    { ...signed.rpc, authorizationList: [] },
  ];
  for (const changed of mutations) {
    await assert.rejects(verifySmartAccountOuterTransaction(changed, signed.hash, fixture.intent), rejected);
  }
  await assert.rejects(verifySmartAccountOuterTransaction(signed.rpc, saWord(123n), fixture.intent), rejected);
});

test("Smart Account type-4 verifies every authorization and excludes owner and session", async () => {
  const fixture = saRedemptionFixture(), signed = await saSignedOuter(4, fixture.calldata, fixture.intent);
  const authorization = signed.rpc.authorizationList[0];
  for (const changed of [
    { ...signed.rpc, authorizationList: [] },
    { ...signed.rpc, authorizationList: [{ ...authorization, chainId: "0x1" }] },
    { ...signed.rpc, authorizationList: [{ ...authorization, nonce: "0x20000000000000" }] },
    { ...signed.rpc, authorizationList: [{ ...authorization, unexpected: "0x0" }] },
    { ...signed.rpc, authorizationList: Array.from({ length: 17 }, () => authorization) },
  ]) await assert.rejects(verifySmartAccountOuterTransaction(changed, signed.hash, fixture.intent), rejected);

  for (const field of ["ownerAddress", "sessionAddress"] as const) {
    const forbidden = privateKeyToAccount(`0x${(field === "ownerAddress" ? "73" : "74").repeat(32)}`);
    const forbiddenIntent = { ...fixture.intent, binding: { ...fixture.intent.binding,
      [field]: forbidden.address.toLowerCase() as Address } };
    const forbiddenSigned = await saSignedOuter(4, fixture.calldata, forbiddenIntent, forbidden);
    await assert.rejects(verifySmartAccountOuterTransaction(forbiddenSigned.rpc, forbiddenSigned.hash,
      forbiddenIntent), rejected);
  }
});

test("Smart Account redemption requires canonical cardinality, execution and exact validator hashes", async () => {
  const fixture = saRedemptionFixture();
  const verified = await verifySmartAccountRedemption(fixture.calldata, "sa-chain-test", "6".repeat(64),
    fixture.intent, fixture.material, fixture.validator);
  assert.equal(verified.permissionContext, fixture.permissionContext);
  assert.equal(verified.rootContext, fixture.rootContext);
  assert.equal(verified.childDelegationHash, fixture.material.childDelegationHash);

  await assert.rejects(verifySmartAccountRedemption("0x1234", "sa-chain-test", "6".repeat(64),
    fixture.intent, fixture.material, fixture.validator), rejected);
  const abi = parseAbi(["function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)"]);
  const encode = (contexts: readonly Hex[], modes: readonly Hex[], executions: readonly Hex[]) =>
    encodeFunctionData({ abi, functionName: "redeemDelegations", args: [contexts, modes, executions] });
  for (const calldata of [
    encode([], [saWord(0n)], [fixture.executionCallData]),
    encode([fixture.permissionContext, fixture.permissionContext], [saWord(0n)], [fixture.executionCallData]),
    encode([fixture.permissionContext], [saWord(1n)], [fixture.executionCallData]),
    encode(["0x00"], [saWord(0n)], [fixture.executionCallData]),
    encode([fixture.permissionContext], [saWord(0n)],
      [`${fixture.executionCallData.slice(0, -2)}01` as Hex]),
  ]) await assert.rejects(verifySmartAccountRedemption(calldata, "sa-chain-test", "6".repeat(64),
    fixture.intent, fixture.material, fixture.validator), rejected);
  const wrongHashValidator = { validate: async () => ({ ...(await fixture.validator.validate({ operationId: "sa-chain-test",
    fingerprint: "6".repeat(64), intent: fixture.intent, paymentPayload: verified.paymentPayload,
    rootContext: fixture.rootContext })), childDelegationHash: saWord(100n) }) };
  await assert.rejects(verifySmartAccountRedemption(fixture.calldata, "sa-chain-test", "6".repeat(64),
    fixture.intent, fixture.material, wrongHashValidator), rejected);
});
