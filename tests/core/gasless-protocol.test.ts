import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { intentSchema } from "../../src/gasless/schema.js";
import { encodeAbiParameters, encodeEventTopics, getAbiItem, getAddress, numberToHex } from "viem";
import type { Abi, AbiParameter } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { GASLESS_ENTRYPOINT_ABI, GASLESS_PAYMASTER_ABI, GASLESS_TOKEN_ABI } from "../../src/gasless/abi.js";
import { assertGaslessEstimate, assertGaslessSnapshot, gaslessFee, gaslessGas, validateGaslessGas,
  validateGaslessStoredOffer } from "../../src/gasless/economics.js";
import type { GaslessAuthorization, GaslessIntent, GaslessLog, GaslessProtocolReceipt, GaslessSnapshot,
  GaslessUserOperation } from "../../src/gasless/model.js";
import { gaslessAccounting } from "../../src/gasless/protocol.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "../../src/gasless/signature.js";
import { gaslessAuthorizationRequest, gaslessBatch, gaslessEnvelopeBinding, gaslessPermitTypedData,
  gaslessUserOperation, gaslessUserOperationHash, gaslessUserOperationTypedData, validateGaslessBatch,
  validateGaslessWire } from "../../src/gasless/wire.js";

type Json = Record<string, any>;
const TOKEN = getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const PAYMASTER = getAddress("0x2222222222222222222222222222222222222222");
const ENTRYPOINT = getAddress("0x4337084d9e255ff0702461cf8895ce9e3b5ff108");
const DELEGATE = getAddress("0x3333333333333333333333333333333333333333");
const RECIPIENT = getAddress("0x4444444444444444444444444444444444444444");
const OTHER = getAddress("0x5555555555555555555555555555555555555555");
const HASH = `0x${"ab".repeat(32)}` as Hex;
const TX_HASH = `0x${"cd".repeat(32)}` as Hex;

