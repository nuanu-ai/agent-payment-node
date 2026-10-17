import { METAMASK_NATIVE_RESOLVED_STATES, MetaMaskNativeJournal } from "../../metamask-native-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, STATE_HASH } from "../adapter.js";
import { dataOutcome } from "../../core-outcome.js";
import { evmClaim, pastUnstartedDeadline } from "./family-claims.js";
import { assertNoResumeOptions, OPERATION_ABANDON, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "metamask-native-operations", perProfile: false };
/**
 * MetaMask Agent Wallet native-fee transfers. The account is held from admission until the outcome is resolved; a
 * transfer that never reached its effect marker cannot reach it after its consent deadline (one foreground command).
 */
export const metaMaskNativeAdapter = {
    family: "metamask_native",
    stores: [STORE],
    async load(root, recordPath) { return await new MetaMaskNativeJournal(root).read(requiredRecordPath(recordPath, STORE).operationId); },
    identity: record => ({ profileHash: record.context.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: record.requestHash }),
    claims: record => readableClaims(() => [evmClaim(record.context.quote.chainId, record.context.quote.sender)]),
    terminal: record => METAMASK_NATIVE_RESOLVED_STATES.includes(record.state) ||
        record.state === "prepared" && record.effectAttempts === 0 && pastUnstartedDeadline(record.context.consentExpiresAt),
    state: record => record.state,
    salvage: raw => {
        const profileHash = field(raw, "context", "profileHash");
        return { ...salvageRecord(raw, value => [salvageEvm(field(value, "context", "quote", "chainId"), field(value, "context", "quote", "sender"))], []),
            profileHashes: typeof profileHash === "string" && STATE_HASH.test(profileHash) ? [profileHash] : [] };
    },
    view: async (record) => record,
    status: async (context, record) => dataOutcome(await (await import("../../metamask-native-transfer-owner.js"))
        .readMetaMaskNativeTransfer(context.state.root, record.operationId), "durable_public_state"),
    // Resume observes the stored request or transaction and settles the actual fee; it never sends again.
    async resume(context, record, options) {
        assertNoResumeOptions(options, "MetaMask native transfer");
        return dataOutcome(await (await import("../../metamask-native-transfer-owner.js"))
            .readMetaMaskNativeTransfer(context.state.root, record.operationId, true), "durable_public_state");
    },
    // An outcome that stayed unknown after the quote expired has the owner exit (R4), behind TTY consent.
    abandon: async (context, record) => await (await import("../../metamask-native-transfer-owner.js")).abandonMetaMaskNativeTransfer(context.state.root, record.operationId, async (intent) => await context.requireOperationAbandonApproval().approve(intent), () => context.clock.now()),
    commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME, exit: OPERATION_ABANDON },
};
//# sourceMappingURL=metamask-native.js.map