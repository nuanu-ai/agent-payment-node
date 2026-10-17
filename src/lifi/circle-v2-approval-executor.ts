/** One-shot, durable Base USDC allowance effect. This does not execute a Circle transfer. */
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalIncluded } from "./transaction.js";
import { prepareCircleV2BaseUsdcApprovalReadOnly, type CircleV2ApprovalLimits, type CircleV2ApprovalPreparation, type CircleV2ApprovalStateReader } from "./circle-v2-approval-preparation.js";
import type { BridgeProtocolReceipt } from "./model.js";
import type { BridgeRpcPort } from "./ports.js";
import { bridgeOwner } from "./owner.js";
import { BRIDGE_MIN_REMAINING_MS, bridgeAddress, bridgeFailure, bridgeHex, bridgeUint } from "./validation.js";
import { admitOperation, assertClaimsAvailable } from "../operation-index/admission.js";
import { jsonRpcBatchReader, provesUnlanded, readEvmUnlandedEvidence, type EvmBatchRead, type EvmUnlandedEvidence } from "../evm-unlanded-proof.js";
import { BridgeHttps } from "./https.js";
import { BRIDGE_RPC_ENV } from "./rpc-transport.js";
import { evmClaim } from "../operation-index/adapters/family-claims.js";

/**
 * Every phase of a Circle Base USDC approval, and its outcomes: a safe receipt either way, proven never sent, or proven
 * never to land (another transaction took its nonce at finality while the node knows neither it nor a receipt).
 */
export const CIRCLE_APPROVAL_PHASES = ["prepared", "signing_started", "sealed", "submitting", "unknown_finality", "completed", "confirmed_revert", "failed_before_effect",
  "failed_proven_superseded"] as const;
export type CircleApprovalPhase = typeof CIRCLE_APPROVAL_PHASES[number];
export const CIRCLE_APPROVAL_RESOLVED_PHASES: readonly CircleApprovalPhase[] = ["completed", "confirmed_revert", "failed_before_effect", "failed_proven_superseded"];
export interface CircleApprovalRecord {
  readonly schemaVersion: "apn.circle-v2-approval.v1";
  readonly id: string;
  readonly profile: string;
  readonly profileHash: string;
  readonly rpcOrigin: string;
  readonly walletBindingHash: string;
  readonly walletCreatedAt: string;
  readonly preparation: CircleV2ApprovalPreparation;
  readonly limits: CircleV2ApprovalLimits;
  readonly phase: CircleApprovalPhase;
  readonly rawTransaction: Hex | null;
  readonly transactionHash: Hex | null;
  readonly submissionAttempts: 0 | 1;
  readonly observedAllowanceAtomic: string | null;
  readonly failureReason?: string;
  /** `failed_proven_superseded` only: the payer's nonce at the `finalized` tag when status proved the approval can never land. */
  readonly finalizedNonceAtomic?: string;
  readonly integrityHash: string;
}
export interface CircleApprovalRpc {
  readonly chainId: 8453;
  readonly origin: string;
  /** This reader must obtain balance and allowance from the same fresh Base block. */
  readonly read: CircleV2ApprovalStateReader;
  send(raw: Hex): Promise<Hex>;
  /** Returns a chain-verified receipt at safe finality, or null while unresolved. */
  observe(hash: Hex): Promise<{ readonly receipt: BridgeProtocolReceipt; readonly status: "success" | "reverted"; readonly safe: true } | null>;
  /** One batch on the same endpoint: the payer's nonce at the `finalized` tag, and whether the node knows the transaction or a receipt. */
  unlanded(payer: string, hash: Hex): Promise<EvmUnlandedEvidence>;
}
export interface CircleApprovalSigner {
  sign(record: CircleApprovalRecord): Promise<Hex>;
}
export function publicCircleApproval(record: CircleApprovalRecord) {
  const { rawTransaction: _raw, ...publicRecord } = record;
  return { ...publicRecord, allowance: circleApprovalAllowance(record) };
}
/**
 * What the approval leaves on chain. A completed one leaves the Base USDC allowance it set for the Circle V2 wrapper, which
 * `apn circle source submit` spends; APN has no command that revokes it. Every other outcome changed no allowance.
 */
