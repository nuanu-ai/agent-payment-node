import assert from "node:assert/strict";
import { getAddress } from "viem";
import { ApnError } from "../../src/errors.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ApnCore } from "../../src/core.js";
import { hashObject } from "../../src/canonical.js";
import { AllowlistPolicyStore } from "../../src/allowlist-policy-store.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import type { WaitPort } from "../../src/ports.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { LocalGaslessCustody } from "../../src/gasless/custody.js";
import type { GaslessAccountState, GaslessChainId, GaslessFees, GaslessGas, GaslessIntent, GaslessObservation, GaslessRequest,
  GaslessSnapshot } from "../../src/gasless/model.js";
import type { GaslessOperationRecord } from "../../src/gasless/operation-model.js";
import type { OperationAbandonApprovalPort } from "../../src/operation-abandon-approval.js";
import type { GaslessApprovalPort, GaslessCustodyPort, GaslessRpcPort, GaslessSealedMaterial } from "../../src/gasless/ports.js";
import { gaslessDeployment, gaslessProtocolHash } from "../../src/gasless/registry.js";
import { gaslessPolicyChain, localGaslessMechanism } from "../../src/gasless/asset-policy.js";
import { gaslessFailure } from "../../src/gasless/validation.js";

export const GASLESS_TEST_RECIPIENT = getAddress("0x4444444444444444444444444444444444444444");
export const GASLESS_TEST_OUTER = getAddress("0x5555555555555555555555555555555555555555");
export const testWord = (value: string): Hex => `0x${hashObject(value)}`;
export class GaslessWrapping implements WrappingSecretPort {
  loads = 0; creates = 0;
  async load() { this.loads++; return Buffer.alloc(32, 73); }
  async create(): Promise<Buffer> { this.creates++; throw new Error("No wrapping creation in gasless tests"); }
}
export class GaslessApproval implements GaslessApprovalPort {
  calls: Parameters<GaslessApprovalPort["confirm"]>[0][] = []; accepted = true;
  async confirm(input: Parameters<GaslessApprovalPort["confirm"]>[0]) { this.calls.push(input); return this.accepted; }
}
/** Records guard retry pauses without sleeping. */
export class GaslessWait implements WaitPort {
  waits: number[] = [];
  nowMs() { return 0; }
  async wait(milliseconds: number) { this.waits.push(milliseconds); return "elapsed" as const; }
}
export class GaslessTestRpc implements GaslessRpcPort {
  readonly rpcOrigin: string; readonly rpcEndpointHash: string;
  readonly bundlerOrigin = "https://bundler.example"; readonly bundlerEndpointHash = hashObject("bundler");
  calls: string[] = []; sends: GaslessSealedMaterial[] = [];
  current: GaslessSnapshot;
  result: "safe" | "pending" | "missing" | "throw" = "safe";
  branch: "sponsored" | "post_op_reverted" | "prefund_too_low" = "sponsored";
  success = true; residual = "100"; safeAllowance: string | undefined;
  safeNumber = "102"; timeout = false; estimateFails = false; oversizedEstimate = false;
  mirrorResult: "fit" | "misfit" | "unavailable" = "fit";
  /** Approved-fee snapshots that report bundler fee drift before passing again. */
  drift = 0; approvedFees: GaslessFees[] = []; estimateFees: (GaslessFees | undefined)[] = [];
  /** Transport failures and unavailable mirror estimates that clear after the given number of calls. */
  transport = 0; mirrorUnavailable = 0;
  constructor(readonly chainId: GaslessChainId, owner: Address, delegation: "empty" | "expected", readonly now: Date) {
    this.rpcOrigin = `https://rpc-${chainId}.example`; this.rpcEndpointHash = hashObject(this.rpcOrigin);
    const row = gaslessDeployment(chainId);
    this.current = { chainId, rpcOrigin: this.rpcOrigin, rpcEndpointHash: this.rpcEndpointHash,
      bundlerOrigin: this.bundlerOrigin, bundlerEndpointHash: this.bundlerEndpointHash,
      block: { numberAtomic: "100", hash: testWord("100"), timestampAtomic: Math.floor(now.getTime() / 1000).toString() },
      protocolHash: gaslessProtocolHash(row), owner, token: row.token, balanceAtomic: "100000000", nativeBalanceWei: "0",
      allowanceAtomic: "0", permitNonceAtomic: "7", entryPointNonceAtomic: "9", eoaNonceAtomic: "1", pendingEoaNonceAtomic: "1",
      delegation, feeConfiguration: { additionalGasCharge: "35000", feeSpread: "100", nativeTokenPrice: "2500000000" },
      baseFeePerGas: "1000000", maxFeePerGas: "2100000", maxPriorityFeePerGas: "100000" };
  }
  async assertChain() { this.calls.push("assertChain"); }
  async snapshot(owner: Address, approvedGas?: GaslessGas) {
    this.calls.push("snapshot"); assert.equal(owner, this.current.owner);
    if (this.transport > 0) { this.transport -= 1; throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable."); }
    if (approvedGas !== undefined) {
      this.approvedFees.push({ maxFeePerGas: approvedGas.maxFeePerGas, maxPriorityFeePerGas: approvedGas.maxPriorityFeePerGas });
      if (this.drift > 0) { this.drift -= 1; gaslessFailure("APN_OPERATION_BLOCKED", "gasless_bundler_fee_drift"); }
    }
    return structuredClone(this.current);
  }
  async mirrorEstimate(intent: GaslessIntent, _fees?: GaslessFees) {
    this.calls.push("mirror_estimate");
    if (this.mirrorUnavailable > 0) { this.mirrorUnavailable -= 1; gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_mirror_estimate_unavailable"); }
    if (this.mirrorResult === "unavailable") gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_mirror_estimate_unavailable");
    if (this.mirrorResult === "misfit") gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_mirror_estimate_bounds");
    return this.fixtureEstimate(intent, "mirror");
  }
  /** Calibrated v4 chains use their 2026-09-15 mirror sizes; other chains keep the historical fixture sizes. */
  private fixtureEstimate(intent: GaslessIntent, label: string) {
    const measured = this.chainId === 1 || this.chainId === 137, empty = intent.initialSnapshot.delegation === "empty";
    return { verificationGasLimit: measured ? "61585" : "90000",
      callGasLimit: this.oversizedEstimate ? "250001" : measured ? (this.chainId === 137 ? "95736" : "84248") : "200000",
      paymasterVerificationGasLimit: measured ? (this.chainId === 137 ? "576312" : "400530") : "180000", paymasterPostOpGasLimit: "35000",
      preVerificationGas: measured ? (empty ? "81835" : "57000") : empty ? "140000" : "120000", responseHash: hashObject(label) };
  }
  async estimate(intent: GaslessIntent, _bootstrap?: unknown, fees?: GaslessFees) {
    this.calls.push("estimate"); this.estimateFees.push(fees); if (this.estimateFails) throw new Error("canary_provider_secret");
    return this.fixtureEstimate(intent, "estimate");
  }
  async send(_intent: GaslessIntent, material: Parameters<GaslessRpcPort["send"]>[1]) {
    this.calls.push("send"); this.sends.push(structuredClone(material));
    if (this.timeout) throw new Error("canary_send_secret");
    return material.userOperationHash;
  }
  async observe(intent: GaslessIntent, identity: Parameters<GaslessRpcPort["observe"]>[1],
    cursor: Parameters<GaslessRpcPort["observe"]>[2]): Promise<GaslessObservation> {
    this.calls.push("observe");
    if (this.result === "throw") throw new Error("canary_observer_secret");
    const empty = { status: "unresolved" as const, transactionHash: null, settlement: null, cursor,
      evidenceHash: null, reason: "gasless_receipt_unresolved" };
    if (identity.userOperationHash === null || this.sends.length === 0 || this.result === "missing") return empty;
    if (this.result === "pending") return { ...empty, status: "pending", transactionHash: testWord("transaction"), evidenceHash: hashObject("pending"), reason: null };
    const i = intent.initialSnapshot, p = BigInt(intent.feeCapAtomic) - 100n;
    const refund = this.branch === "sponsored" ? p / 4n : 0n;
    const effectAccount: GaslessAccountState = { owner: i.owner, balanceAtomic: "80000000", nativeBalanceWei: "0",
      allowanceAtomic: this.success ? "0" : this.residual, permitNonceAtomic: (BigInt(i.permitNonceAtomic) + 1n).toString(),
      entryPointNonceAtomic: (BigInt(i.entryPointNonceAtomic) + 1n).toString(),
      eoaNonceAtomic: (BigInt(i.eoaNonceAtomic) + (i.delegation === "empty" ? 1n : 0n)).toString(),
      pendingEoaNonceAtomic: (BigInt(i.eoaNonceAtomic) + (i.delegation === "empty" ? 1n : 0n)).toString(), delegation: "expected" };
    const settlement = { chainId: this.chainId, userOperationHash: identity.userOperationHash,
      transactionHash: testWord("transaction"), block: { numberAtomic: "101", hash: testWord("101"), timestampAtomic: i.block.timestampAtomic },
      safeBlock: { numberAtomic: this.safeNumber, hash: testWord(this.safeNumber), timestampAtomic: i.block.timestampAtomic },
      outerSender: GASLESS_TEST_OUTER, transactionProofHash: hashObject("outer"), receiptHash: hashObject("receipt"),
      protocolHash: i.protocolHash, effectAccount,
      safeAccount: { ...effectAccount, allowanceAtomic: this.safeAllowance ?? effectAccount.allowanceAtomic },
      accounting: { success: this.success, branch: this.branch, prefundAtomic: p.toString(), refundAtomic: refund.toString(),
        feeAtomic: (p - refund).toString(), deliveredAtomic: this.success ? intent.recipientAtomic : "0", logsHash: hashObject("logs") } };
    return { status: "safe", transactionHash: settlement.transactionHash, settlement,
      cursor: { startBlock: cursor.startBlock, nextBlockAtomic: "101", previousEndBlock: cursor.startBlock },
      evidenceHash: hashObject(settlement), reason: null };
  }
}
export async function gaslessFixture(root: string, chainId: GaslessChainId = 8453, options: {
  now?: Date; wrapping?: GaslessWrapping; rpc?: GaslessTestRpc; key?: Hex; initializeWallet?: boolean;
  activatePolicy?: boolean;
  delegation?: "empty" | "expected"; custody?: GaslessCustodyPort; abandonApproval?: OperationAbandonApprovalPort;
} = {}) {
  const now = options.now ?? new Date("2026-09-09T00:00:00.000Z"), key = options.key ?? generatePrivateKey();
  const account = privateKeyToAccount(key), profile = "gasless-local", state = new StateStore(root);
  const wrapping = options.wrapping ?? new GaslessWrapping(), wallets = new EncryptedWalletStore(state, wrapping);
  await state.initialize();
  if (options.initializeWallet !== false) {
    const identity = { profile, address: account.address, chainId: 8453 as const, createdAt: now.toISOString(),
      bindingHash: hashObject({ profile, address: account.address, createdAt: now.toISOString() }) };
    await wallets.save(identity, { version: "apn.wallet-secret.v1", privateKey: key, directEffects: {}, x402Effects: {} }, Buffer.alloc(32, 73));
    await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile, profileHash: state.profileHash(profile),
      address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash }));
  }
  if (gaslessPolicyChain(chainId) !== null && options.initializeWallet !== false && options.activatePolicy !== false) {
    const store = new AllowlistPolicyStore(root), row = gaslessDeployment(chainId);
    const record = await store.stage({ profile, now, policy: { schemaVersion: "apn.allowlist-policy-file.v1",
      overlayVersion: "gasless-fixture.1", accounts: { evm: account.address },
      effectiveAt: new Date(now.getTime() - 1_000).toISOString(),
      admissions: [{ chain: gaslessPolicyChain(chainId)!, kind: "token", identifier: row.token, rail: "gasless",
        maximumPerTransferAtomic: "100000000", dailyLimitAtomic: "1000000000",
        mechanism: localGaslessMechanism(chainId) }] } });
    await store.appendDecision(profile, null, { status: "active", revision: record.revision,
      stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
      registry: record.registry, approvalFingerprint: hashObject("gasless-fixture-policy"), decidedAt: now.toISOString() });
  }
  const rpc = options.rpc ?? new GaslessTestRpc(chainId, account.address, options.delegation ?? "empty", now);
  const approval = new GaslessApproval(), custody = options.custody ?? new LocalGaslessCustody(state, wrapping, () => now.getTime());
  const dependencies = { rpcFor: (chain: GaslessChainId) => { assert.equal(chain, rpc.chainId); return rpc; }, custody, approval };
  const wait = new GaslessWait();
  const core = new ApnCore({ state, gasless: dependencies, clock: { now: () => new Date(now) }, wait,
    ...(options.abandonApproval ? { operationAbandonApproval: options.abandonApproval } : {}) });
  const request: GaslessRequest = { chainId, recipient: GASLESS_TEST_RECIPIENT, grossAtomic: "10000000", maxFeeAtomic: "200000", minReceivedAtomic: "9800000" };
  const prepare = async (idempotencyKey = "gasless-fixture-0001") => {
    const input = { command: "gasless.transfer.prepare", profile, request, idempotencyKey } as const;
    const result = await core.execute(input); assert.equal(result.ok, true, result.error?.message);
    const id = (result.operation as { operation_id: string }).operation_id;
    const operation = (await core.gasless.records.findOperation(id))!;
    return { id, input, operation };
  };
  const record = async (id: string): Promise<GaslessOperationRecord> => (await core.gasless.records.findOperation(id))!;
  return { now, key, account, profile, state, wrapping, wallets, rpc, approval, custody, dependencies, core, request, prepare, record, wait };
}