test("conservative gas and Circle fee arithmetic bind first and repeated delegation", () => {
  const owner = getAddress("0x1111111111111111111111111111111111111111");
  const firstSnapshot = snapshot(owner, "empty"), repeatedSnapshot = snapshot(owner, "expected");
  const first = gaslessGas(firstSnapshot), repeated = gaslessGas(repeatedSnapshot);
  assert.equal(first.preVerificationGas, "150000");
  assert.equal(repeated.preVerificationGas, "125000");
  assert.equal(gaslessFee(first, firstSnapshot.feeConfiguration), "5408551");
  assert.equal(gaslessFee(repeated, repeatedSnapshot.feeConfiguration), "5275988");
  const intent = makeIntent(owner, "empty");
  assert.doesNotThrow(() => assertGaslessSnapshot(intent, firstSnapshot));
  assert.throws(() => assertGaslessSnapshot({ ...intent,
    request: { ...intent.request, maxFeeAtomic: "5000000", minReceivedAtomic: "5000000" } }, firstSnapshot),
  { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.doesNotThrow(() => assertGaslessEstimate(intent, {
    verificationGasLimit: "90000", callGasLimit: "200000", paymasterVerificationGasLimit: "180000",
    paymasterPostOpGasLimit: "35000", preVerificationGas: "140000", responseHash: "9".repeat(64),
  }));
  assert.throws(() => assertGaslessEstimate(intent, {
    verificationGasLimit: "90000", callGasLimit: "200000", paymasterVerificationGasLimit: "180000",
    paymasterPostOpGasLimit: "35000", preVerificationGas: "24999", responseHash: "9".repeat(64),
  }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => assertGaslessSnapshot(intent, { ...firstSnapshot, allowanceAtomic: "1" }),
    { code: "APN_PERMISSION_ALLOWANCE_INSUFFICIENT" });
  assert.throws(() => assertGaslessSnapshot(intent, { ...firstSnapshot, baseFeePerGas: "2100000001" }),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => assertGaslessSnapshot(intent, { ...firstSnapshot,
    feeConfiguration: { ...firstSnapshot.feeConfiguration, nativeTokenPrice: "5000000000" } }),
  { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.doesNotThrow(() => assertGaslessSnapshot(intent, { ...firstSnapshot,
    feeConfiguration: { ...firstSnapshot.feeConfiguration, nativeTokenPrice: "1" } }));
  assert.throws(() => assertGaslessSnapshot(intent, { ...firstSnapshot,
    feeConfiguration: { additionalGasCharge: "35001", feeSpread: "0", nativeTokenPrice: "1" } }),
  { code: "APN_FEE_BUDGET_EXCEEDED" });
});

test("the captured public Circle estimate fits a new offer but never enlarges a legacy intent", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "empty");
  // Base public Pimlico response, 2026-09-09 16:02 UTC. The diagnostic used a
  // burn sender and simulation-only signature/balance overrides, not a payment.
  const estimate = { verificationGasLimit: "61585", callGasLimit: "35910",
    paymasterVerificationGasLimit: "400530", paymasterPostOpGasLimit: "11360",
    preVerificationGas: "83700", responseHash: hashObject({ preVerificationGas: "0x146f4",
      verificationGasLimit: "0xf091", callGasLimit: "0x8c46",
      paymasterVerificationGasLimit: "0x61c92", paymasterPostOpGasLimit: "0x2c60" }) };
  assert.doesNotThrow(() => assertGaslessEstimate(intent, estimate));
  const legacyGas = { ...intent.gas, callGasLimit: "250000", paymasterVerificationGasLimit: "200000" };
  assert.doesNotThrow(() => validateGaslessGas(legacyGas));
  const frozen = JSON.stringify(legacyGas);
  assert.throws(() => assertGaslessEstimate({ ...intent, gas: legacyGas }, estimate),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.equal(JSON.stringify(legacyGas), frozen);
  assert.throws(() => assertGaslessEstimate(intent, { ...estimate, paymasterVerificationGasLimit: "500001" }),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  // The legacy 250k call size is recognized only with its legacy paymaster size, never as a hybrid of the two offers.
  assert.throws(() => validateGaslessStoredOffer({ ...intent.gas, callGasLimit: "250000" }, intent.initialSnapshot, intent.wireVersion),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.throws(() => validateGaslessGas({ ...intent.gas, callGasLimit: "250000", paymasterVerificationGasLimit: "700000" }),
    { code: "APN_FEE_BUDGET_EXCEEDED" });
});

test("stored offers retain only exact legacy or current gas, including legacy-only aggregate headroom", () => {
  const owner = getAddress("0x1111111111111111111111111111111111111111");
  for (const designation of ["empty", "expected"] as const) {
    const state = snapshot(owner, designation), current = gaslessGas(state);
    const legacy = { ...current, callGasLimit: "250000", paymasterVerificationGasLimit: "200000" };
    const before = JSON.stringify(legacy);
    assert.doesNotThrow(() => validateGaslessStoredOffer(current, state, undefined));
    assert.doesNotThrow(() => validateGaslessStoredOffer(legacy, state, undefined));
    assert.equal(JSON.stringify(legacy), before);
    for (const change of [
      { callGasLimit: "199999" }, { callGasLimit: "200000" }, { paymasterVerificationGasLimit: "199999" },
      { paymasterVerificationGasLimit: "500000" }, { verificationGasLimit: "99999" },
      { preVerificationGas: "124999" }, { paymasterPostOpGasLimit: "35001" },
      { maxFeePerGas: "2100000001" }, { maxPriorityFeePerGas: "100000001" },
    ]) assert.throws(() => validateGaslessStoredOffer({ ...legacy, ...change }, state, undefined), { code: "APN_FEE_BUDGET_EXCEEDED" });
    const heavy = { ...state, feeConfiguration: { ...state.feeConfiguration, additionalGasCharge: "200000" } };
    assert.throws(() => gaslessGas(heavy), { code: "APN_FEE_BUDGET_EXCEEDED" });
    assert.doesNotThrow(() => validateGaslessStoredOffer({ ...legacy, paymasterPostOpGasLimit: "200000" }, heavy, undefined));
  }
});

test("published batch and paymaster codec reject hostile field and byte mutations", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "expected");
  assert.equal(intent.callData, gaslessBatch(intent.token, intent.request.recipient, intent.recipientAtomic, intent.paymaster));
  assert.doesNotThrow(() => validateGaslessBatch(intent));
  const wire = gaslessUserOperation(intent, { permitSignature: GASLESS_ESTIMATE_SIGNATURE, authorization: null },
    GASLESS_ESTIMATE_SIGNATURE);
  assert.equal((wire.paymasterData.length - 2) / 2, 118);
  const packed = gaslessUserOperationTypedData(intent, wire).message.paymasterAndData;
  assert.equal((packed.length - 2) / 2, 170);
  assert.equal(`0x${packed.slice(2 + 53 * 2, 2 + 73 * 2)}`, intent.token.toLowerCase());
  assert.equal(BigInt(`0x${packed.slice(2 + 73 * 2, 2 + 105 * 2)}`).toString(), intent.feeCapAtomic);
  assert.equal(`0x${packed.slice(2 + 105 * 2)}`, GASLESS_ESTIMATE_SIGNATURE);
  assert.deepEqual(validateGaslessWire(intent, wire), wire);
  assert.throws(() => validateGaslessWire(intent, { ...wire, paymasterData: `${wire.paymasterData.slice(0, -2)}00` }),
    { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateGaslessWire(intent, { ...wire, callData: `${wire.callData}00` }),
    { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateGaslessWire(intent, { ...wire, evil: "0x" }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateGaslessBatch({ ...intent, callData: `${intent.callData}00` as Hex }),
    { code: "APN_PROVIDER_PROTOCOL" });
});

test("legacy first-use and repeated signatures preserve their original delegate hash", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const first = makeIntent(account.address, "empty");
  const permit = await account.signTypedData(gaslessPermitTypedData(first));
  const signedAuthorization = await account.signAuthorization(gaslessAuthorizationRequest(first));
  const yParity = signedAuthorization.yParity ?? Number(signedAuthorization.v - 27n);
  const authorization: GaslessAuthorization = {
    chainId: numberToHex(signedAuthorization.chainId), address: signedAuthorization.address,
    nonce: numberToHex(signedAuthorization.nonce), yParity: numberToHex(yParity),
    r: signedAuthorization.r, s: signedAuthorization.s,
  };
  await verifyGaslessBootstrap(first, { permitSignature: permit, authorization });
  const estimateWire = gaslessUserOperation(first, { permitSignature: permit, authorization }, GASLESS_ESTIMATE_SIGNATURE);
  assert.equal(gaslessUserOperationTypedData(first, estimateWire).message.initCode, first.delegate);
  const accountSignature = await account.signTypedData(gaslessUserOperationTypedData(first, estimateWire));
  const firstWire = gaslessUserOperation(first, { permitSignature: permit, authorization }, accountSignature);
  assert.equal(await verifyGaslessUserOperation(first, firstWire), gaslessUserOperationHash(first, firstWire));
  const firstV2 = { ...first, wireVersion: "apn.gasless-wire.v2" as const };
  assert.deepEqual(gaslessUserOperation(firstV2, { permitSignature: permit, authorization }, accountSignature), firstWire);
  assert.equal(await verifyGaslessUserOperation(firstV2, firstWire), gaslessUserOperationHash(first, firstWire));
  const { factory: _factory, factoryData: _factoryData, ...missingMarker } = firstWire;
  assert.throws(() => validateGaslessWire(firstV2, missingMarker), { code: "APN_PROVIDER_PROTOCOL" });
  const repeatedEquivalent = { ...first, initialSnapshot: { ...first.initialSnapshot, delegation: "expected" as const } };
  const repeatedEquivalentWire = gaslessUserOperation(repeatedEquivalent,
    { permitSignature: permit, authorization: null }, GASLESS_ESTIMATE_SIGNATURE);
  assert.equal(gaslessUserOperationHash(first, estimateWire),
    gaslessUserOperationHash(repeatedEquivalent, repeatedEquivalentWire));

  const repeated = makeIntent(account.address, "expected");
  const repeatedPermit = await account.signTypedData(gaslessPermitTypedData(repeated));
  await verifyGaslessBootstrap(repeated, { permitSignature: repeatedPermit, authorization: null });
  const repeatedEstimate = gaslessUserOperation(repeated,
    { permitSignature: repeatedPermit, authorization: null }, GASLESS_ESTIMATE_SIGNATURE);
  const repeatedSignature = await account.signTypedData(gaslessUserOperationTypedData(repeated, repeatedEstimate));
  const repeatedWire = gaslessUserOperation(repeated,
    { permitSignature: repeatedPermit, authorization: null }, repeatedSignature);
  assert.equal(gaslessUserOperationTypedData(repeated, repeatedWire).message.initCode, repeated.delegate);
  assert.equal(await verifyGaslessUserOperation(repeated, repeatedWire), gaslessUserOperationHash(repeated, repeatedWire));
  assert.notEqual(gaslessUserOperationHash(first, firstWire), gaslessUserOperationHash(repeated, repeatedWire));
  assert.equal(hashObject(gaslessEnvelopeBinding(first)), first.unsignedEnvelopeHash);

  const hostile = { ...repeatedWire,
    signature: `${repeatedWire.signature.slice(0, 66)}${"f".repeat(64)}${repeatedWire.signature.slice(-2)}` as Hex };
  await assert.rejects(() => verifyGaslessUserOperation(repeated, hostile), { code: "APN_PROVIDER_PROTOCOL" });
});

test("v2 reuses a designation with empty initCode and rejects a legacy-hash signature", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const legacy = makeIntent(account.address, "expected"), legacyBinding = hashObject(gaslessEnvelopeBinding(legacy));
  const body = { ...legacy, wireVersion: "apn.gasless-wire.v2" as const };
  const intent = { ...body, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(body)) };
  const bootstrap = { permitSignature: await account.signTypedData(gaslessPermitTypedData(intent)), authorization: null };
  const wire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE);
  const oldWire = gaslessUserOperation(legacy, bootstrap, GASLESS_ESTIMATE_SIGNATURE);
  assert.equal("factory" in wire, false); assert.equal("factoryData" in wire, false);
  assert.equal("eip7702Auth" in wire, false);
  assert.equal(gaslessUserOperationTypedData(intent, wire).message.initCode, "0x");
  assert.notEqual(gaslessUserOperationHash(intent, wire), gaslessUserOperationHash(legacy, oldWire));
  assert.notEqual(intent.unsignedEnvelopeHash, legacyBinding);
  assert.equal(hashObject(gaslessEnvelopeBinding(legacy)), legacyBinding);
  const signature = await account.signTypedData(gaslessUserOperationTypedData(intent, wire));
  assert.equal(await verifyGaslessUserOperation(intent, { ...wire, signature }), gaslessUserOperationHash(intent, wire));
  const wrongSignature = await account.signTypedData(gaslessUserOperationTypedData(legacy, oldWire));
  await assert.rejects(verifyGaslessUserOperation(intent, { ...wire, signature: wrongSignature }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => validateGaslessWire(legacy, wire), { code: "APN_PROVIDER_PROTOCOL" });
  for (const extra of [{ factory: oldWire.factory }, { factoryData: "0x" },
    { factory: oldWire.factory, factoryData: "0x" }, { factory: null, factoryData: null },
    { eip7702Auth: null }, { eip7702Auth: {} }]) {
    assert.throws(() => validateGaslessWire(intent, { ...wire, ...extra }), { code: "APN_PROVIDER_PROTOCOL" });
  }
  assert.throws(() => gaslessUserOperation({ ...intent, wireVersion: "unknown" } as never,
    bootstrap, GASLESS_ESTIMATE_SIGNATURE), { code: "APN_PROVIDER_PROTOCOL" });
});

test("settlement decoder accounts sponsored success from exact published events", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "expected");
  const operationHash = `0x${"12".repeat(32)}` as Hex;
  const prefund = 3_000_000n, refund = 500_000n, charge = 2_500_000n;
  const logs = sponsoredSuccessLogs(intent, operationHash);
  assert.deepEqual(gaslessAccounting(intent, operationHash, receipt(logs)), {
    success: true, branch: "sponsored", prefundAtomic: prefund.toString(), refundAtomic: refund.toString(),
    feeAtomic: charge.toString(), deliveredAtomic: intent.recipientAtomic,
    logsHash: hashObjectForLogs(logs),
  });
});

test("failed postOp proof charges the exact prefund and leaves the fee residue for safe-state handling", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "expected");
  const operationHash = `0x${"34".repeat(32)}` as Hex, prefund = 2_000_000n;
  const logs = [
    eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
      { owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic) }, 0),
    eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token,
      { from: intent.owner.address, to: intent.paymaster, value: prefund }, 1),
    eventLog(GASLESS_ENTRYPOINT_ABI, "PostOpRevertReason", intent.entryPoint,
      { userOpHash: operationHash, sender: intent.owner.address,
        nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic), revertReason: "0xdeadbeef" }, 2),
    userOperationEvent(intent, operationHash, false, 3),
  ];
  const accounting = gaslessAccounting(intent, operationHash, receipt(logs));
  assert.equal(accounting.branch, "post_op_reverted");
  assert.equal(accounting.feeAtomic, prefund.toString());
  assert.equal(accounting.refundAtomic, "0");
  assert.equal(accounting.deliveredAtomic, "0");
  assert.equal(BigInt(intent.feeCapAtomic) - BigInt(accounting.feeAtomic), 3_275_988n);
  assert.throws(() => gaslessAccounting(intent, operationHash, receipt([...logs,
    eventLog(GASLESS_TOKEN_ABI, "Transfer", intent.token,
      { from: intent.owner.address, to: RECIPIENT, value: 1n }, 4)])), { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => gaslessAccounting(intent, operationHash, receipt([...logs,
    userOperationEvent(intent, `0x${"56".repeat(32)}` as Hex, false, 4)])), { code: "APN_RPC_PROTOCOL" });
});

