import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { MERCHANT_TERMINAL_PHASES, publicMerchant } from "../../x402-merchant/model.js";
import { MerchantRepository } from "../../x402-merchant/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
import { pastUnstartedDeadline } from "./family-claims.js";
const STORE = { directory: "merchant-x402", perProfile: false };
export function merchantDomains(record) {
    return [evmConflictDomain(4326, record.custody.walletAddress)];
}
/**
 * Merchant x402 payments on MegaETH. The family's own outcomes end the claim, the phase 4c exits included (never sent,
 * superseded at the finalized nonce, owner abandon, delivery attempts exhausted); besides them, a `prepared` payment
 * (never signed: approve moves it to signing_started only while its 300 s local deadline holds) can never sign once that
 * deadline plus the unstarted margin has passed. Observe then records it `failed_before_effect` and releases any hold
 * a crashed approval reserved.
 */
export const merchantTerminal = (record) => MERCHANT_TERMINAL_PHASES.includes(record.state) || record.state === "prepared" && pastUnstartedDeadline(record.expiresAt);
export const merchantAdapter = {
    family: "merchant_x402",
    stores: [STORE],
    async load(root, recordPath) {
        return await new MerchantRepository(root).findOperation(requiredRecordPath(recordPath, STORE).operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims(merchantDomains(record))),
    terminal: merchantTerminal,
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(4326, field(value, "custody", "walletAddress"))]),
    view: async (record) => publicMerchant(record),
    // The owner exit: a proven exit first (no consent), else TTY consent ends an attempt nothing can decide (holds stay charged).
    abandon: async (context, record) => {
        const [{ MerchantExits }, { MerchantRpc }] = await Promise.all([import("../../x402-merchant/exits.js"), import("../../x402-merchant/rpc.js")]);
        return publicMerchant(await new MerchantExits(context.state, new MerchantRpc(context.state), () => context.clock.now())
            .abandon(record.operationId, context.requireOperationAbandonApproval()));
    },
    // Merchant observation and the unsent retirement run on their own bounded CLI path; its status carries the payment and delivery evidence.
    commands: { status: "apn x402 merchant status --operation <operation-id>", resume: "apn x402 merchant observe --operation <operation-id>",
        exit: "apn x402 merchant retire-unsent --operation <operation-id>" },
};
//# sourceMappingURL=merchant.js.map