function circleApprovalAllowance(record: CircleApprovalRecord) {
  const p = record.preparation;
  if (record.phase === "completed") return { effect: "allowance_set", token: p.token, owner: p.transaction.from, spender: p.spender,
    approvedAtomic: p.approvalCapAtomic, observedAtCompletionAtomic: record.observedAllowanceAtomic, spentBy: "apn circle source submit",
    revoke: "none_in_apn: the allowance stays until a Circle source transfer spends it or another approve from this wallet replaces it" };
  return { effect: CIRCLE_APPROVAL_RESOLVED_PHASES.includes(record.phase) ? "allowance_unchanged" : "unknown_until_resolved" };
}

/**
 * Use APN's canonical Base RPC reader, which verifies receipt membership and safe block ancestry. Each call reads through
 * its own command session on the primary endpoint: a state read is one batch (chain identity, head, account, Base fee
 * inputs and the approval's own simulation), and the estimate and fee quote reuse it.
 */
export function circleApprovalRpcFromBridge(input: BridgeRpcPort | (() => BridgeRpcPort), proofBatch: () => EvmBatchRead): CircleApprovalRpc {
  const rpcFor = typeof input === "function" ? input : () => input, first = rpcFor();
  if (first.chainId !== 8453) bridgeFailure("APN_RPC_CONFIG", "circle_approval_base_only");
  return {
    chainId: 8453,
    origin: first.origin,
    read: async query => {
      const rpc = rpcFor(), payer = bridgeAddress(query.payer), token = bridgeAddress(query.token), spender = bridgeAddress(query.spender);
      const transaction = { chainId: 8453 as const, from: payer, to: token, data: bridgeHex(query.data), valueAtomic: "0", gasLimitAtomic: "0" };
      const account = await rpc.account(payer, spender, token, [transaction]), estimate = await rpc.estimate(transaction);
      if (account.chainId !== 8453 || account.rpcOrigin !== rpc.origin || account.owner !== payer ||
        account.token !== token || account.spender !== spender) bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_account_identity");
      const maximumGasCostAtomic = (BigInt(estimate.gasLimitAtomic) * BigInt(estimate.maxFeePerGasAtomic)).toString();
      const quote = await rpc.feeQuote({ economics: { nonceAtomic: account.latestNonceAtomic,
        gasLimitAtomic: estimate.gasLimitAtomic, maxFeePerGasAtomic: estimate.maxFeePerGasAtomic,
        maxPriorityFeePerGasAtomic: estimate.maxPriorityFeePerGasAtomic, maximumGasCostAtomic } });
      if (quote.chainId !== 8453 || BigInt(quote.totalQuoteWei) < BigInt(maximumGasCostAtomic)) bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_base_fee_quote");
      return { chainId: 8453, payer, token, spender, blockNumber: account.block.numberAtomic,
        blockHash: account.block.hash, latestNonceAtomic: account.latestNonceAtomic,
        pendingNonceAtomic: account.pendingNonceAtomic, usdcBalanceAtomic: account.balanceAtomic,
        usdcAllowanceAtomic: account.allowanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
        gasLimitAtomic: estimate.gasLimitAtomic, maxFeePerGasWei: estimate.maxFeePerGasAtomic,
        maxPriorityFeePerGasWei: estimate.maxPriorityFeePerGasAtomic, totalNativeDebitWei: quote.totalQuoteWei };
    },
    send: async raw => await rpcFor().send(raw),
    observe: async hash => {
      const rpc = rpcFor(), found = await rpc.observe(hash);
      if (found === null || found.transaction.safeBlock === null) return null;
      const tx = found.transaction, receipt = found.receipt;
      if (tx.chainId !== 8453 || tx.rpcOrigin !== rpc.origin || tx.transactionHash !== hash ||
        tx.block.numberAtomic !== receipt.blockNumberAtomic || tx.block.hash !== receipt.blockHash ||
        receipt.chainId !== 8453 || receipt.transactionHash !== hash) bridgeFailure("APN_RPC_PROTOCOL", "circle_approval_receipt_binding");
      return { receipt, status: tx.status, safe: true };
    },
    unlanded: async (payer, hash) => await readEvmUnlandedEvidence(proofBatch(), 8453, payer, hash),
  };
}

