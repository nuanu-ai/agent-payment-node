/** Explicit Circle V2 Base source submission. Source success never implies Solana delivery. */
import { getAddress, keccak256 } from "viem";
import { getBase58Encoder } from "@solana/kit";
import { inspectCircleV2PreflightedDraft } from "./circle-v2-draft.js";
import { prepareCircleV2BaseSourceReadOnly } from "./circle-v2-source-preparation.js";
import { bindCircleV2SourcePreparationToJournal } from "./circle-v2-source-journal.js";
import {} from "./circle-v2-preflight.js";
import { NonEvmSourceJournalRepository } from "./non-evm-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeRecord, BRIDGE_MIN_REMAINING_MS } from "./validation.js";
const ROUTE = "base_usdc_to_solana_usdc_circle_cctp_v2";
function blocked(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_source_execution_${reason}`); }
function assertSolanaOwner(wallet) {
    try {
        if (getBase58Encoder().encode(wallet).length !== 32)
            blocked("solana_wallet_owner");
    }
    catch {
        blocked("solana_wallet_owner");
    }
}
/** Requires an exact imported signer and fresh quote, validation, pinned simulation, allowance, nonce and gas reads. */
export async function submitCircleV2BaseSourceBurn(intent, ports) {
    const now = ports.now ?? Date.now;
    const payer = bridgeAddress(intent.payer);
    if (bridgeAddress(ports.signer.address) !== payer || ports.signer.kind !== "imported_evm_signer")
        blocked("signer_owner");
    assertSolanaOwner(intent.solanaWalletOwner);
    const input = await ports.freshDraft();
    const quote = bridgeRecord(input.quoteResponse);
    const issuedAt = quote.issuedAt;
    const current = now();
    if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) ||
        issuedAt * 1000 > current + 30_000 || current - issuedAt * 1000 > 60_000)
        blocked("quote_freshness");
    if (bridgeAddress(input.payer) !== payer || input.recipientWallet !== intent.solanaWalletOwner ||
        input.recipientSetup !== intent.recipientSetup)
        blocked("recipient_or_payer");
    const draft = await inspectCircleV2PreflightedDraft(input, ports.preflight);
    if (draft.recipientAta !== intent.solanaRecipientAta)
        blocked("recipient_ata");
    const p = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
    if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("expiry_margin");
    const expiry = bridgeRecord(p.quote.expiry);
    if (expiry.mode === "BLOCK_NUMBER" && (typeof expiry.expiresAtBlock !== "number" ||
        BigInt(expiry.expiresAtBlock) - BigInt(p.sourceBlock.number) < 5n))
        blocked("block_expiry_margin");
    await ports.approve(p);
    if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("approval_expired");
    // Consent can outlast a Base block. Refresh Circle validation, canonical simulation and balances before sealing.
    const afterConsent = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
    if (afterConsent.quoteHash !== p.quoteHash || afterConsent.draftIntegrityDigest !== p.draftIntegrityDigest ||
        afterConsent.recipient.wallet !== p.recipient.wallet || afterConsent.recipient.ata !== p.recipient.ata ||
        afterConsent.transaction.from !== p.transaction.from || afterConsent.transaction.to !== p.transaction.to ||
        afterConsent.transaction.data !== p.transaction.data || afterConsent.transaction.nonceAtomic !== p.transaction.nonceAtomic ||
        BigInt(afterConsent.transaction.gasLimitAtomic) > BigInt(p.transaction.gasLimitAtomic) ||
        BigInt(afterConsent.transaction.maxFeePerGasWei) > BigInt(p.transaction.maxFeePerGasWei) ||
        BigInt(afterConsent.transaction.maxPriorityFeePerGasWei) > BigInt(p.transaction.maxPriorityFeePerGasWei) ||
        Date.parse(afterConsent.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("post_approval_drift");
    const refreshedExpiry = bridgeRecord(afterConsent.quote.expiry);
    if (refreshedExpiry.mode === "BLOCK_NUMBER" && (typeof refreshedExpiry.expiresAtBlock !== "number" ||
        BigInt(refreshedExpiry.expiresAtBlock) - BigInt(afterConsent.sourceBlock.number) < 5n))
        blocked("post_approval_expiry");
    const binding = bindCircleV2SourcePreparationToJournal({ preparation: p, route: ROUTE, payer,
        draftIntegrityDigest: draft.integrityDigest, preparationDigest: p.preparationDigest,
        profileHash: intent.profileHash, operationId: intent.operationId, createdAt: new Date(now()).toISOString(),
        admission: { claimedValidationHash: intent.claimedValidationHash, note: "live_source_execution", minFinalityThreshold: intent.minFinalityThreshold } });
    let j = await ports.journal.stageV2({ ...binding.binding,
        schemaVersion: "apn.non-evm-source-journal.v2", protocolInputHash: binding.protocolInputHash });
    if (j.phase !== "staged_untrusted")
        blocked("already_started");
    j = await ports.journal.signingStarted(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
    const tx = p.transaction, nonce = BigInt(tx.nonceAtomic);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("signing_expired");
    const raw = await ports.signer.signTransaction({ type: "eip1559", chainId: 8453, to: getAddress(tx.to),
        data: tx.data, value: 0n, nonce: Number(nonce), gas: BigInt(tx.gasLimitAtomic),
        maxFeePerGas: BigInt(tx.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei), accessList: [] });
    j = await ports.journal.seal(j.profileHash, j.operationId, j.integrityHash, raw, tx.nonceAtomic, new Date(now()).toISOString());
    // Once the journal records an attempt, no failure path retries or re-signs this nonce.
    j = await ports.journal.committingSubmission(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
    const hash = j.transactionHash;
    let phase = "unknown_finality";
    try {
        const returned = await ports.sendRawTransaction(raw);
        if (returned.toLowerCase() !== hash.toLowerCase() || keccak256(raw) !== hash)
            blocked("send_hash");
        j = await ports.journal.observePending(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
        phase = "submitted_pending";
    }
    catch {
        j = await ports.journal.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "send_result_ambiguous", new Date(now()).toISOString());
    }
    return { journal: j, sourceTransactionHash: hash, sourceState: phase,
        circleAttestationObserved: false, solanaDestinationFinalized: false, bridgeCompletion: false };
}
//# sourceMappingURL=circle-v2-source-execution.js.map