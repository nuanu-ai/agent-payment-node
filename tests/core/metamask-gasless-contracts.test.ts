import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { createExactExecutionBatchTerms, createLimitedCallsTerms, hashDelegation } from "@metamask/delegation-core";
import { TypedDataEncoder } from "ethers";
import { hashObject, sha256 } from "../../src/canonical.js";
import { mmBinding, mmPrivateHash, mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import { mmEconomics, mmQuote, mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { MM_CHAINS, MM_DEPLOYMENT_INPUT_SHA, mmRegistry } from "../../src/metamask-gasless/registry.js";
import { MM_REASON_CODES, mmError } from "../../src/metamask-gasless/reasons.js";
import { mmAddress, mmDecimal, mmRequest, mmUint } from "../../src/metamask-gasless/validation.js";
import { MM_ANY_BENEFICIARY, MM_BATCH_MODE, MM_ROOT_AUTHORITY, mmValidateUnsigned } from "../../src/metamask-gasless/unsigned.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessExecution, MetaMaskGaslessUnsignedDelegation } from "../../src/metamask-gasless/model.js";
import type { Hex } from "../../src/model.js";

const sender = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222";
const feeRecipient = "0x3333333333333333333333333333333333333333" as const;
const hash = "a".repeat(64);
const binding: MetaMaskGaslessBinding = { providerId: "metamask-agent-wallet", address: sender,
  accountBindingHash: hash, capabilityHash: hash, revision: 1, projectHash: hash,
  walletReferenceHash: hash, walletIdHash: mmWalletIdentityHash(sender), namespace: "eip155", mode: "server", environment: "prod" };
const request = { chainId: 8453, recipient, grossAtomic: "10000000", maxFeeAtomic: "50000", minReceivedAtomic: "9950000" };
const transfer = parseAbi(["function transfer(address,uint256) returns (bool)"]);
function executions(net: string, fee: string): readonly [MetaMaskGaslessExecution, MetaMaskGaslessExecution] {
  const target = mmRegistry(8453).row.token;
  return [recipient, feeRecipient].map((to, i) => ({ target, value: "0",
    callData: encodeFunctionData({ abi: transfer, functionName: "transfer", args: [mmAddress(to), BigInt(i ? fee : net)] }) })) as
    unknown as readonly [MetaMaskGaslessExecution, MetaMaskGaslessExecution];
}

test("MM amounts preserve exact six-decimal uint256 boundaries and reject alternate representations", () => {
  assert.equal(mmDecimal("10"), "10000000"); assert.equal(mmDecimal("0.000001"), "1");
  for (const input of ["01", "+1", "-1", "1e2", "1,000", " 1", "1.", "1.0000001", "NaN"])
    assert.throws(() => mmDecimal(input), { code: "APN_INVALID_INPUT" });
  const max = (1n << 256n) - 1n;
  assert.equal(mmUint(max.toString()), max);
  for (const input of [(max + 1n).toString(), "00", "01", "-1", 1]) assert.throws(() => mmUint(input));
});

test("MM cap and minimum produce a satisfiable exact gross allocation including zero fee", () => {
  const r = mmRequest(request);
  assert.deepEqual(mmEconomics(r), { gross: 10000000n, cap: 50000n, initialNet: 9950000n });
  assert.equal(mmEconomics(mmRequest({ ...request, maxFeeAtomic: "999999999" })).cap, 50000n);
  assert.equal(mmEconomics(mmRequest({ ...request, maxFeeAtomic: "0" })).initialNet, 10000000n);
  assert.throws(() => mmRequest({ ...request, minReceivedAtomic: "10000001" }));
  assert.throws(() => mmRequest({ ...request, grossAtomic: "0" }));
  assert.throws(() => mmRequest({ ...request, recipient: "0x" + "0".repeat(40) }));
  assert.throws(() => mmRequest({ ...request, chainId: 130 }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("MM safe binding hashes preserve selected reference kind and original string", () => {
  assert.deepEqual(mmBinding(binding), binding);
  assert.notEqual(mmPrivateHash("wallet-reference", "Alice", "name"), mmPrivateHash("wallet-reference", "Alice", "id"));
  assert.notEqual(mmPrivateHash("wallet-reference", "Alice", "name"), mmPrivateHash("wallet-reference", "alice", "name"));
  assert.equal(mmPrivateHash("project", "fixture"), hashObject({ purpose: "apn.metamask-gasless.project.v1", value: "fixture" }));
  assert.equal(mmWalletIdentityHash(sender), hashObject({ purpose: "apn.metamask-gasless.wallet-id.v1", value: sender }));
  assert.throws(() => mmBinding({ ...binding, walletIdHash: hash }));
  for (const change of [{ projectHash: "X".repeat(64) }, { mode: "byok" }, { revision: 0 }, { rawToken: "private" }])
    assert.throws(() => mmBinding({ ...binding, ...change }));
});

test("MM quote requires precisely the two ordered transfers with no added authority or debit", () => {
  const material = { netAtomic: "9950000", feeAtomic: "50000", feeRecipient, executions: executions("9950000", "50000") };
  const q = { ...material, hash: mmQuoteHash(material) };
  assert.deepEqual(mmQuote(q, mmRequest(request), binding, "9950000"), q);
  for (const change of [{ feeAtomic: "50001" }, { feeRecipient: recipient }, { hash: "b".repeat(64) },
    { executions: [...q.executions].reverse() }, { executions: [...q.executions, q.executions[0]] },
    { executions: [{ ...q.executions[0], value: "1" }, q.executions[1]] }])
    assert.throws(() => mmQuote({ ...q, ...change }, mmRequest(request), binding, "9950000"));
  const zero = { netAtomic: "10000000", feeAtomic: "0", feeRecipient, executions: executions("10000000", "0") };
  assert.equal(mmQuote({ ...zero, hash: mmQuoteHash(zero) }, mmRequest(request), binding, "10000000").feeAtomic, "0");
});

test("MM compiled registry retains every independently bound parent row and source digest", () => {
  const bytes = readFileSync(new URL("../../../tests/core/metamask-gasless-contract-fixtures/deployment-registry-inputs.json", import.meta.url));
  assert.equal(sha256(bytes), MM_DEPLOYMENT_INPUT_SHA);
  const fixture = JSON.parse(bytes.toString("utf8")) as { sourceFiles: unknown; chains: { row: { chainId: number; finalityTag: string }; deploymentEvidenceHash: string }[] };
  assert.deepEqual(MM_CHAINS, [1, 10, 137, 143, 1329, 8453, 42161, 59144]);
  for (const expected of fixture.chains) {
    assert.deepEqual(mmRegistry(expected.row.chainId), expected);
    assert.equal(expected.deploymentEvidenceHash, hashObject({ purpose: "apn.metamask-gasless.deployment-evidence.v1", sourceFiles: fixture.sourceFiles, row: expected.row }));
    assert.equal(expected.row.finalityTag, expected.row.chainId === 137 ? "finalized" : "safe");
  }
  assert.throws(() => mmRegistry(43114), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("MM reasons are closed and errors never need arbitrary provider messages", () => {
  assert.equal(Object.keys(MM_REASON_CODES).length, 31);
  assert.equal(MM_REASON_CODES.mm_gasless_success, null);
  for (const [reason, code] of Object.entries(MM_REASON_CODES)) {
    if (code === null) continue;
    const error = mmError(reason as Exclude<keyof typeof MM_REASON_CODES, "mm_gasless_success">);
    assert.equal(error.code, code); assert.equal(error.details?.reason, reason);
  }
});

test("MM unsigned verifier matches separate official core and ethers EIP712 encoders", () => {
  const row = mmRegistry(8453).row, calls = executions("9950000", "50000");
  const delegation: MetaMaskGaslessUnsignedDelegation = { delegator: sender, delegate: MM_ANY_BENEFICIARY,
    authority: MM_ROOT_AUTHORITY, salt: `0x${"42".repeat(32)}`,
    caveats: [{ enforcer: row.protocol.limitedCalls.address, terms: createLimitedCallsTerms({ limit: 1 }), args: "0x" },
      { enforcer: row.protocol.exactBatch.address, args: "0x", terms: createExactExecutionBatchTerms({
        executions: calls.map(call => ({ ...call, value: BigInt(call.value) })),
      }) }] };
  const official = { ...delegation, salt: BigInt(delegation.salt), caveats: [...delegation.caveats], signature: "0x" as const };
  const types = {
    Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
    Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
  };
  const result = { unsignedDelegation: delegation, delegationHash: hashDelegation(official),
    signingDigest: TypedDataEncoder.hash({ name: "DelegationManager", version: "1", chainId: 8453,
      verifyingContract: row.protocol.manager.address }, types, official) as Hex,
    relayTo: row.protocol.manager.address, mode: MM_BATCH_MODE };
  const input = { owner: sender, chainId: 8453 as const, executions: calls };
  assert.deepEqual(mmValidateUnsigned(result, input), result);
  assert.notEqual(result.delegationHash, result.signingDigest);
  assert.throws(() => mmValidateUnsigned({ ...result, signingDigest: result.delegationHash }, input));
  assert.throws(() => mmValidateUnsigned(result, { ...input, chainId: 1 }));
  assert.throws(() => mmValidateUnsigned({ ...result, unsignedDelegation: { ...delegation, signature: "0x" } }, input));
  assert.throws(() => mmValidateUnsigned({ ...result, unsignedDelegation: { ...delegation, salt: "0x01" } }, input));
  assert.throws(() => mmValidateUnsigned({ ...result, unsignedDelegation: { ...delegation,
    caveats: [{ ...delegation.caveats[0], args: "0x01" }, delegation.caveats[1]] } }, input));
});