test("receipt correlation rejects reordered, duplicated, missing, and mismatched owner effects", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "expected");
  const operationHash = `0x${"12".repeat(32)}` as Hex, otherHash = `0x${"56".repeat(32)}` as Hex;
  const good = sponsoredSuccessLogs(intent, operationHash);
  const rejected = (logs: readonly GaslessLog[]) => assert.throws(
    () => gaslessAccounting(intent, operationHash, receipt(logs)), { code: "APN_RPC_PROTOCOL" });
  rejected(reindex([good[0]!, good[1]!, good[3]!, good[2]!, ...good.slice(4)]));
  rejected(good.map((log, index) => index === 1 ? { ...log, logIndexAtomic: "0" } : log));
  rejected([...good, userOperationEvent(intent, operationHash, true, 7)]);
  rejected(replace(good, 6, userOperationEventAs(intent, operationHash, true, 6, { sender: OTHER })));
  rejected(replace(good, 5, sponsorEvent(intent, operationHash, 5, { token: OTHER })));
  rejected(replace(good, 6, { ...good[6]!, address: OTHER }));
  rejected(replace(good, 6, userOperationEvent(intent, otherHash, true, 6)));
  rejected(replace(good, 6, userOperationEventAs(intent, operationHash, true, 6, { nonce: 10n })));
  rejected(good.filter((_, index) => index !== 2));
  rejected(good.filter((_, index) => index !== 3));
  rejected(good.filter((_, index) => index !== 5));
  rejected(replace(good, 1, tokenTransfer(intent.owner.address, intent.paymaster,
    BigInt(intent.feeCapAtomic) + 1n, 1)));
  rejected(replace(good, 4, tokenTransfer(intent.paymaster, intent.owner.address, 3_000_001n, 4)));

  const unrelated = reindex([
    good[0]!,
    eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
      { owner: OTHER, spender: intent.paymaster, value: 1n }, 0),
    tokenTransfer(OTHER, intent.paymaster, 1n, 0),
    tokenTransfer(OTHER, intent.owner.address, 1n, 0),
    ...good.slice(1),
    userOperationEventAs(intent, otherHash, false, 0, { sender: OTHER, nonce: 1n }),
  ]);
  assert.equal(gaslessAccounting(intent, operationHash, receipt(unrelated)).feeAtomic, "2500000");
});

