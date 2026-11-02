import { ApnError } from "./errors.js";
import { armDirectEvmStep, requireEvmRpc } from "./evm-direct.js";
import { directRpcChain } from "./rpc-requirement.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { requiredLocal } from "./transfer-service-observe.js";
/** The dispatched local states whose transaction may still be in flight: the only ones the blocker settle observes. */
export const SETTLED_DIRECT_STATES = ["submitted_pending", "unknown_finality"];
/**
 * The blocker settle of a local direct transfer (operation-auto-settle.ts): one receipt read and, without a receipt, the
 * shared never-lands rule, under the locks its observation takes (profile, operation). Unlike resume it never dispatches
 * or re-sends, never reads custody, never moves `signed_not_submitted` and never releases a reservation itself; each
 * transition it writes follows the usage ledger as every observation's does. Its RPC is the refused command's own
 * `--rpc-url`, reused explicitly: a standalone chain-id read (the RPC's own chain assertion) must name the transfer's
 * chain before its hash is sent, so an endpoint of another chain learns nothing of it (APN_CHAIN_MISMATCH); without an
 * RPC the settle is refused by its RPC requirement (APN_RPC_CONFIG). Either refusal writes nothing.
 */
export async function settleDispatchedDirect(context, observation, operationIdInput) {
    const operationId = canonicalOperationId(operationIdInput);
    await context.ready();
    const found = requiredLocal(await observation.requiredOperation(operationId));
    return await context.state.withLocks([`profile:${found.profileHash}`, `operation:${operationId}`], async () => {
        const operation = requiredLocal(await observation.requiredOperation(operationId));
        if (operation.terminal)
            return operation;
        if (!SETTLED_DIRECT_STATES.includes(operation.state) || operation.transactionHash === undefined || operation.evm?.cleanup85Cancellation !== undefined) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Only a dispatched local transfer is observed by the blocker settle.", { reason: "direct_settle_not_dispatched", operationId, state: operation.state });
        }
        const rpc = context.requireRpc(directRpcChain(operation.chainId));
        if (operation.evm !== undefined)
            armDirectEvmStep(rpc, operation.evm.asset.chainId, "resume");
        else
            rpc.armEvmDirectRpcGuard?.();
        if (operation.evm !== undefined)
            await requireEvmRpc(rpc).assertChain(operation.evm.asset.chainId);
        else
            await rpc.assertBaseChain();
        const observed = await observation.observeReceipt(operation, rpc);
        // Observe-only: the never-lands branch alone; a hash the node does not hold is never re-sent here.
        return observed.receipt === "absent" ? await observation.settleUnlanded(observed.operation, rpc, true) : observed.operation;
    });
}
//# sourceMappingURL=direct-transfer-settle.js.map