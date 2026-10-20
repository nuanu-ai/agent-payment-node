import { ApnError } from "../../errors.js";
import { mmDispatchIntent } from "../dispatch.js";
import { metaMaskGaslessOwner } from "../owner.js";
import { mmDisableCall } from "./call.js";
import { mmRevocationPayload } from "./chain.js";
import { metaMaskRevocationSummary } from "./consent.js";
/** The states in which a dispatched delegation may still be redeemable and nothing proves its outcome. */
const REVOCABLE = ["submitted_pending", "unknown_finality", "failed_effects_pending", "abandoned_unknown"];
/**
 * The owner's exit for a disclosed delegation whose outcome no proof decides: one `disableDelegation` of exactly that
 * delegation, signed and paid by its own server wallet after foreground consent. It records nothing in the operation:
 * the chain is the record, and `operation resume` closes the operation only from the manager's disabled flag with the
 * redemption count 0 at one finality block. Repeating it can never move USDC; the pinned nonce lets one call land.
 */
export async function revokeMetaMaskGasless(state, op, rpcFor, dependencies) {
    const id = op.operationId, resume = `apn operation resume --operation ${id}`;
    if (!REVOCABLE.includes(op.state) || op.submissionAttempts !== 1) {
        throw new ApnError("APN_OPERATION_BLOCKED", op.state === "dispatch_pending"
            ? "This operation's dispatch is not observed yet; resume it first." : op.submissionAttempts === 1
            ? "This operation's delegation has a proved outcome; there is nothing to disable."
            : "This operation never sent its delegation to MetaMask; there is nothing to disable.", { reason: "mm_revoke_not_revocable", operationId: id, state: op.state,
            nextActions: [op.state === "dispatch_pending" ? resume : `apn operation status --operation ${id}`] });
    }
    const { approval, wallet } = dependencies;
    if (approval === undefined || wallet === undefined) {
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Confirm the delegation disable in a foreground terminal.", { reason: "mm_revoke_approval", nextActions: [`apn gasless transfer revoke --operation ${id}`] });
    }
    await metaMaskGaslessOwner(state, op.intent.profile, op.intent.binding);
    const dispatched = mmDispatchIntent(op), chainId = dispatched.request.chainId, call = mmDisableCall(dispatched);
    const rpc = rpcFor(chainId);
    if (rpc.chainId !== chainId || rpc.revocation === undefined) {
        throw new ApnError("APN_RPC_CONFIG", "The configured RPC cannot price a delegation disable.", { reason: "mm_revoke_rpc" });
    }
    const chain = await rpc.revocation(dispatched, call, id);
    if (BigInt(chain.nativeBalanceWei) < BigInt(chain.maximumNativeCostWei)) {
        throw new ApnError("APN_INSUFFICIENT_GAS", `The server wallet ${call.from} holds ${chain.nativeBalanceWei} wei of native gas on chain ` +
            `${chainId}; this disable can cost up to ${chain.maximumNativeCostWei} wei. Nothing was sent.`, { reason: "mm_revoke_native_gas", chain_id: chainId, address: call.from, native_balance_wei: chain.nativeBalanceWei,
            maximum_native_cost_wei: chain.maximumNativeCostWei, nextActions: [
                `Send at least ${(BigInt(chain.maximumNativeCostWei) - BigInt(chain.nativeBalanceWei)).toString()} wei of chain ${chainId}'s native coin (no USDC) to ${call.from}, then rerun: apn gasless transfer revoke --operation ${id}`
            ] });
    }
    const summary = metaMaskRevocationSummary(id, chainId, call, chain);
    if (!await approval.confirm(summary)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "The delegation disable was not confirmed; nothing was sent.", { reason: "mm_revoke_refused" });
    }
    const submitted = await state.withLocks(["provider-session:metamask-agent-wallet"], async () => await wallet.send({ chainId,
        from: call.from, payload: mmRevocationPayload(call, chain), intent: `APN ${id}: disable delegation ${call.delegationHash}` }));
    return { operation_id: id, chain_id: chainId, kind: "metamask_delegation_disable", delegator: call.from, delegation_manager: call.to,
        delegation_hash: call.delegationHash, call_hash: call.callHash, fingerprint: summary.fingerprint,
        nonce_atomic: chain.nonceAtomic, gas_limit_atomic: chain.gasLimitAtomic, max_fee_per_gas_atomic: chain.maxFeePerGasAtomic,
        maximum_native_cost_wei: chain.maximumNativeCostWei, submission: submitted, proof_class: "owner_wallet_handoff_unproven",
        next_actions: [...submitted.disposition === "pending" ? ["Confirm this disable request in MetaMask Mobile or the email registered to your MetaMask dashboard."] : [],
            resume] };
}
//# sourceMappingURL=service.js.map