test("failed sponsored and prefund-low branches enforce their exact effect order", () => {
  const intent = makeIntent(getAddress("0x1111111111111111111111111111111111111111"), "expected");
  const operationHash = `0x${"78".repeat(32)}` as Hex;
  const failedSponsored = [
    permitApproval(intent, 0), tokenTransfer(intent.owner.address, intent.paymaster, 3_000_000n, 1),
    tokenTransfer(intent.paymaster, intent.owner.address, 500_000n, 2),
    sponsorEvent(intent, operationHash, 3), userOperationEvent(intent, operationHash, false, 4),
  ];
  const sponsored = gaslessAccounting(intent, operationHash, receipt(failedSponsored));
  assert.deepEqual([sponsored.success, sponsored.branch, sponsored.feeAtomic, sponsored.deliveredAtomic],
    [false, "sponsored", "2500000", "0"]);
  assert.throws(() => gaslessAccounting(intent, operationHash,
    receipt(reindex([failedSponsored[0]!, failedSponsored[1]!, failedSponsored[3]!, failedSponsored[2]!, failedSponsored[4]!]))),
  { code: "APN_RPC_PROTOCOL" });
  assert.throws(() => gaslessAccounting(intent, operationHash, receipt(failedSponsored.filter((_, index) => index !== 3))),
    { code: "APN_RPC_PROTOCOL" });

  const prefundLow = [
    permitApproval(intent, 0), tokenTransfer(intent.owner.address, intent.paymaster, 2_000_000n, 1),
    eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationPrefundTooLow", intent.entryPoint,
      { userOpHash: operationHash, sender: intent.owner.address,
        nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic) }, 2),
    userOperationEvent(intent, operationHash, false, 3),
  ];
  assert.equal(gaslessAccounting(intent, operationHash, receipt(prefundLow)).branch, "prefund_too_low");
  assert.throws(() => gaslessAccounting(intent, operationHash,
    receipt(reindex([prefundLow[0]!, prefundLow[1]!, prefundLow[3]!, prefundLow[2]!]))),
  { code: "APN_RPC_PROTOCOL" });

  const combined = [
    permitApproval(intent, 0), tokenTransfer(intent.owner.address, intent.paymaster, 2_000_000n, 1),
    postOpFailureFrame(intent, operationHash, 2), prefundFailureFrame(intent, operationHash, 3),
    userOperationEvent(intent, operationHash, false, 4),
  ];
  const combinedAccounting = gaslessAccounting(intent, operationHash, receipt(combined));
  assert.deepEqual([combinedAccounting.branch, combinedAccounting.feeAtomic, combinedAccounting.logsHash],
    ["prefund_too_low", "2000000", hashObjectForLogs(combined)]);

  const rejected = (logs: readonly GaslessLog[]) => assert.throws(
    () => gaslessAccounting(intent, operationHash, receipt(logs)), { code: "APN_RPC_PROTOCOL" });
  rejected(reindex([...combined.slice(0, 2), combined[3]!, combined[2]!, combined[4]!]));
  rejected(reindex([...combined.slice(0, 4), combined[3]!, combined[4]!]));
  rejected(replace(combined, 3, prefundFailureFrame(intent, operationHash, 3, { nonce: 10n })));
  rejected(replace(combined, 3, prefundFailureFrame(intent, operationHash, 3, { sender: OTHER })));
  rejected(replace(combined, 3, prefundFailureFrame(intent, otherHash(), 3)));
  rejected(reindex([...combined.slice(0, 4), sponsorEvent(intent, operationHash, 0), combined[4]!]));
  rejected(reindex([...combined.slice(0, 4), tokenTransfer(intent.paymaster, intent.owner.address, 1n, 0), combined[4]!]));
  rejected(reindex([...combined.slice(0, 2), tokenTransfer(intent.owner.address, intent.request.recipient, 1n, 0),
    ...combined.slice(2)]));
});

