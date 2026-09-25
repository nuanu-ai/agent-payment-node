import { sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { RpcHttpFailure, RpcProviderScheduler } from "./lifi/rpc-scheduler.js";
/** One command's hard transport cap, with POST starts paced across processes by provider family. */
export class EvmDirectRpcGuard {
    limit;
    now;
    wait;
    physical = 0;
    scheduler;
    constructor(state, limit = 24, now = Date.now, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
        this.limit = limit;
        this.now = now;
        this.wait = wait;
        const coordinator = { coordinate: async (family, work) => {
                const familyHash = sha256(`rpc-provider-family\0${family}`);
                return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await state.loadRpcProviderPacing(familyHash), value => state.writeRpcProviderPacing(familyHash, value), await state.loadRpcProviderCooldown(familyHash), value => state.writeRpcProviderCooldown(familyHash, value)));
            } };
        this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "rate_limit");
    }
    get physicalRequests() { return this.physical; }
    async post(endpoint, task) {
        // Reserve before scheduler entry so parallel logical reads cannot pass the cap.
        if (this.physical >= this.limit)
            throw new ApnError("APN_RPC_BUDGET_EXCEEDED", "The direct EVM command exhausted its physical RPC POST budget.", { physicalRequests: this.physical, maxPhysicalRequests: this.limit });
        this.physical += 1;
        let started = false;
        let rateLimit = null;
        try {
            return await this.scheduler.schedule(endpoint, this.now, this.wait, () => { }, async () => {
                started = true;
                try {
                    return await task();
                }
                catch (error) {
                    if (error instanceof ApnError && error.details?.httpStatus === 429) {
                        rateLimit = new ApnError("APN_RPC_RATE_LIMITED", "The direct EVM RPC provider requested a cooldown.", { httpStatus: 429 });
                        throw new RpcHttpFailure("evm-direct", 429);
                    }
                    throw error;
                }
            });
        }
        catch (error) {
            if (!started)
                this.physical -= 1;
            if (error instanceof RpcHttpFailure && rateLimit !== null)
                throw rateLimit;
            throw error;
        }
    }
}
//# sourceMappingURL=evm-direct-rpc-guard.js.map