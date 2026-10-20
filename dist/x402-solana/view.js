import { chainDisplay } from "../chain-policy.js";
import { sellerValue } from "../x402-offer-terms.js";
import { X402_SOLANA_MECHANISM } from "./constants.js";
/** The public projection CLI, MCP and `apn operation status` return. No signature bytes or signed transaction leave the record. */
export function publicX402Solana(record, pending = null) {
    const t = record.terms, response = record.response;
    return {
        schema_version: "apn.x402-solana-status.v1", kind: record.kind, operation_id: record.operationId, profile: record.profile,
        state: record.state, terminal: record.terminal, pending_reason: pending,
        network: t.network, chain: t.chain, payer: t.payer, mint: t.mint, symbol: t.symbol, decimals: t.decimals,
        payee: t.payee, payee_token_account: t.destinationTokenAccount, fee_payer: t.feePayer,
        amount_atomic: t.amountAtomic, amount_decimal: chainDisplay(t.amountAtomic, t.decimals), max_amount_atomic: t.maxAmountAtomic,
        compute_unit_limit: t.computeUnitLimit, compute_unit_price_micro_lamports: t.computeUnitPriceMicroLamports,
        // A seller's memo is untrusted text the agent reads (refusal envelopes carry this view): shown by the seller-value
        // rule; the record keeps it verbatim for the Memo instruction. APN's own nonce memo is shown as is.
        memo: t.memoSource === "seller" ? sellerValue(t.memo) : t.memo, memo_source: t.memoSource,
        resource: { origin: t.origin, url_hash: t.urlHash, challenge_hash: t.challengeHash, offer_index: t.offerIndex, offer_hash: t.offerHash },
        owner_admission: { policy_digest: t.admission.policyDigest, policy_revision: t.admission.policyRevision, mechanism: X402_SOLANA_MECHANISM,
            maximum_per_transfer_atomic: t.admission.maximumPerTransferAtomic, daily_limit_atomic: t.admission.dailyLimitAtomic },
        lifetime: record.lifetime === null ? null : { blockhash: record.lifetime.blockhash, last_valid_block_height: record.lifetime.lastValidBlockHeight,
            floor_slot: record.lifetime.floorSlot, message_hash: record.lifetime.messageHash },
        usage_reservation_id: record.lease?.reservationId ?? null, payer_signed: record.signed !== null, exposed_at: record.exposure?.at ?? null,
        seller_response: response === null ? null : { status: response.status, observed_at: response.observedAt,
            settlement_hint: response.settlementHint ?? null, settlement_success: response.settlementSuccess ?? null,
            result: response.result === undefined ? null : { media_type: response.result.mediaType, body_encoding: response.result.bodyEncoding ?? "utf-8",
                body: response.result.bodyText, result_hash: response.result.resultHash, byte_length: response.result.byteLength } },
        settlement: record.settlement === null ? null : { transaction: record.settlement.signature, slot: record.settlement.slot,
            success: record.settlement.success, error: record.settlement.errorCanonicalJson, source: record.settlement.source, finality: "finalized" },
        never_landed: record.unlanded === null ? null : { finalized_block_height: record.unlanded.finalizedBlockHeight,
            last_valid_block_height: record.unlanded.lastValidBlockHeight, floor_slot: record.unlanded.floorSlot, coverage_slot: record.unlanded.coverageSlot },
        expires_at: t.expiresAt, created_at: record.createdAt, updated_at: record.updatedAt,
        next_actions: nextActions(record),
    };
}
function nextActions(record) {
    const observe = `apn x402 solana observe --operation ${record.operationId}`;
    if (record.terminal)
        return [];
    if (record.state === "prepared")
        return [`apn x402 solana pay --profile ${record.profile} --url ${record.terms.url} --asset ${record.terms.mint} ` +
                `--max-amount ${record.terms.maxAmountAtomic} --idempotency-key <the same key>`, observe];
    if (record.state === "exposed")
        return [observe, `apn operation abandon --operation ${record.operationId}`];
    return [observe];
}
//# sourceMappingURL=view.js.map