import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi } from "viem";
import { sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { verifyRedemption } from "../../src/metamask-gasless/chain/delegation.js";
import { MM_DELEGATION_PARAMETER, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC,
  addressWord, type MmReceiptLog } from "../../src/metamask-gasless/chain/abi.js";
import { verifyMetaMaskReceiptAccounting, verifyScanLog } from "../../src/metamask-gasless/chain/receipt.js";
import { verifyMetaMaskOuterTransaction } from "../../src/metamask-gasless/chain/transaction.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import type { MetaMaskGaslessChainState, MetaMaskGaslessIntent } from "../../src/metamask-gasless/model.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";

type Json = Record<string, any>;
const VECTOR_PATH = "tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json";
const VECTOR_SHA = "a9c91a0983c6a3dfa838af98d7e1c260b58ad0fa4ad479ce355ef3dfa54434c2";
const vectorText = readFileSync(VECTOR_PATH, "utf8");
const vector = JSON.parse(vectorText) as Json;
const redeemAbi = parseAbi([
  "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)",
]);
const word = (value: bigint): Hex => `0x${value.toString(16).padStart(64, "0")}`;

test("independent static Base vector authenticates the delegation and signed outer transactions", async () => {
  assert.equal(sha256(vectorText), VECTOR_SHA);
  const pinned = intent("pinned");
  const redemption = await verifyRedemption(vector.redemptionCalldata, pinned);
  assert.equal(redemption.signature, vector.signature);
  const type2 = await verifyMetaMaskOuterTransaction(vector.type2.raw, vector.type2.hash, pinned);
  assert.equal(type2.from, vector.relayer); assert.equal(type2.authorizationOwner, null);
  const type4 = await verifyMetaMaskOuterTransaction(vector.type4.raw, vector.type4.hash, intent("empty"));
  assert.equal(type4.authorizationOwner, vector.owner);
});

test("redemption rejects wrong ABI, EIP-712 domain, and high-s signatures", async () => {
  const valid = intent("pinned");
  await assert.rejects(verifyRedemption("0x00000000", valid), protocolError);
  await assert.rejects(verifyRedemption(vector.redemptionCalldata,
    { ...valid, signingDigest: `0x${"9".repeat(64)}` }), protocolError);
  const r = vector.signature.slice(2, 66), highS = (0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n / 2n + 1n)
    .toString(16).padStart(64, "0");
  await assert.rejects(verifyRedemption(redemptionWithSignature(`0x${r}${highS}1b`), valid), protocolError);
});

test("outer authentication rejects altered input and non-exact or chain-zero authorization", async () => {
  const pinned = intent("pinned"), empty = intent("empty");
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...vector.type2.raw, input: "0x12345678" },
    vector.type2.hash, pinned), protocolError);
  const authorization = vector.type4.raw.authorizationList[0];
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...vector.type4.raw,
    authorizationList: [{ ...authorization, chainId: "0x0" }] }, vector.type4.hash, empty), protocolError);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...vector.type4.raw,
    authorizationList: [{ ...authorization, unexpected: "0x0" }] }, vector.type4.hash, empty), protocolError);
});

test("receipt accounting rejects extra debit, wrong count, and wrong membership", () => {
  const value = intent("pinned"), row = mmRegistry(8453).row;
  const logs = settlementLogs(value);
  assert.deepEqual(verifyMetaMaskReceiptAccounting(value, vector.relayer, logs), {
    deliveredAtomic: "900000", feeAtomic: "100000", debitAtomic: "1000000",
    firstTransferIndexAtomic: "1", secondTransferIndexAtomic: "2", counterIndexAtomic: "0",
  });
  const extra = [...logs, { ...logs[1]!, address: vector.relayer as Address, logIndexAtomic: "3" }];
  assert.throws(() => verifyMetaMaskReceiptAccounting(value, vector.relayer, extra), protocolError);
  const wrongCount = [{ ...logs[0]!, data: `${word(1n)}${word(2n).slice(2)}` as Hex }, ...logs.slice(1)];
  assert.throws(() => verifyMetaMaskReceiptAccounting(value, vector.relayer, wrongCount), protocolError);
  const scan = rawScanLog(value, vector.type2.hash, 100n);
  assert.equal(verifyScanLog(scan, value, 100n, 100n), vector.type2.hash);
  assert.throws(() => verifyScanLog({ ...scan, topics: [MM_INCREASED_COUNT_TOPIC,
    addressWord(row.protocol.manager.address), addressWord(vector.relayer), `0x${"8".repeat(64)}`] },
  value, 100n, 100n), protocolError);
});