function makeIntent(ownerAddress: Address, delegation: "empty" | "expected"): GaslessIntent {
  const initialSnapshot = snapshot(ownerAddress, delegation), gas = gaslessGas(initialSnapshot);
  const feeCapAtomic = gaslessFee(gas, initialSnapshot.feeConfiguration);
  const grossAtomic = "10000000", recipientAtomic = (BigInt(grossAtomic) - BigInt(feeCapAtomic)).toString();
  const withoutHash = {
    profile: "synthetic", request: { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic,
      maxFeeAtomic: "6000000", minReceivedAtomic: "4000000" },
    owner: { profile: "synthetic", profileHash: "1".repeat(64), address: ownerAddress,
      walletBindingHash: "2".repeat(64), walletCreatedAt: "2026-09-09T00:00:00.000Z" },
    providerBinding: { providerId: "local" as const, accountBindingHash: "3".repeat(64),
      capabilityHash: "4".repeat(64), revision: 1 }, initialSnapshot, gas, token: TOKEN,
    tokenDomain: { name: "USD Coin" as const, version: "2" as const, chainId: 8453 as const,
      verifyingContract: TOKEN, domainSeparator: HASH }, paymaster: PAYMASTER, entryPoint: ENTRYPOINT, delegate: DELEGATE,
    feeCapAtomic, recipientAtomic, callData: gaslessBatch(TOKEN, RECIPIENT, recipientAtomic, PAYMASTER),
    preparedAt: "2026-09-09T00:00:00.000Z", expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "5".repeat(64),
  };
  return { ...withoutHash, unsignedEnvelopeHash: hashObject(gaslessEnvelopeBinding(withoutHash)) };
}

