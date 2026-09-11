import assert from "node:assert/strict";
import { createExactExecutionBatchTerms, createLimitedCallsTerms, hashDelegation } from "@metamask/delegation-core";
import { TypedDataEncoder } from "ethers";
import { encodeFunctionData, keccak256, parseAbi } from "viem";
import { ApnCore } from "../../src/core.js";
import { hashObject, sha256 } from "../../src/canonical.js";
import type { Address, Hex } from "../../src/model.js";
import { StateStore } from "../../src/state.js";
import { accountBindingHash, capabilityHash, metamaskDirectCapabilitySnapshot,
  type ProviderProfileRecord } from "../../src/provider-profile.js";
import { mmPrivateHash, mmWalletIdentityHash } from "../../src/metamask-gasless/identity.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessBlock, MetaMaskGaslessChainId, MetaMaskGaslessChainState,
  MetaMaskGaslessCursor, MetaMaskGaslessIntent, MetaMaskGaslessObservation, MetaMaskGaslessProviderObservation,
  MetaMaskGaslessRequest, MetaMaskGaslessRpcObservation, MetaMaskGaslessUnsignedDelegation } from "../../src/metamask-gasless/model.js";
import type { MetaMaskGaslessOperationRecord } from "../../src/metamask-gasless/operation-model.js";
import type { MetaMaskGaslessApprovalPort, MetaMaskGaslessProviderPort, MetaMaskGaslessQuoteInput,
  MetaMaskGaslessRpcPort, MetaMaskGaslessUnsignedInput } from "../../src/metamask-gasless/ports.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { MM_ANY_BENEFICIARY, MM_BATCH_MODE, MM_ROOT_AUTHORITY } from "../../src/metamask-gasless/unsigned.js";

export const MM_TEST_OWNER = "0x1111111111111111111111111111111111111111" as Address;
export const MM_TEST_RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
export const MM_TEST_FEE = "0x3333333333333333333333333333333333333333" as Address;
export const mmTestWord = (value: string): Hex => `0x${hashObject(value)}`;
const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const types = { Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
  Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }] };

