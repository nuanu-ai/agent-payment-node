import { randomUUID } from "node:crypto";
import { approvalCode } from "../../approval-code.js";
import { EncryptedProfilePolicy } from "../../encrypted-profile-policy.js";
import { ApnError } from "../../errors.js";
import { MacOSLoginKeychainSecret } from "../../macos-keychain.js";
import { refreshOperationIndex } from "../../operation-index/refresh.js";
import { failureEnvelope, successEnvelope } from "../../output.js";
import { HttpsBaseRpc } from "../../rpc.js";
import { StateStore } from "../../state.js";
import { exactChainConsent } from "../../tty-approval.js";
import { Permit2AllowanceService } from "./service.js";
import { publicPermit2Allowance } from "./view.js";
/** `apn x402 permit2 allowance set|revoke|observe|status` on the CLI path; MCP reaches set and revoke only as a handoff. */
export async function executePermit2AllowanceCli(bound, options, root) {
    const request = bound.request, requestId = randomUUID();
    let operationId;
    try {
        const state = new StateStore(root), wrapping = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
        const rpc = bound.rpcUrl === undefined ? unavailableRpc() : options.permit2AllowanceRpc ?? publicAllowanceRpc(bound.rpcUrl, state);
        const service = new Permit2AllowanceService(root, { rpc, wrapping, now: () => options.clock?.now() ?? new Date(),
            policy: options.policy ?? new EncryptedProfilePolicy(state, wrapping, { approve: async () => {
                    throw new ApnError("APN_INTERNAL", "An allowance never changes the owner's policy.");
                } }, options.clock),
            consent: async (record) => await consent(record, options) });
        let record;
        if (request.command === "x402.permit2.allowance.status")
            record = await service.records.required(request.operationId);
        else if (request.command === "x402.permit2.allowance.observe")
            record = await service.observe(request.operationId);
        else if (request.command === "x402.permit2.allowance.set" || request.command === "x402.permit2.allowance.revoke") {
            const { command, ...input } = request;
            const prepared = await service.prepare({ ...input, action: command === "x402.permit2.allowance.set" ? "set" : "revoke" });
            operationId = prepared.operationId;
            record = await service.execute(prepared.operationId);
        }
        else
            throw new ApnError("APN_UNSUPPORTED_COMMAND", "Permit2 allowance command is unavailable.");
        const data = publicPermit2Allowance(record);
        return successEnvelope(request, requestId, { proofClass: proofClass(record), data, operation: null, receipt: null, nextActions: data.next_actions });
    }
    catch (error) {
        return failureEnvelope(request.command, requestId, error);
    }
    finally {
        if (operationId !== undefined)
            await refreshOperationIndex(root, operationId);
    }
}
function publicAllowanceRpc(url, state) {
    const rpc = new HttpsBaseRpc(url, { directGuardState: state });
    rpc.armEvmDirectRpcGuard();
    return { origin: new URL(url).origin, batch: async (calls) => await rpc.batchCall(calls), send: async (raw) => await rpc.submitRawTransaction(raw) };
}
function unavailableRpc() {
    const missing = () => { throw new ApnError("APN_RPC_CONFIG", "Pass --rpc-url for the operation's chain.", { reason: "x402_rpc_required" }); };
    return { origin: "", batch: async () => missing(), send: async () => missing() };
}
async function consent(record, options) {
    const t = record.terms;
    await exactChainConsent([
        `Agent Payment Node Permit2 allowance ${t.action === "set" ? "approval" : "revoke"}`, `Operation: ${record.operationId}`, `Profile: ${record.profile}`,
        `Chain: eip155:${t.chainId}`, `Wallet: ${t.owner}`, `Token: ${t.token}`, `Spender: Permit2 ${t.spender}`,
        `New allowance: ${t.amountAtomic} atomic (now ${t.priorAllowanceAtomic})`,
        `Owner cap: ${t.admission.boundAtomic ?? "not applicable (revoke)"} from ${t.admission.source}`,
        `Nonce ${t.nonce}; gas limit ${t.gasLimit}; max fee ${t.maxFeePerGasWei} wei; priority ${t.maxPriorityFeePerGasWei} wei; maximum native debit ${t.maxNativeDebitWei} wei`,
        `Fingerprint: ${record.fingerprint}`, `Window ends: ${t.expiresAt}`,
        "One transaction is signed and sent once; an unclear send is observed, never resent.",
    ], approvalCode("transfer", "x402-permit2-allowance.v1", record.fingerprint), t.expiresAt, options.permit2AllowanceTtyOptions ?? {});
}
function proofClass(record) {
    if (record.state === "completed" || record.state === "reverted")
        return `receipt_at_${record.terms.proofTag}`;
    if (record.state === "superseded")
        return "finalized_nonce_spent_era_indexed";
    if (record.state === "abandoned_unknown")
        return "owner_acknowledgement_only";
    return "permit2_allowance_local_journal";
}
//# sourceMappingURL=cli.js.map