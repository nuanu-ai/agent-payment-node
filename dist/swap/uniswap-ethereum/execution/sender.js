import { ApnError } from "../../../errors.js";
import { evmRpcHex } from "../../../evm-rpc-codec.js";
import { validateSwapOperation } from "../../model.js";
import { validateUniswapExecutionBinding } from "./binding.js";
export class UniswapSingleSendAdapter {
    effects;
    call;
    constructor(effects, call) {
        this.effects = effects;
        this.call = call;
    }
    async sendOnce(operationValue, bindingValue, now) {
        const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
        if (operation.state !== "submitting" || operation.submissionMarker?.markerHash !== binding.submissionMarkerHash) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Uniswap send requires its durable bound submission marker.", { reason: "uniswap_marker_missing" });
        }
        const effect = await this.effects.load(operation, binding);
        if (effect === null || effect.phase !== "sealed" || effect.sendAttempts !== 0) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Uniswap signed effect is unavailable or already attempted.", { reason: "uniswap_single_send" });
        }
        // This durable transition is the one-way point. Every later outcome is observe-only.
        await this.effects.markSendStarted(operation, binding, now);
        let accepted = false;
        try {
            const returned = evmRpcHex(await this.call("eth_sendRawTransaction", [effect.rawTransaction]), 32);
            accepted = returned === effect.transactionHash;
        }
        catch {
            accepted = false;
        }
        try {
            await this.effects.markSendOutcome(operation, binding, accepted ? "send_accepted" : "send_ambiguous", now);
        }
        catch { /* send_started is already durable and still prevents every resend */ }
        return accepted ? { kind: "submitted", transactionHash: effect.transactionHash } :
            { kind: "possible_send", transactionHash: effect.transactionHash };
    }
}
//# sourceMappingURL=sender.js.map