import { FileStargateNativeJournal } from "../../stargate-v2/native-journal.js";
import { STARGATE_NATIVE_TERMINAL_PHASES } from "../../stargate-v2/native-record.js";
import { FileStargateTokenJournal, STARGATE_TOKEN_TRANSITIONS } from "../../stargate-v2/token-journal.js";
import { ApnError } from "../../errors.js";
import { legacyStargateTerminal } from "../../legacy/stargate-v2/closure.js";
import { isLegacyStargateRecord, loadLegacyStargateRecord } from "../../legacy/stargate-v2/reader.js";
import { field, readableClaims, requiredRecordPath, salvageEvm } from "../adapter.js";
import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { evmClaim, namedProfileHash, pastUnstartedDeadline, salvageNamedRecord } from "./family-claims.js";
import { assertResumeOptions, oneObservationOnly } from "../../operation-command-options.js";
import { installed, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";
/** Native ETH from Ethereum (chain 1) and token USDC from Optimism (chain 10); the record's own envelope names the chain. */
export const STARGATE_NATIVE_SOURCE_CHAIN = 1, STARGATE_TOKEN_SOURCE_CHAIN_ID = 10;
/**
 * The live journal's reader, widened by the frozen read-only reader of the schemas only unreleased builds wrote (native v1,
 * token v1..v4): such a record is read, claims its signing account like any other, and is terminal by its old terminal
 * phase or by its chain-proven closure. Nothing executes it; its status (and `operation resume`) runs the closure check.
 */
async function withLegacy(live, root, family, operationId) {
    try {
        return await live();
    }
    catch (error) {
        if (!(error instanceof ApnError) || error.code !== "APN_STATE_CORRUPT" || error.details?.reason !== "schema")
            throw error;
        const legacy = await loadLegacyStargateRecord(root, family, operationId);
        if (legacy === null)
            throw error;
        return legacy;
    }
}
function stargateAdapter(family, directory, chainId, read, terminal, service, runtimeCommand, exit, abandon) {
    const store = { directory, perProfile: false };
    return {
        family,
        stores: [store],
        async load(root, recordPath) {
            const { operationId } = requiredRecordPath(recordPath, store);
            return await withLegacy(async () => await read(root, operationId), root, family, operationId);
        },
        // Stargate hashes its own profile and key into the operation ID, so replay is by ID; the claim uses the state's profile hash.
        identity: record => ({ profileHash: namedProfileHash(record.profile), operationId: record.operationId, idempotencyHash: null, requestHash: null }),
        claims: record => readableClaims(() => [evmClaim(chainId, record.owner)]),
        holdsProfile: record => !isLegacyStargateRecord(record),
        terminal: (record, root) => isLegacyStargateRecord(record) ? legacyStargateTerminal(root, record) : terminal(record),
        state: record => record.phase,
        salvage: raw => salvageNamedRecord(raw, value => [salvageEvm(chainId, field(value, "owner"))], "profile"),
        view: async (record) => record,
        status: async (context, record) => operationOutcome(await service(context).status(record.operationId)),
        async resume(context, record, options) {
            assertResumeOptions(options, { refuseWait: () => oneObservationOnly("Stargate") });
            // An unreleased-schema record has no runtime to observe: its one recovery is the chain-proven closure its status runs.
            return operationOutcome(await (isLegacyStargateRecord(record) ? service(context).status(record.operationId) : service(context).observe(record.operationId)));
        },
        receipt: async (context, record) => receiptOutcome(await service(context).receipt(record.operationId)),
        ...(abandon === undefined ? {} : { async abandon(context, record) {
                // An unreleased-schema record has its own exit: the chain-proven closure its status runs (once closed, it is terminal).
                if (isLegacyStargateRecord(record)) {
                    const id = record.operationId, status = `apn operation status --operation ${id}`;
                    if (await legacyStargateTerminal(context.state.root, record))
                        throw new ApnError("APN_OPERATION_BLOCKED", `The ${family} operation is already terminal; there is nothing to abandon.`, { operationId: id, family, state: record.phase,
                            reason: "operation_already_terminal", nextActions: [status, `apn receipt get --operation ${id}`] });
                    throw new ApnError("APN_OPERATION_BLOCKED", "An unreleased-schema Stargate record closes by its chain-proven closure.", { reason: "stargate_legacy_closure_is_the_exit", nextActions: [status] });
                }
                return await abandon(context, record);
            } }),
        commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME, ...(exit === undefined ? {} : { exit }) },
        runtimeCommand: async () => runtimeCommand,
    };
}
/** Execute refuses an expired `prepared` or `approved` journal before signing; once a hash is recorded it is observed to the end. */
export const stargateNativeAdapter = stargateAdapter("stargate_native", "stargate-v2-native", STARGATE_NATIVE_SOURCE_CHAIN, async (root, id) => await new FileStargateNativeJournal(root).load(id), record => STARGATE_NATIVE_TERMINAL_PHASES.includes(record.phase) ||
    (record.phase === "prepared" || record.phase === "approved") && record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt), context => installed(context.stargateNative, "Stargate native runtime is unavailable."), "stargate.native.status");
/** Neither an approval nor a send is signed past the prepare expiry; any signed approval, send or cleanup ends observed or cleaned. */
export const stargateTokenAdapter = stargateAdapter("stargate_token", "stargate-v2-token", STARGATE_TOKEN_SOURCE_CHAIN_ID, async (root, id) => await new FileStargateTokenJournal(root).load(id), record => STARGATE_TOKEN_TRANSITIONS[record.phase]?.length === 0 ||
    (record.phase === "prepared" || record.phase === "approved") && record.approvalTransactionHash === undefined &&
        record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt), context => installed(context.stargateToken, "Stargate token runtime is unavailable."), "stargate.token.status", "apn stargate token cleanup --operation <operation-id>", 
// The last-resort owner exit (R4): past the prepare expiry, with TTY consent; reads and writes only the journal.
async (context, record) => await (await import("../../stargate-v2/token-abandon.js")).abandonStargateV2Token(record.operationId, new FileStargateTokenJournal(context.state.root, context.state), async (intent) => await context.requireOperationAbandonApproval().approve(intent), () => context.clock.now().getTime()));
//# sourceMappingURL=stargate.js.map