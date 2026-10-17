import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { legacyBridgeTerminal } from "../../legacy/lifi-bridge/closure.js";
import { legacyBridgeOpen, legacyBridgeStatus } from "../../legacy/lifi-bridge/status.js";
import { isLegacyBridgeOperation } from "../../lifi/legacy-operation.js";
import { BRIDGE_TERMINAL } from "../../lifi/operation-model.js";
import { BridgeOperationRepository } from "../../lifi/operation-repository.js";
import { publicStoredBridgeOperation } from "../../lifi/receipt.js";
import { BridgeService } from "../../lifi/service.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { bridgeConflictDomain } from "../../operation-conflict-domain.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageBridge, salvageRecord, standardIdentity } from "../adapter.js";
const STORE = { directory: "bridge-operations", perProfile: true };
export function bridgeDomains(record) {
    return [bridgeConflictDomain(record.intent.sourceDeployment.chainId, record.intent.owner.address)];
}
/** The status of any bridge journal; an open frozen one runs its chain-proven closure (R4), read only. */
async function bridgeStatus(context, record) {
    return isLegacyBridgeOperation(record)
        ? await legacyBridgeStatus(context.state.root, record, context.finalizedRead, () => context.clock.now().getTime())
        : publicStoredBridgeOperation(record);
}
/**
 * Current and legacy (widen-only) bridge journals, through the repository's version-aware reader. A legacy journal is
 * frozen (resume refuses it, nothing signs for it again), so it holds only its account, not its profile: only a
 * transaction it already sent may still land on that account. It is terminal in its outcome states or by its closure.
 */
export const bridgeAdapter = {
    family: "bridge_route",
    stores: [STORE],
    async load(root, recordPath) {
        const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
        return await new BridgeOperationRepository(root).loadStoredOperation(profileHash, operationId);
    },
    identity: standardIdentity,
    claims: record => readableClaims(() => domainClaims(bridgeDomains(record))),
    holdsProfile: record => !isLegacyBridgeOperation(record),
    // The family's outcome list, which its validator (current and legacy) ties the record's `terminal` flag to; a frozen
    // journal also ends by its closure sidecar (a damaged one throws: undecidable).
    terminal: (record, root) => isLegacyBridgeOperation(record) ? legacyBridgeTerminal(root, record) : BRIDGE_TERMINAL.includes(record.state),
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageBridge(field(value, "intent", "sourceDeployment", "chainId"), field(value, "intent", "owner", "address"))]),
    view: async (record) => publicStoredBridgeOperation(record),
    status: async (context, record) => operationOutcome(await bridgeStatus(context, record)),
    async resume(context, record, options) {
        assertResumeOptions(options, { refuseWait: () => oneObservationOnly("Bridge") });
        // An open frozen journal has no runtime to resume: its one recovery is the closure its status runs.
        if (isLegacyBridgeOperation(record) && legacyBridgeOpen(record))
            return operationOutcome(await bridgeStatus(context, record));
        return operationOutcome(await new BridgeService(context).resume(record.operationId));
    },
    receipt: async (context, record) => receiptOutcome(await new BridgeService(context).receipt(record.operationId)),
    // No owner abandon: resume proves the outcome, including a source effect that can no longer land; a frozen journal
    // closes by the finalized nonce its status reads.
    commands: { status: "apn operation status --operation <operation-id>", exit: "apn operation resume --operation <operation-id>" },
};
//# sourceMappingURL=bridge.js.map