function intent(designation: "empty" | "pinned"): MetaMaskGaslessIntent {
  const deployment = mmRegistry(8453), row = deployment.row;
  const executions = vector.executions as MetaMaskGaslessIntent["quote"]["executions"];
  const quote = { netAtomic: "900000", feeAtomic: "100000", feeRecipient: vector.feeRecipient as Address,
    executions, hash: "" };
  quote.hash = mmQuoteHash(quote);
  const block = { numberAtomic: "100", hash: `0x${"a".repeat(64)}` as Hex, timestampAtomic: "1788912000" };
  const snapshot = { chainId: 8453 as const, endpointHash: "1".repeat(64), endpointOrigin: "https://rpc.example",
    observedAt: "2026-09-09T00:00:00.000Z", safeBlock: block, headBlock: block,
    safeState: chainState(designation, "0"), headState: chainState(designation, "0") };
  return { profile: "synthetic", request: { chainId: 8453, recipient: vector.recipient,
    grossAtomic: "1000000", maxFeeAtomic: "100000", minReceivedAtomic: "900000" },
    binding: { providerId: "metamask-agent-wallet", address: vector.owner,
      accountBindingHash: "2".repeat(64), capabilityHash: "3".repeat(64), revision: 1,
      projectHash: "4".repeat(64), walletReferenceHash: "5".repeat(64),
      walletIdHash: mmWalletIdentityHash(vector.owner), namespace: "eip155", mode: "server", environment: "prod" },
    token: row.token, decimals: 6, deploymentEvidenceHash: deployment.deploymentEvidenceHash,
    initialSnapshot: snapshot, quote, requestId: "synthetic-request", preparedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:05:00.000Z", policyHash: "6".repeat(64),
    unsignedDelegation: vector.unsignedDelegation, delegationHash: vector.delegationHash,
    signingDigest: vector.signingDigest, relayTo: row.protocol.manager.address, mode: vector.mode } as MetaMaskGaslessIntent;
}

function chainState(designation: "empty" | "pinned", counterAtomic: string): MetaMaskGaslessChainState {
  const row = mmRegistry(8453).row;
  const code = designation === "empty" ? "0x" : `0xef0100${row.protocol.delegate.address.slice(2)}`;
  return { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([name, pin]) =>
    [name, pin.codeHash])) as MetaMaskGaslessChainState["protocolCodeHashes"], tokenProxyCodeHash: row.tokenProxyCodeHash,
    tokenImplementationAddress: row.tokenImplementationAddress, tokenImplementationCodeHash: row.tokenImplementationCodeHash,
    tokenDecimals: 6, ownerCodeHash: keccak256(code as Hex), designation, usdcBalanceAtomic: "1000000", counterAtomic };
}

function redemptionWithSignature(signature: Hex): Hex {
  const d = vector.unsignedDelegation;
  const context = encodeAbiParameters([MM_DELEGATION_PARAMETER], [[{ ...d, salt: BigInt(d.salt), signature }]]);
  return encodeFunctionData({ abi: redeemAbi, functionName: "redeemDelegations",
    args: [[context], [vector.mode], [vector.executionCallData]] });
}

function settlementLogs(value: MetaMaskGaslessIntent): readonly MmReceiptLog[] {
  const row = mmRegistry(8453).row;
  return [{ address: row.protocol.limitedCalls.address,
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address),
      addressWord(vector.relayer), value.delegationHash], data: `${word(1n)}${word(1n).slice(2)}` as Hex, logIndexAtomic: "0" },
  { address: row.token, topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.recipient)],
    data: word(900000n), logIndexAtomic: "1" },
  { address: row.token, topics: [MM_TRANSFER_TOPIC, addressWord(vector.owner), addressWord(vector.feeRecipient)],
    data: word(100000n), logIndexAtomic: "2" }];
}

function rawScanLog(value: MetaMaskGaslessIntent, transactionHash: Hex, number: bigint): Json {
  const row = mmRegistry(8453).row;
  return { address: row.protocol.limitedCalls.address, removed: false, blockNumber: `0x${number.toString(16)}`,
    blockHash: `0x${"a".repeat(64)}`, transactionHash, logIndex: "0x0",
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address),
      addressWord(vector.relayer), value.delegationHash], data: `${word(1n)}${word(1n).slice(2)}` };
}

const protocolError = { code: "APN_RPC_PROTOCOL" };