export function mmTestBlock(numberAtomic: string, now: Date): MetaMaskGaslessBlock {
  return { numberAtomic, hash: mmTestWord(numberAtomic), timestampAtomic: Math.floor(now.getTime() / 1000).toString() };
}
export class MmTestApproval implements MetaMaskGaslessApprovalPort {
  calls: Parameters<MetaMaskGaslessApprovalPort["confirm"]>[0][] = [];
  accepted = true;
  hook: (() => void) | undefined;
  error: unknown;
  async confirm(input: Parameters<MetaMaskGaslessApprovalPort["confirm"]>[0]) {
    this.calls.push(input); this.hook?.();
    if (this.error !== undefined) throw this.error;
    return this.accepted;
  }
}
export class MmTestProvider implements MetaMaskGaslessProviderPort {
  calls: string[] = [];
  quotes: MetaMaskGaslessQuoteInput[] = [];
  submissions: MetaMaskGaslessIntent[] = [];
  fees = ["50000"];
  feeAt = 0;
  failSubmit = false;
  failObserve = false;
  failInspect = false;
  status: MetaMaskGaslessProviderObservation["status"] = "broadcasted";
  txHash: Hex | null = mmTestWord("transaction-a");
  beforeSubmit: ((intent: MetaMaskGaslessIntent) => Promise<void>) | undefined;
  constructor(public binding: MetaMaskGaslessBinding, readonly now: Date) {}
  async inspect() { this.calls.push("inspect"); if (this.failInspect) throw new Error("private_identity_canary"); return this.binding; }
  async quote(input: MetaMaskGaslessQuoteInput) {
    this.calls.push("quote"); this.quotes.push(structuredClone(input));
    const feeAtomic = this.fees[Math.min(this.feeAt++, this.fees.length - 1)]!;
    const executions = [input.recipient, MM_TEST_FEE].map((recipient, index) => ({ target: input.token, value: "0",
      callData: encodeFunctionData({ abi: transferAbi, functionName: "transfer",
        args: [recipient, BigInt(index === 0 ? input.netAtomic : feeAtomic)] }) })) as
      unknown as MetaMaskGaslessIntent["quote"]["executions"];
    const material = { netAtomic: input.netAtomic, feeAtomic, feeRecipient: MM_TEST_FEE, executions };
    return { ...material, hash: hashObject(material) };
  }
  async buildUnsigned(input: MetaMaskGaslessUnsignedInput) {
    this.calls.push("buildUnsigned"); const row = mmRegistry(input.chainId).row;
    const unsignedDelegation: MetaMaskGaslessUnsignedDelegation = { delegator: input.owner, delegate: MM_ANY_BENEFICIARY,
      authority: MM_ROOT_AUTHORITY, salt: `0x${"42".repeat(32)}`,
      caveats: [{ enforcer: row.protocol.limitedCalls.address, terms: createLimitedCallsTerms({ limit: 1 }), args: "0x" },
        { enforcer: row.protocol.exactBatch.address, terms: createExactExecutionBatchTerms({ executions:
          input.executions.map(execution => ({ ...execution, value: BigInt(execution.value) })) }), args: "0x" }] };
    const official = { ...unsignedDelegation, salt: BigInt(unsignedDelegation.salt),
      caveats: [...unsignedDelegation.caveats], signature: "0x" as Hex };
    return { unsignedDelegation, delegationHash: hashDelegation(official),
      signingDigest: TypedDataEncoder.hash({ name: "DelegationManager", version: "1", chainId: input.chainId,
        verifyingContract: row.protocol.manager.address }, types, official) as Hex,
      relayTo: row.protocol.manager.address, mode: MM_BATCH_MODE };
  }
  async submit(intent: MetaMaskGaslessIntent) {
    this.calls.push("submit"); this.submissions.push(structuredClone(intent)); await this.beforeSubmit?.(intent);
    if (this.failSubmit) throw new Error("private_submit_canary");
    return this.hint(intent);
  }
  async observe(intent: MetaMaskGaslessIntent) {
    this.calls.push("observe"); if (this.failObserve) throw new Error("private_observe_canary"); return this.hint(intent);
  }
  hint(intent: MetaMaskGaslessIntent): MetaMaskGaslessProviderObservation {
    return { observedAt: this.now.toISOString(), requestIdHash: mmPrivateHash("request-id", intent.requestId),
      status: this.status, txHash: this.txHash };
  }
}
export class MmTestRpc implements MetaMaskGaslessRpcPort {
  readonly endpointOrigin = "https://rpc.example";
  readonly rpcUrl = "https://rpc.example/?api_key=private_rpc_canary";
  readonly endpointHash = sha256(this.rpcUrl);
  calls: string[] = [];
  state: MetaMaskGaslessChainState;
  phase: MetaMaskGaslessObservation["phase"] = "success";
  candidate: Hex | null = mmTestWord("transaction-a");
  observedAt: string | undefined;
  constructor(readonly chainId: MetaMaskGaslessChainId, readonly now: Date, designation: "empty" | "pinned" = "empty") {
    const row = mmRegistry(chainId).row;
    this.state = { protocolCodeHashes: Object.fromEntries(Object.entries(row.protocol).map(([key, value]) =>
      [key, value.codeHash])) as MetaMaskGaslessChainState["protocolCodeHashes"], tokenProxyCodeHash: row.tokenProxyCodeHash,
      tokenImplementationAddress: row.tokenImplementationAddress, tokenImplementationCodeHash: row.tokenImplementationCodeHash,
      tokenDecimals: 6, ownerCodeHash: keccak256(designation === "empty" ? "0x" : `0xef0100${row.protocol.delegate.address.slice(2)}`),
      designation, usdcBalanceAtomic: "100000000", counterAtomic: "0" };
  }
  async balance() {
    this.calls.push("balance"); const { counterAtomic: _counter, ...state } = this.state;
    return { chainId: this.chainId, endpointHash: this.endpointHash, endpointOrigin: this.endpointOrigin,
      observedAt: this.now.toISOString(), block: mmTestBlock("100", this.now), state };
  }
  async snapshot() {
    this.calls.push("snapshot");
    return { chainId: this.chainId, endpointHash: this.endpointHash, endpointOrigin: this.endpointOrigin,
      observedAt: this.observedAt ?? this.now.toISOString(), safeBlock: mmTestBlock("100", this.now),
      headBlock: mmTestBlock("101", this.now), safeState: structuredClone(this.state), headState: structuredClone(this.state) };
  }
  async observe(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor): Promise<MetaMaskGaslessRpcObservation> {
    this.calls.push("observe"); const row = mmRegistry(this.chainId).row;
    const observedAt = this.observedAt ?? this.now.toISOString();
    const transactionBlock = mmTestBlock("102", this.now), finalityBlock = mmTestBlock("103", this.now);
    const reason = { pending: "mm_gasless_pending", unavailable: "mm_gasless_rpc_unavailable", invalid: "mm_gasless_evidence_invalid",
      reorg: "mm_gasless_scan_reorg", reverted: "mm_gasless_transaction_reverted", success: "mm_gasless_success" } as const;
    const proved = this.phase === "success" || this.phase === "reverted";
    const observation = { observedAt, phase: this.phase, reason: reason[this.phase], candidateTxHash: this.candidate,
      transactionBlock: proved ? transactionBlock : null, finalityBlock: proved ? finalityBlock : null,
      evidenceHash: proved ? hashObject("synthetic-independent-evidence") : null };
    if (this.phase !== "success") return { cursor, observation, settlement: null };
    const codes = Object.fromEntries(Object.entries(row.protocol).map(([key, value]) => [key, value.codeHash]));
    const tokenProof = (block: MetaMaskGaslessBlock) => ({ block, address: row.tokenImplementationAddress,
      codeHash: row.tokenImplementationCodeHash, proxyCodeHash: row.tokenProxyCodeHash });
    return { cursor, observation, settlement: { observedAt, txHash: this.candidate!, transactionBlock, finalityBlock,
      outerSender: "0x5555555555555555555555555555555555555555", transactionProofHash: hashObject("outer-proof"),
      receiptHash: hashObject("receipt-proof"), protocolHash: hashObject({ deploymentEvidenceHash: intent.deploymentEvidenceHash,
        receipt: { block: transactionBlock, code: codes }, finality: { block: finalityBlock, code: codes } }),
      tokenImplementationHash: hashObject({ token: row.token, receipt: tokenProof(transactionBlock), finality: tokenProof(finalityBlock) }),
      deliveredAtomic: intent.quote.netAtomic, feeAtomic: intent.quote.feeAtomic, debitAtomic: intent.request.grossAtomic,
      refundAtomic: "0", unusedGrossAtomic: "0", designation: "pinned", permission: "consumed",
      receiptCounterAtomic: "1", finalityCounterAtomic: "1" } };
  }
}