function snapshot(owner: Address, delegation: "empty" | "expected"): GaslessSnapshot {
  return {
    chainId: 8453, rpcOrigin: "https://rpc.example", rpcEndpointHash: "6".repeat(64),
    bundlerOrigin: "https://bundler.example", bundlerEndpointHash: "7".repeat(64),
    block: { numberAtomic: "100", hash: HASH, timestampAtomic: "1788912000" }, protocolHash: "8".repeat(64),
    owner, token: TOKEN, balanceAtomic: "10000000", nativeBalanceWei: "0", allowanceAtomic: "0",
    permitNonceAtomic: "7", entryPointNonceAtomic: "9", eoaNonceAtomic: "0", pendingEoaNonceAtomic: "0",
    delegation, feeConfiguration: { additionalGasCharge: "35000", feeSpread: "100", nativeTokenPrice: "2500000000" },
    baseFeePerGas: "1000000000", maxFeePerGas: "2100000000", maxPriorityFeePerGas: "100000000",
  };
}

function sponsoredSuccessLogs(intent: GaslessIntent, operationHash: Hex): readonly GaslessLog[] {
  return [
    permitApproval(intent, 0),
    tokenTransfer(intent.owner.address, intent.paymaster, 3_000_000n, 1),
    tokenTransfer(intent.owner.address, intent.request.recipient, BigInt(intent.recipientAtomic), 2),
    eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
      { owner: intent.owner.address, spender: intent.paymaster, value: 0n }, 3),
    tokenTransfer(intent.paymaster, intent.owner.address, 500_000n, 4),
    sponsorEvent(intent, operationHash, 5),
    userOperationEvent(intent, operationHash, true, 6),
  ];
}

