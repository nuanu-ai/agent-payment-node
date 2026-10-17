import { FileStargateNativeJournal } from "../../stargate-v2/native-journal.js";
import { FileStargateTokenJournal } from "../../stargate-v2/token-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm } from "../adapter.js";
import { operationOutcome, receiptOutcome } from "../../core-outcome.js";
import { evmClaim, namedProfileHash, pastUnstartedDeadline, salvageNamedRecord } from "./family-claims.js";
import { assertNoResumeOptions, installed, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";
/** Native ETH from Ethereum (chain 1) and token USDC from Optimism (chain 10); the record's own envelope names the chain. */
export const STARGATE_NATIVE_SOURCE_CHAIN = 1, STARGATE_TOKEN_SOURCE_CHAIN_ID = 10;
function stargateAdapter(family, directory, chainId, read, terminal, service, exit) {
    const store = { directory, perProfile: false };
    return {
        family,
        stores: [store],
        async load(root, recordPath) { return await read(root, requiredRecordPath(recordPath, store).operationId); },
        // Stargate hashes its own profile and key into the operation ID, so replay is by ID; the claim uses the state's profile hash.
        identity: record => ({ profileHash: namedProfileHash(record.profile), operationId: record.operationId, idempotencyHash: null, requestHash: null }),
        claims: record => readableClaims(() => [evmClaim(chainId, record.owner)]),
        terminal,
        state: record => record.phase,
        salvage: raw => salvageNamedRecord(raw, value => [salvageEvm(chainId, field(value, "owner"))], "profile"),
        view: async (record) => record,
        status: async (context, record) => operationOutcome(await service(context).status(record.operationId)),
        async resume(context, record, options) {
            assertNoResumeOptions(options, "Stargate");
            return operationOutcome(await service(context).observe(record.operationId));
        },
        receipt: async (context, record) => receiptOutcome(await service(context).receipt(record.operationId)),
        commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME, ...(exit === undefined ? {} : { exit }) },
    };
}
/** Execute refuses an expired `prepared` or `approved` journal before signing; once a hash is recorded it is observed to the end. */
export const stargateNativeAdapter = stargateAdapter("stargate_native", "stargate-v2-native", STARGATE_NATIVE_SOURCE_CHAIN, async (root, id) => await new FileStargateNativeJournal(root).load(id), record => record.phase === "observed" || record.phase === "failed_confirmed_revert" ||
    (record.phase === "prepared" || record.phase === "approved") && record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt), context => installed(context.stargateNative, "Stargate native runtime is unavailable."));
/** Neither an approval nor a send is signed past the prepare expiry; any signed approval, send or cleanup ends observed or cleaned. */
export const stargateTokenAdapter = stargateAdapter("stargate_token", "stargate-v2-token", STARGATE_TOKEN_SOURCE_CHAIN_ID, async (root, id) => await new FileStargateTokenJournal(root).load(id), record => record.phase === "observed" || record.phase === "cleaned" ||
    (record.phase === "prepared" || record.phase === "approved") && record.approvalTransactionHash === undefined &&
        record.transactionHash === undefined && pastUnstartedDeadline(record.expiresAt), context => installed(context.stargateToken, "Stargate token runtime is unavailable."), "apn stargate token cleanup --operation <operation-id>");
//# sourceMappingURL=stargate.js.map