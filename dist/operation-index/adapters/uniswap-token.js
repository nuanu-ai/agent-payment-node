import { UniswapTokenJournal } from "../../swap/uniswap-v3/token-operation.js";
import { field, readableClaims, requiredRecordPath, salvageEvm } from "../adapter.js";
import { evmClaim, namedProfileHash, pastUnstartedDeadline, salvageNamedRecord } from "./family-claims.js";
import { OPERATION_STATUS } from "./family-commands.js";
const STORE = { directory: "uniswap-token-operations", perProfile: false };
/** The Uniswap token lane runs on Ethereum mainnet only (its route reads pin chain 1). */
export const UNISWAP_TOKEN_CHAIN_ID = 1;
/**
 * Uniswap token swaps: approval, swap and cleanup all sign with the account on Ethereum. A `prepared` swap is retired
 * unsigned once its route deadline passed (approve and execute both retire it first).
 */
export const uniswapTokenAdapter = {
    family: "uniswap_token",
    stores: [STORE],
    async load(root, recordPath) { return await new UniswapTokenJournal(root).read(requiredRecordPath(recordPath, STORE).operationId); },
    identity: record => ({ profileHash: namedProfileHash(record.profile), operationId: record.operationId, idempotencyHash: null, requestHash: null }),
    claims: record => readableClaims(() => [evmClaim(UNISWAP_TOKEN_CHAIN_ID, record.account)]),
    terminal: record => record.phase === "observed" || record.phase === "cleaned" ||
        record.phase === "prepared" && pastUnstartedDeadline(record.route.deadline * 1000),
    state: record => record.phase,
    salvage: raw => salvageNamedRecord(raw, value => [salvageEvm(UNISWAP_TOKEN_CHAIN_ID, field(value, "account"))], "profile"),
    view: async (record) => record,
    // Its status reads the journal and observes an attempted approval, swap or cleanup; execute and cleanup are its own steps.
    status: async (context, record) => await (await import("../../swap/uniswap-command-service.js")).executeUniswapCommand({ command: "swap.uniswap-token.status", operationId: record.operationId }, context),
    commands: { status: OPERATION_STATUS, resume: "apn swap ethereum uniswap-token execute --operation <operation-id>",
        exit: "apn swap ethereum uniswap-token cleanup --operation <operation-id>" },
};
//# sourceMappingURL=uniswap-token.js.map