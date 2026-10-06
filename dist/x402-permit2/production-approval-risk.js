import { ApnError } from "../errors.js";
import { LocalWalletNative } from "../local-wallet-native.js";
import { Permit2ProductionJournal } from "./production-journal.js";
import { Permit2ProductionPreparation } from "./production-prepare.js";
import { publicPermit2Production } from "./production-repository.js";
import { Permit2ProductionSigningFence } from "./production-signing-fence.js";
import { Permit2ForegroundApprovalAuthority, assertCurrentPermit2ForegroundApproval, revokePermit2ForegroundApproval } from "./production-approval-provenance.js";
import { TtyPermit2ForegroundApproval } from "./production-approval.js";
/** No-key production wiring. Returned continuation is private provenance, not signing/HTTP authority. */
export class Permit2ApprovalRiskCoordinator {
    #journal;
    #preparation;
    #fence;
    #authority;
    constructor(root, endpoint, native, preparation, clock = () => new Date(), approval = new TtyPermit2ForegroundApproval()) {
        const capability = LocalWalletNative.resolvePermit2LocalCapability(native, root);
        if (preparation.records.root !== root)
            blocked();
        this.#preparation = preparation;
        this.#journal = new Permit2ProductionJournal(root, preparation, clock);
        this.#fence = new Permit2ProductionSigningFence(root, endpoint, clock);
        this.#authority = new Permit2ForegroundApprovalAuthority(this.#journal, this, native, capability, approval, clock);
    }
    async run(operationId, purpose = "sign-only") {
        const id = operationId;
        let proof;
        const owned = await this.#journal.findOperation(id);
        if (owned === null)
            blocked();
        if (owned.exposureAt !== null || owned.exposureJournal !== undefined || owned.terminal) {
            const record = owned.exposureJournal !== undefined && !owned.terminal ? await this.#journal.confirmHold(id) : owned;
            return Object.freeze({ status: publicPermit2Production(record), continuation: null });
        }
        try {
            proof = await this.#authority.approveOwned(id, purpose);
            const current = await this.#journal.findOperation(id);
            if (current === null)
                blocked();
            if (current.exposureAt !== null || current.exposureJournal !== undefined || current.terminal) {
                const record = current.exposureJournal !== undefined && !current.terminal ? await this.#journal.confirmHold(id) : current;
                return Object.freeze({ status: publicPermit2Production(record), continuation: null });
            }
            assertCurrentPermit2ForegroundApproval(proof, this.#journal, current);
            await this.#preparation.assertCurrentOwner(id);
            const checked = await this.#fence.check(id, "reserved");
            if (checked.fact === null)
                blocked();
            await this.#fence.consume(checked.fact, id, "reserved");
            const result = await this.#journal.markApprovedSignatureRisk(id, proof);
            return Object.freeze({ status: publicPermit2Production(result.record), continuation: result.continuation });
        }
        finally {
            if (proof !== undefined)
                revokePermit2ForegroundApproval(proof);
        }
    }
}
function blocked() { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 foreground continuation is unavailable; existing risk is observe-only."); }
//# sourceMappingURL=production-approval-risk.js.map