export async function mmFixture(root: string, chainId: MetaMaskGaslessChainId = 8453,
  designation: "empty" | "pinned" = "empty") {
  const state = new StateStore(root), now = new Date("2026-09-09T00:00:00.000Z"), profile = "mm-fixture";
  await state.initialize(); const capabilities = metamaskDirectCapabilitySnapshot();
  const publicProfile: ProviderProfileRecord = { schema_version: "apn.provider-profile.v1", profile,
    profile_hash: state.profileHash(profile), provider_id: "metamask-agent-wallet", public_address: MM_TEST_OWNER,
    account_binding_hash: accountBindingHash("metamask-agent-wallet", MM_TEST_OWNER),
    capability_snapshot: capabilities, capability_hash: capabilityHash(capabilities), revision: 1,
    trust_class: "provider_managed_non_custodial_signer", observed_at: now.toISOString(), drift: { state: "bound", reason: "none" } };
  await state.writeProviderProfile(publicProfile);
  const binding: MetaMaskGaslessBinding = { providerId: "metamask-agent-wallet", address: MM_TEST_OWNER,
    accountBindingHash: publicProfile.account_binding_hash, capabilityHash: publicProfile.capability_hash, revision: 1,
    projectHash: mmPrivateHash("project", "synthetic-project"), walletReferenceHash: mmPrivateHash("wallet-reference", "synthetic-wallet", "name"),
    walletIdHash: mmWalletIdentityHash(MM_TEST_OWNER), namespace: "eip155", mode: "server", environment: "prod" };
  const provider = new MmTestProvider(binding, now), rpc = new MmTestRpc(chainId, now, designation), approval = new MmTestApproval();
  const dependencies = { rpcFor: (selected: MetaMaskGaslessChainId) => { assert.equal(selected, chainId); return rpc; }, provider, approval };
  const clock = { now: () => new Date(now) }, core = new ApnCore({ state, metaMaskGasless: dependencies, clock });
  const request: MetaMaskGaslessRequest = { chainId, recipient: MM_TEST_RECIPIENT,
    grossAtomic: "10000000", maxFeeAtomic: "50000", minReceivedAtomic: "9950000" };
  const record = async (id: string): Promise<MetaMaskGaslessOperationRecord> => (await core.metaMaskGasless.records.findOperation(id))!;
  const prepare = async (idempotencyKey = "mm-fixture-1") => {
    const input = { command: "gasless.transfer.prepare", profile, request, idempotencyKey } as const;
    const result = await core.execute(input); assert.equal(result.ok, true, JSON.stringify(result.error));
    const id = (result.operation as { operation_id: string }).operation_id;
    return { id, input, operation: await record(id) };
  };
  const restart = () => new ApnCore({ state: new StateStore(root), metaMaskGasless: dependencies, clock });
  return { state, now, profile, publicProfile, binding, provider, rpc, approval, dependencies, clock, core, request, prepare, record, restart };
}
