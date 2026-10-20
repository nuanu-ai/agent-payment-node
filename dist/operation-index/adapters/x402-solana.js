import { operationOutcome } from "../../core-outcome.js";
import { ApnError } from "../../errors.js";
import { assertResumeOptions } from "../../operation-command-options.js";
import { railConflictDomain } from "../../operation-conflict-domain.js";
import { X402_SOLANA_FAMILY, X402_SOLANA_STORE } from "../../x402-solana/constants.js";
import { X402_SOLANA_TERMINAL_STATES } from "../../x402-solana/model.js";
import { X402SolanaRepository } from "../../x402-solana/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageRail, salvageRecord, standardIdentity } from "../adapter.js";
import { installed } from "./family-commands.js";
const STORE = { directory: X402_SOLANA_STORE, perProfile: false };
async function service(context) {
    const { X402SolanaService } = await import("../../x402-solana/service.js");
    return new X402SolanaService(context.state.root, installed(context.x402Solana, "The Solana x402 runtime is not installed."));
}
/**
 * Solana x402 payments hold the payer's Solana account until their own outcome: a finalized settlement or on-chain
 * failure, the chain's proof that the transaction can no longer land, an unexposed payment's end, or the owner's abandon.
 */
export const x402SolanaAdapter = {
    family: X402_SOLANA_FAMILY,
    stores: [STORE],
    async load(root, recordPath) { return await new X402SolanaRepository(root).find(requiredRecordPath(recordPath, STORE).operationId); },
    identity: standardIdentity,
    claims: (record) => readableClaims(() => domainClaims([railConflictDomain("solana", record.terms.payer)])),
    terminal: (record) => X402_SOLANA_TERMINAL_STATES.includes(record.state),
    state: (record) => record.state,
    salvage: (raw) => salvageRecord(raw, (value) => [salvageRail("solana", field(value, "terms", "payer"))]),
    view: async (record) => (await import("../../x402-solana/view.js")).publicX402Solana(record),
    runtimeCommand: async () => "x402.solana.observe",
    async resume(context, record, options) {
        assertResumeOptions(options, { refuseWait: () => {
                throw new ApnError("APN_INVALID_INPUT", "Solana x402 resume performs one bounded observation; omit --wait-seconds.");
            } });
        const { record: observed } = await (await service(context)).observe(record.operationId);
        return operationOutcome((await import("../../x402-solana/view.js")).publicX402Solana(observed));
    },
    async abandon(context, record) {
        const [{ approveX402SolanaAbandon }, { abandonX402Solana }, { publicX402Solana }] = await Promise.all([
            import("../../x402-solana/runtime.js"), import("../../x402-solana/exit.js"), import("../../x402-solana/view.js")
        ]);
        const approval = context.requireOperationAbandonApproval();
        return publicX402Solana(await abandonX402Solana(context.state.root, record.operationId, () => context.clock.now(), async (current) => await approveX402SolanaAbandon(approval, current)));
    },
    commands: { status: "apn x402 solana status --operation <operation-id>", resume: "apn x402 solana observe --operation <operation-id>",
        exit: "apn operation abandon --operation <operation-id>" },
};
//# sourceMappingURL=x402-solana.js.map