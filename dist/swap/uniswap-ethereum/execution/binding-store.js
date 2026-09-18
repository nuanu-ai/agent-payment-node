import { canonicalJson } from "../../../canonical.js";
import { ApnError } from "../../../errors.js";
import { SecureStateStore, stateIdentifier } from "../../../secure-state-store.js";
import { validateSwapOperation } from "../../model.js";
import { validateUniswapExecutionBinding } from "./binding.js";
/**
 * Durable execution binding, written after the submission marker and before signing. It holds no secret: resume
 * needs it to open the encrypted effect and to observe the exact transaction without ever signing or sending again.
 */
export class UniswapExecutionBindingStore extends SecureStateStore {
    initialized;
    async save(operationValue, bindingValue) {
        const operation = validateSwapOperation(operationValue), binding = validateUniswapExecutionBinding(bindingValue, operation);
        await this.ready();
        return await this.withLocks([`uniswap-binding:${operation.operationId}`], async () => {
            const existing = await this.readJson(this.path(operation));
            if (existing !== null) {
                const prior = validateUniswapExecutionBinding(existing, operation);
                if (canonicalJson(prior) !== canonicalJson(binding))
                    throw new ApnError("APN_STATE_CORRUPT", "A different Uniswap execution binding already exists.");
                return prior;
            }
            await this.ensureDirectory(`uniswap-execution-bindings/${operation.ownerProfileHash}`);
            await this.writeJson(this.path(operation), binding, true);
            return binding;
        });
    }
    async load(operationValue) {
        const operation = validateSwapOperation(operationValue);
        await this.ready();
        const value = await this.readJson(this.path(operation));
        return value === null ? null : validateUniswapExecutionBinding(value, operation);
    }
    path(operation) {
        stateIdentifier(operation.ownerProfileHash, "Uniswap binding profile");
        stateIdentifier(operation.operationId, "Uniswap binding operation");
        return `uniswap-execution-bindings/${operation.ownerProfileHash}/${operation.operationId}.json`;
    }
    async ready() {
        this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("uniswap-execution-bindings"); })();
        await this.initialized;
    }
}
//# sourceMappingURL=binding-store.js.map