function permitApproval(intent: GaslessIntent, index: number): GaslessLog {
  return eventLog(GASLESS_TOKEN_ABI, "Approval", intent.token,
    { owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic) }, index);
}

function tokenTransfer(from: Address, to: Address, value: bigint, index: number): GaslessLog {
  return eventLog(GASLESS_TOKEN_ABI, "Transfer", TOKEN, { from, to, value }, index);
}

function sponsorEvent(intent: GaslessIntent, hash: Hex, index: number, changes: Json = {}): GaslessLog {
  return eventLog(GASLESS_PAYMASTER_ABI, "UserOperationSponsored", intent.paymaster, {
    token: intent.token, sender: intent.owner.address, userOpHash: hash, nativeTokenPrice: 2_500_000_000n,
    actualTokenNeeded: 2_500_000n, feeTokenAmount: 25_000n, ...changes,
  }, index);
}

function postOpFailureFrame(intent: GaslessIntent, hash: Hex, index: number, changes: Json = {}): GaslessLog {
  return eventLog(GASLESS_ENTRYPOINT_ABI, "PostOpRevertReason", intent.entryPoint, {
    userOpHash: hash, sender: intent.owner.address, nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic),
    revertReason: "0xdeadbeef", ...changes,
  }, index);
}

function prefundFailureFrame(intent: GaslessIntent, hash: Hex, index: number, changes: Json = {}): GaslessLog {
  return eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationPrefundTooLow", intent.entryPoint, {
    userOpHash: hash, sender: intent.owner.address, nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic), ...changes,
  }, index);
}

function otherHash(): Hex { return `0x${"56".repeat(32)}`; }

function receipt(logs: readonly GaslessLog[]): GaslessProtocolReceipt {
  return { chainId: 8453, transactionHash: TX_HASH,
    block: { numberAtomic: "101", hash: `0x${"ef".repeat(32)}`, timestampAtomic: "1788912012" }, logs };
}

function userOperationEvent(intent: GaslessIntent, hash: Hex, success: boolean, index: number): GaslessLog {
  return userOperationEventAs(intent, hash, success, index);
}

