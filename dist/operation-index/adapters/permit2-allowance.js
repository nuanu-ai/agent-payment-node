import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { PERMIT2_ALLOWANCE_FAMILY, PERMIT2_ALLOWANCE_STORE, PERMIT2_ALLOWANCE_TERMINAL_STATES } from "../../x402-permit2/allowance/model.js";
import { Permit2AllowanceRepository } from "../../x402-permit2/allowance/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
const STORE = { directory: PERMIT2_ALLOWANCE_STORE, perProfile: false };
/**
 * The owner's bounded ERC-20 allowance to Permit2: it holds the wallet on its chain from prepare until a receipt at the
 * chain's proof tag, the finalized never-lands proof, an unsigned expiry or the owner's abandon.
 */
export const permit2AllowanceAdapter = {
    family: PERMIT2_ALLOWANCE_FAMILY,
    stores: [STORE],
    async load(root, recordPath) { return await new Permit2AllowanceRepository(root).find(requiredRecordPath(recordPath, STORE).operationId); },
    identity: standardIdentity,
    claims: (record) => readableClaims(() => domainClaims([evmConflictDomain(record.terms.chainId, record.terms.owner)])),
    terminal: (record) => PERMIT2_ALLOWANCE_TERMINAL_STATES.includes(record.state),
    state: (record) => record.state,
    salvage: (raw) => salvageRecord(raw, (value) => [salvageEvm(field(value, "terms", "chainId"), field(value, "terms", "owner"))]),
    view: async (record) => (await import("../../x402-permit2/allowance/view.js")).publicPermit2Allowance(record),
    async abandon(context, record) {
        const [{ abandonPermit2Allowance }, { publicPermit2Allowance }] = await Promise.all([import("../../x402-permit2/allowance/service.js"),
            import("../../x402-permit2/allowance/view.js")]);
        const approval = context.requireOperationAbandonApproval(), t = record.terms;
        return publicPermit2Allowance(await abandonPermit2Allowance(context.state.root, record.operationId, () => context.clock.now(), async (current) => await approval.approve({ operationId: current.operationId, fingerprint: current.fingerprint, profile: current.profile, providerId: "local",
            walletAddress: t.owner, recipient: t.spender, amountAtomic: t.amountAtomic, amountDecimal: t.amountAtomic, chainLabel: `eip155:${t.chainId}`,
            assetLabel: `allowance of ${t.token} to Permit2`, unit: "atomic units",
            outcomeNote: "The approve may still land and set this allowance; revoke it later with apn x402 permit2 allowance revoke." })));
    },
    commands: { status: "apn x402 permit2 allowance status --operation <operation-id>",
        resume: "apn x402 permit2 allowance observe --operation <operation-id> --rpc-url <https-rpc>", exit: "apn operation abandon --operation <operation-id>" },
};
//# sourceMappingURL=permit2-allowance.js.map