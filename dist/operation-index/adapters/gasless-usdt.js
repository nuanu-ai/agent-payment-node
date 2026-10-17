import { USDT_EXECUTION_OPEN_STATES, UsdtExecutionJournal } from "../../gasless-usdt/execution-journal.js";
import { field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord } from "../adapter.js";
import { dataOutcome, operationOutcome } from "../../core-outcome.js";
import { evmClaim } from "./family-claims.js";
import { assertNoResumeOptions, installed, OPERATION_RESUME, OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "gasless-usdt-executions", perProfile: false };
/** Gasless USDT signs on Ethereum with the owner's EOA, the shared EntryPoint and nonce key 0. */
export const GASLESS_USDT_CHAIN_ID = 1;
/**
 * Gasless USDT executions. A bound preparation holds nothing (execution re-guards the exact nonces it uses); an
 * execution is admitted before its first RPC read or signature and holds the sender while it can still sign, send or land.
 * Its profile hash is the allowlist overlay's, as the execution journal stores it.
 */
export const gaslessUsdtAdapter = {
    family: "gasless_usdt",
    stores: [STORE],
    async load(root, recordPath) { return await new UsdtExecutionJournal(root).load(requiredRecordPath(recordPath, STORE).operationId); },
    identity: record => ({ profileHash: record.profileHash, operationId: record.operationId, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(GASLESS_USDT_CHAIN_ID, record.sender)]),
    terminal: record => !USDT_EXECUTION_OPEN_STATES.includes(record.state),
    state: record => record.state,
    salvage: raw => salvageRecord(raw, value => [salvageEvm(GASLESS_USDT_CHAIN_ID, field(value, "sender"))]),
    view: async (record) => record,
    status: async (context, record) => dataOutcome(await installed(context.gaslessUsdtExecute, "Gasless USDT execution runtime is unavailable.")
        .status(record.profileHash, record.operationId), "local_gasless_usdt_execution_journal"),
    // Resume observes a sent execution and retires an unsent one under the effect lock; it never signs or resends.
    async resume(context, record, options) {
        assertNoResumeOptions(options, "Gasless USDT");
        return operationOutcome(await installed(context.gaslessUsdtExecute, "Gasless USDT execution runtime is unavailable.")
            .resume(record.profileHash, record.operationId));
    },
    commands: { status: OPERATION_STATUS, resume: OPERATION_RESUME },
};
//# sourceMappingURL=gasless-usdt.js.map