function userOperationEventAs(intent: GaslessIntent, hash: Hex, success: boolean, index: number,
  changes: Json = {}): GaslessLog {
  return eventLog(GASLESS_ENTRYPOINT_ABI, "UserOperationEvent", intent.entryPoint, {
    userOpHash: hash, sender: intent.owner.address, paymaster: intent.paymaster,
    nonce: BigInt(intent.initialSnapshot.entryPointNonceAtomic), success, actualGasCost: 100n, actualGasUsed: 50n, ...changes,
  }, index);
}

function replace(logs: readonly GaslessLog[], index: number, value: GaslessLog): readonly GaslessLog[] {
  return logs.map((log, candidate) => candidate === index ? value : log);
}

function reindex(logs: readonly GaslessLog[]): readonly GaslessLog[] {
  return logs.map((log, index) => ({ ...log, logIndexAtomic: String(index) }));
}

function eventLog(abi: Abi, eventName: string, address: Address, args: Json, index: number): GaslessLog {
  const item = getAbiItem({ abi, name: eventName as never }) as any;
  const inputs = item.inputs as readonly (AbiParameter & { indexed?: boolean })[];
  const topics = encodeEventTopics({ abi: [item], eventName: eventName as never, args: args as never }) as readonly Hex[];
  const plain = inputs.filter((input) => !input.indexed) as readonly AbiParameter[];
  const values = inputs.filter((input) => !input.indexed).map((input) => args[input.name!]);
  return { address, topics, data: encodeAbiParameters(plain, values as never), logIndexAtomic: String(index) };
}

function hashObjectForLogs(logs: readonly GaslessLog[]): string {
  // Production uses the same canonical SHA-256 convention as hashObject.
  return hashObject(logs);
}

test("v2 empty initCode hash matches deployed Base EntryPoint and differs from its 7702 override", async () => {
  const vector = JSON.parse(await readFile("tests/core/gasless-fixtures/entrypoint-wire-v2-vector.json", "utf8"));
  const wire = vector.wire as GaslessUserOperation;
  // Public burn-sender fixture: the expected value is eth_call on pinned deployed code,
  // independent of this codec; no real signature, wallet state or payment is used.
  const intent = { wireVersion: "apn.gasless-wire.v2", owner: { address: wire.sender },
    request: { chainId: 8453, recipient: vector.recipient }, initialSnapshot: { delegation: "expected",
      entryPointNonceAtomic: BigInt(wire.nonce).toString() },
    entryPoint: vector.entryPoint, delegate: vector.delegate, token: vector.token, paymaster: wire.paymaster,
    feeCapAtomic: vector.feeCapAtomic, recipientAtomic: vector.recipientAtomic, callData: wire.callData,
    gas: Object.fromEntries(["callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas",
      "maxPriorityFeePerGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"]
      .map(key => [key, BigInt(vector.wire[key]).toString()])) } as unknown as GaslessIntent;
  assert.equal(vector.calls[3].request.method, "eth_call");
  assert.equal(vector.calls[3].request.params.length, 2);
  assert.equal(vector.calls[3].response.result, vector.expectedHash);
  assert.equal(gaslessUserOperationTypedData(intent, wire).message.initCode, "0x");
  assert.equal(gaslessUserOperationHash(intent, wire), vector.expectedHash);
  const { wireVersion: _version, ...legacy } = intent;
  const legacyWire = { ...wire, factory: "0x7702000000000000000000000000000000000000" as const, factoryData: "0x" as const };
  assert.equal(gaslessUserOperationHash(legacy, legacyWire), vector.markerHash);
  assert.notEqual(vector.expectedHash, vector.markerHash);
  assert.throws(() => validateGaslessWire(intent, legacyWire), { code: "APN_PROVIDER_PROTOCOL" });
});

test("the frozen wire version admits only legacy absence, v2, v3 or v4", () => {
  const version = intentSchema.shape.wireVersion;
  assert.equal(version.safeParse(undefined).success, true);
  assert.equal(version.safeParse("apn.gasless-wire.v2").success, true);
  assert.equal(version.safeParse("apn.gasless-wire.v3").success, true);
  assert.equal(version.safeParse("apn.gasless-wire.v4").success, true);
  for (const invalid of [null, 2, "", "apn.gasless-wire.v1", "apn.gasless-wire.v5"]) {
    assert.equal(version.safeParse(invalid).success, false);
  }
});
