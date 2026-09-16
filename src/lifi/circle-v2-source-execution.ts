/** Explicit Circle V2 Base source submission. Source success never implies Solana delivery. */
import { getAddress, keccak256, type Hex } from "viem";
import { getBase58Encoder } from "@solana/kit";
import { inspectCircleV2PreflightedDraft, type CircleV2DraftInput } from "./circle-v2-draft.js";
import { prepareCircleV2BaseSourceReadOnly, type CircleV2BaseStateReader, type CircleV2SourcePreparation, type CircleV2SourcePreparationLimits } from "./circle-v2-source-preparation.js";
import { bindCircleV2SourcePreparationToJournal } from "./circle-v2-source-journal.js";
import { type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "./non-evm-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeRecord, BRIDGE_MIN_REMAINING_MS } from "./validation.js";

const ROUTE = "base_usdc_to_solana_usdc_circle_cctp_v2" as const;
function blocked(reason: string): never { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_source_execution_${reason}`); }

export interface CircleV2SourceExecutionPorts {
  /** Fetch and assemble a new Circle quote and matching calldata for this invocation. */
  readonly freshDraft: () => Promise<CircleV2DraftInput>;
  readonly preflight: CircleV2PreflightTransport;
  readonly readBase: CircleV2BaseStateReader;
  /** Imported local EVM signer; never a generated or delegated account. */
  readonly signer: Readonly<{ kind: "imported_evm_signer"; address: string; signTransaction: (tx: Readonly<{
    type: "eip1559"; chainId: 8453; to: Hex; data: Hex; value: bigint; nonce: number;
    gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; accessList: readonly [];
  }>) => Promise<Hex> }>;
  readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
  readonly approve: (preparation: CircleV2SourcePreparation) => Promise<void>;
  readonly journal: NonEvmSourceJournalRepository;
  readonly now?: () => number;
}
export interface CircleV2SourceExecutionIntent {
  readonly payer: string;
  readonly solanaWalletOwner: string;
  readonly solanaRecipientAta: string;
  readonly recipientSetup: "existing_ata" | "create_ata";
  readonly profileHash: string;
  readonly operationId: string;
  readonly limits: CircleV2SourcePreparationLimits;
  readonly claimedValidationHash: string;
  readonly minFinalityThreshold: 1000 | 2000;
}
export interface CircleV2SourceSubmission {
  readonly journal: NonEvmSourceJournal;
  readonly sourceTransactionHash: Hex;
  readonly sourceState: "submitted_pending" | "unknown_finality";
  readonly circleAttestationObserved: false;
  readonly solanaDestinationFinalized: false;
  readonly bridgeCompletion: false;
}
function assertSolanaOwner(wallet: string): void {
  try { if (getBase58Encoder().encode(wallet).length !== 32) blocked("solana_wallet_owner"); }
  catch { blocked("solana_wallet_owner"); }
}

/** Requires an exact imported signer and fresh quote, validation, pinned simulation, allowance, nonce and gas reads. */
export async function submitCircleV2BaseSourceBurn(intent: CircleV2SourceExecutionIntent,
  ports: CircleV2SourceExecutionPorts): Promise<CircleV2SourceSubmission> {
  const now = ports.now ?? Date.now;
  const payer = bridgeAddress(intent.payer);
  if (bridgeAddress(ports.signer.address) !== payer || ports.signer.kind !== "imported_evm_signer") blocked("signer_owner");
  assertSolanaOwner(intent.solanaWalletOwner);
  const input = await ports.freshDraft();
  const quote = bridgeRecord(input.quoteResponse);
  const issuedAt = quote.issuedAt;
  const current = now();
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) ||
    issuedAt * 1000 > current + 30_000 || current - issuedAt * 1000 > 60_000) blocked("quote_freshness");
  if (bridgeAddress(input.payer) !== payer || input.recipientWallet !== intent.solanaWalletOwner ||
    input.recipientSetup !== intent.recipientSetup) blocked("recipient_or_payer");
  const draft = await inspectCircleV2PreflightedDraft(input, ports.preflight);
  if (draft.recipientAta !== intent.solanaRecipientAta) blocked("recipient_ata");
  const p = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
  if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS) blocked("expiry_margin");
  const expiry = bridgeRecord(p.quote.expiry);
  if (expiry.mode === "BLOCK_NUMBER" && (typeof expiry.expiresAtBlock !== "number" ||
    BigInt(expiry.expiresAtBlock) - BigInt(p.sourceBlock.number) < 5n)) blocked("block_expiry_margin");
  await ports.approve(p);
  if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS) blocked("approval_expired");
  // Consent can outlast a Base block. Refresh Circle validation, canonical simulation and balances before sealing.
  const afterConsent = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
  if (afterConsent.quoteHash !== p.quoteHash || afterConsent.draftIntegrityDigest !== p.draftIntegrityDigest ||
    afterConsent.recipient.wallet !== p.recipient.wallet || afterConsent.recipient.ata !== p.recipient.ata ||
    afterConsent.transaction.from !== p.transaction.from || afterConsent.transaction.to !== p.transaction.to ||
    afterConsent.transaction.data !== p.transaction.data || afterConsent.transaction.nonceAtomic !== p.transaction.nonceAtomic ||
    BigInt(afterConsent.transaction.gasLimitAtomic) > BigInt(p.transaction.gasLimitAtomic) ||
    BigInt(afterConsent.transaction.maxFeePerGasWei) > BigInt(p.transaction.maxFeePerGasWei) ||
    BigInt(afterConsent.transaction.maxPriorityFeePerGasWei) > BigInt(p.transaction.maxPriorityFeePerGasWei) ||
    Date.parse(afterConsent.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS) blocked("post_approval_drift");
  const refreshedExpiry = bridgeRecord(afterConsent.quote.expiry);
  if (refreshedExpiry.mode === "BLOCK_NUMBER" && (typeof refreshedExpiry.expiresAtBlock !== "number" ||
    BigInt(refreshedExpiry.expiresAtBlock) - BigInt(afterConsent.sourceBlock.number) < 5n)) blocked("post_approval_expiry");
  const binding = bindCircleV2SourcePreparationToJournal({ preparation: p, route: ROUTE, payer,
    draftIntegrityDigest: draft.integrityDigest, preparationDigest: p.preparationDigest,
    profileHash: intent.profileHash, operationId: intent.operationId, createdAt: new Date(now()).toISOString(),
    admission: { claimedValidationHash: intent.claimedValidationHash, note: "live_source_execution", minFinalityThreshold: intent.minFinalityThreshold } });
  let j: NonEvmSourceJournal = await ports.journal.stageV2({ ...binding.binding,
    schemaVersion: "apn.non-evm-source-journal.v2", protocolInputHash: binding.protocolInputHash });
  if (j.phase !== "staged_untrusted") blocked("already_started");
  j = await ports.journal.signingStarted(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
  const tx = p.transaction, nonce = BigInt(tx.nonceAtomic);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS) blocked("signing_expired");
  const raw = await ports.signer.signTransaction({ type: "eip1559", chainId: 8453, to: getAddress(tx.to),
    data: tx.data as Hex, value: 0n, nonce: Number(nonce), gas: BigInt(tx.gasLimitAtomic),
    maxFeePerGas: BigInt(tx.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei), accessList: [] });
  j = await ports.journal.seal(j.profileHash, j.operationId, j.integrityHash, raw, tx.nonceAtomic, new Date(now()).toISOString());
  // Once the journal records an attempt, no failure path retries or re-signs this nonce.
  j = await ports.journal.committingSubmission(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
  const hash = j.transactionHash as Hex;
  let phase: CircleV2SourceSubmission["sourceState"] = "unknown_finality";
  try {
    const returned = await ports.sendRawTransaction(raw);
    if (returned.toLowerCase() !== hash.toLowerCase() || keccak256(raw) !== hash) blocked("send_hash");
    j = await ports.journal.observePending(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
    phase = "submitted_pending";
  } catch {
    j = await ports.journal.observeUnknown(j.profileHash, j.operationId, j.integrityHash,
      "send_result_ambiguous", new Date(now()).toISOString());
  }
  return { journal: j, sourceTransactionHash: hash, sourceState: phase,
    circleAttestationObserved: false, solanaDestinationFinalized: false, bridgeCompletion: false };
}