/** The never-lands proof reads the same configured Base endpoint as every other approval read, in one batch. */
export function circleApprovalProofBatch(environment: Readonly<Record<string, string | undefined>>): () => EvmBatchRead {
  return () => {
    const url = environment[BRIDGE_RPC_ENV[8453]];
    if (url === undefined || url.length === 0) bridgeFailure("APN_RPC_CONFIG", `missing_${BRIDGE_RPC_ENV[8453]}`);
    return jsonRpcBatchReader(new BridgeHttps(), url);
  };
}

class CircleApprovalJournal extends SecureStateStore {
  async load(id: string): Promise<CircleApprovalRecord | null> {
    stateIdentifier(id, "Circle approval ID");
    const value = await this.readJson(`circle-approvals/${id}.json`) as CircleApprovalRecord | null;
    if (value === null) return null;
    const { integrityHash, ...body } = value;
    if (value.schemaVersion !== "apn.circle-v2-approval.v1" || value.id !== id ||
      integrityHash !== hashObject(body) || ![0, 1].includes(value.submissionAttempts)) bridgeFailure("APN_STATE_CORRUPT", "circle_approval_journal");
    return value;
  }
  async save(record: CircleApprovalRecord): Promise<void> {
    const old = await this.load(record.id);
    if (old !== null && (old.profileHash !== record.profileHash || old.rpcOrigin !== record.rpcOrigin || old.preparation.intentDigest !== record.preparation.intentDigest ||
      record.submissionAttempts < old.submissionAttempts || (old.transactionHash !== null && old.transactionHash !== record.transactionHash) ||
      (old.rawTransaction !== null && old.rawTransaction !== record.rawTransaction))) bridgeFailure("APN_STATE_CORRUPT", "circle_approval_continuity");
    await this.initialize(); await this.ensureDirectory("circle-approvals");
    await this.writeJson(`circle-approvals/${record.id}.json`, record);
  }
}
/** Lock-free read of one approval journal (the operation index's reader). */
export async function loadCircleApproval(root: string, id: string): Promise<CircleApprovalRecord | null> {
  return await new CircleApprovalJournal(root).load(id);
}
function update(record: CircleApprovalRecord, patch: Partial<CircleApprovalRecord>): CircleApprovalRecord {
  const { integrityHash: _ignored, ...body } = { ...record, ...patch };
  return { ...body, integrityHash: hashObject(body) };
}
function bound(record: CircleApprovalRecord, now: number): void {
  if (Date.parse(record.preparation.expiresAt) - now < BRIDGE_MIN_REMAINING_MS) bridgeFailure("APN_REPREPARE_REQUIRED", "circle_approval_expired");
}
async function verifySigned(raw: Hex, record: CircleApprovalRecord): Promise<Hex> {
  bridgeHex(raw, 16 * 1024);
  const e = record.preparation.transaction;
  try {
    const t = parseTransaction(raw), from = getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized }));
    if (t.type !== "eip1559" || t.chainId !== 8453 || from !== e.from || t.to === null || t.to === undefined ||
      getAddress(t.to) !== e.to || (t.data ?? "0x") !== e.data || (t.value ?? 0n) !== 0n ||
      (t.nonce ?? 0).toString() !== e.nonceAtomic || t.gas?.toString() !== e.gasLimitAtomic ||
      t.maxFeePerGas?.toString() !== e.maxFeePerGasWei || t.maxPriorityFeePerGas?.toString() !== e.maxPriorityFeePerGasWei ||
      (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined ||
      BigInt(t.s) <= 0n || BigInt(t.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
      (t.yParity !== 0 && t.yParity !== 1) ||
      serializeTransaction(t, { r: t.r, s: t.s, yParity: t.yParity }) !== raw) throw new Error("binding");
    return keccak256(raw);
  } catch { return bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_signed_binding"); }
}

/** APN encrypted local wallet is opened solely in the signing call; no secret enters the journal. */
export class LocalCircleApprovalSigner implements CircleApprovalSigner {
  private readonly wallets: EncryptedWalletStore;
  private readonly journal: CircleApprovalJournal;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) {
    this.wallets = new EncryptedWalletStore(state, wrapping); this.journal = new CircleApprovalJournal(state.root);
  }
  async sign(record: CircleApprovalRecord): Promise<Hex> {
    if (record.phase !== "signing_started" || record.submissionAttempts !== 0 ||
      record.rawTransaction !== null || record.transactionHash !== null ||
      record.profileHash !== this.state.profileHash(record.profile) ||
      Date.parse(record.preparation.expiresAt) - Date.now() < BRIDGE_MIN_REMAINING_MS) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_signing_gate");
    const p = record.preparation, expectedData = encodeFunctionData({
      abi: parseAbi(["function approve(address spender,uint256 value) returns (bool)"]), functionName: "approve",
      args: ["0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", bridgeUint(p.approvalCapAtomic, true)],
    });
    if (p.transaction.chainId !== 8453 || p.token !== "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" ||
      p.spender !== "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408" || p.transaction.to !== p.token ||
      p.transaction.data !== expectedData || p.transaction.valueAtomic !== "0") bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_scope");
    const saved = await this.journal.load(record.id);
    if (saved === null || saved.integrityHash !== record.integrityHash) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_durable_gate");
    const wallet = await this.wallets.describe(record.profile);
    if (wallet === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_wallet_missing");
    try {
      if (wallet.identity.profile !== record.profile || wallet.identity.address !== record.preparation.transaction.from ||
        wallet.identity.bindingHash !== record.walletBindingHash || wallet.identity.createdAt !== record.walletCreatedAt) bridgeFailure("APN_WALLET_MISMATCH", "circle_approval_wallet_binding");
      const t = record.preparation.transaction, nonce = bridgeUint(t.nonceAtomic);
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "circle_approval_nonce_bound");
      return await privateKeyToAccount(wallet.secret.privateKey).signTransaction({ type: "eip1559", chainId: 8453,
        to: bridgeAddress(t.to), data: t.data as Hex, value: 0n, nonce: Number(nonce), gas: BigInt(t.gasLimitAtomic),
        maxFeePerGas: BigInt(t.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(t.maxPriorityFeePerGasWei), accessList: [] });
    } finally { this.wallets.clear(wallet.secret); }
  }
}

export class CircleV2ApprovalExecutor {
  private readonly journal: CircleApprovalJournal;
  constructor(private readonly state: StateStore, private readonly rpc: CircleApprovalRpc,
    private readonly signer: CircleApprovalSigner, private readonly limits: CircleV2ApprovalLimits,
    private readonly now: () => number = Date.now) {
    this.journal = new CircleApprovalJournal(state.root);
    if (rpc.chainId !== 8453) bridgeFailure("APN_RPC_CONFIG", "circle_approval_base_only");
  }
  async prepare(input: { readonly profile: string; readonly payer: string; readonly walletBindingHash: string;
    readonly walletCreatedAt: string; readonly approvalCapAtomic: string }): Promise<CircleApprovalRecord> {
    await this.state.initialize();
    const profileHash = this.state.profileHash(input.profile), claims = [evmClaim(8453, input.payer)];
    return await this.state.withLocks([`profile:${profileHash}`], async () => {
      // The ID is the digest of what the reads return, so the claim is written atomically once it is known (before the
      // record and before anything is signed); this check refuses an account another operation holds before any read.
      await assertClaimsAvailable(this.state, profileHash, claims);
      const p = await prepareCircleV2BaseUsdcApprovalReadOnly({ chainId: 8453, payer: input.payer,
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", spender: "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
        approvalCapAtomic: input.approvalCapAtomic }, this.rpc.read, this.limits, this.now);
      const id = hashObject({ profileHash, intentDigest: p.intentDigest });
      const existing = await this.journal.load(id);
      if (existing !== null) {
        if (existing.walletBindingHash !== input.walletBindingHash || existing.walletCreatedAt !== input.walletCreatedAt ||
          existing.profile !== input.profile) bridgeFailure("APN_OPERATION_BLOCKED", "circle_approval_existing_owner");
        return existing;
      }
      const body = { schemaVersion: "apn.circle-v2-approval.v1" as const, id, profile: input.profile, profileHash, rpcOrigin: this.rpc.origin,
        walletBindingHash: input.walletBindingHash, walletCreatedAt: input.walletCreatedAt, preparation: p, limits: this.limits,
        phase: "prepared" as const, rawTransaction: null, transactionHash: null,
        submissionAttempts: 0 as const, observedAllowanceAtomic: null };
      const record = { ...body, integrityHash: hashObject(body) };
      return await admitOperation(this.state, { family: "circle_approval", profileHash, operationId: id, idempotencyHash: null, requestHash: null },
        claims, async () => { await this.journal.save(record); return record; });
    });
  }
  async execute(id: string, confirm: (record: CircleApprovalRecord) => Promise<boolean>): Promise<CircleApprovalRecord> {
    await this.state.initialize();
    const initial = await this.journal.load(id);
    if (initial === null) bridgeFailure("APN_OPERATION_NOT_FOUND", "circle_approval_missing");
    return await this.state.withLocks([`profile:${initial.profileHash}`, `operation:${id}`], async () => {
      let r = await this.journal.load(id);
      if (r === null) bridgeFailure("APN_STATE_CORRUPT", "circle_approval_disappeared");
      if (r.rpcOrigin !== this.rpc.origin) bridgeFailure("APN_RPC_CONFIG", "circle_approval_rpc_origin_changed");
      if (r.phase !== "prepared") return await this.observe(r);
      bound(r, this.now());
      if (!await confirm(r)) { r = update(r, { phase: "failed_before_effect" }); await this.journal.save(r); return r; }
      await this.fresh(r);
      r = update(r, { phase: "signing_started" }); await this.journal.save(r);
      // A crash during signing is ambiguous: never sign again or submit automatically.
      let raw: Hex;
      try { raw = await this.signer.sign(r); }
      catch (error) { return await this.unknown(r, failureReason("signing", error)); }
      const hash = await verifySigned(raw, r);
      r = update(r, { phase: "sealed", rawTransaction: raw, transactionHash: hash }); await this.journal.save(r);
      try { await this.fresh(r); } catch (error) { return await this.unknown(r, failureReason("post_sign_guard", error)); }
      r = update(r, { phase: "submitting", submissionAttempts: 1 }); await this.journal.save(r);
      try { if (await this.rpc.send(raw) !== hash) return await this.unknown(r); }
      catch { return await this.unknown(r); }
      return await this.observe(r);
    });
  }
  async status(id: string): Promise<CircleApprovalRecord> {
    await this.state.initialize();
    const initial = await this.journal.load(id);
    if (initial === null) bridgeFailure("APN_OPERATION_NOT_FOUND", "circle_approval_missing");
    return await this.state.withLocks([`profile:${initial.profileHash}`, `operation:${id}`], async () => {
      const r = await this.journal.load(id);
      if (r === null) bridgeFailure("APN_STATE_CORRUPT", "circle_approval_disappeared");
      if (r.rpcOrigin !== this.rpc.origin) bridgeFailure("APN_RPC_CONFIG", "circle_approval_rpc_origin_changed");
      return await this.observe(r);
    });
  }
  private async fresh(record: CircleApprovalRecord): Promise<void> {
    bound(record, this.now());
    const owner = (await bridgeOwner(this.state, record.profile)).owner;
    if (owner.profileHash !== record.profileHash || owner.address !== record.preparation.transaction.from ||
      owner.walletBindingHash !== record.walletBindingHash || owner.walletCreatedAt !== record.walletCreatedAt) bridgeFailure("APN_PROFILE_DRIFT", "circle_approval_owner_changed");
    const p = record.preparation;
    const next = await prepareCircleV2BaseUsdcApprovalReadOnly({ chainId: 8453, payer: p.transaction.from,
      token: p.token, spender: p.spender, approvalCapAtomic: p.approvalCapAtomic }, this.rpc.read, record.limits, this.now);
    if (next.transaction.nonceAtomic !== p.transaction.nonceAtomic ||
      BigInt(next.transaction.gasLimitAtomic) > BigInt(p.transaction.gasLimitAtomic) ||
      BigInt(next.transaction.maxFeePerGasWei) > BigInt(p.transaction.maxFeePerGasWei) ||
      BigInt(next.transaction.maxPriorityFeePerGasWei) > BigInt(p.transaction.maxPriorityFeePerGasWei) ||
      next.transaction.from !== p.transaction.from || next.transaction.data !== p.transaction.data) bridgeFailure("APN_REPREPARE_REQUIRED", "circle_approval_fresh_bounds");
    bound(record, this.now());
  }
  private async unknown(r: CircleApprovalRecord, reason = "observation_unavailable"): Promise<CircleApprovalRecord> {
    // The durable submission marker is written before send. Without it APN has not called send.
    r = update(r, { phase: r.submissionAttempts === 0 ? "failed_before_effect" : "unknown_finality",
      failureReason: reason });
    await this.journal.save(r); return r;
  }
  private async observe(r: CircleApprovalRecord): Promise<CircleApprovalRecord> {
    if (CIRCLE_APPROVAL_RESOLVED_PHASES.includes(r.phase) || r.phase === "prepared") return r;
    if (r.submissionAttempts === 0 || r.transactionHash === null || r.rawTransaction === null) return await this.unknown(r, "no_submission_marker");
    try {
      if (await verifySigned(r.rawTransaction, r) !== r.transactionHash) throw new Error("signed hash");
      const found = await this.rpc.observe(r.transactionHash);
      if (found === null) {
        // No safe receipt. Once another transaction took its nonce at finality and the node knows neither this one nor a
        // receipt, the approval can never land: no allowance changed, and the payer's account is free again.
        const evidence = await this.rpc.unlanded(r.preparation.transaction.from, r.transactionHash);
        if (!provesUnlanded(evidence, r.preparation.transaction.nonceAtomic)) return await this.unknown(r);
        r = update(r, { phase: "failed_proven_superseded", finalizedNonceAtomic: evidence.finalizedNonce }); await this.journal.save(r); return r;
      }
      const receipt = found.receipt;
      if (found.safe !== true || receipt.chainId !== 8453 || receipt.transactionHash !== r.transactionHash) throw new Error("receipt identity");
      if (found.status === "reverted") {
        r = update(r, { phase: "confirmed_revert" }); await this.journal.save(r); return r;
      }
      const p = r.preparation;
      approvalIncluded(receipt, bridgeAddress(p.token), bridgeAddress(p.transaction.from), bridgeAddress(p.spender), p.approvalCapAtomic);
      const state = await this.rpc.read({ chainId: 8453, payer: p.transaction.from, token: p.token,
        spender: p.spender, data: p.transaction.data });
      if (state.chainId !== 8453 || bridgeAddress(state.payer) !== p.transaction.from ||
        bridgeAddress(state.token) !== p.token || bridgeAddress(state.spender) !== p.spender ||
        bridgeUint(state.blockNumber) < bridgeUint(receipt.blockNumberAtomic) ||
        bridgeUint(state.usdcAllowanceAtomic) !== bridgeUint(p.approvalCapAtomic)) throw new Error("fresh allowance");
      r = update(r, { phase: "completed", observedAllowanceAtomic: state.usdcAllowanceAtomic });
      await this.journal.save(r); return r;
    } catch { return await this.unknown(r); }
  }
}
function failureReason(stage: "signing" | "post_sign_guard", error: unknown): string {
  if (error instanceof ApnError) return `${stage}:${error.code}`;
  return `${stage}:unavailable`;
}
