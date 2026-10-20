import { sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { RpcHttpFailure, rpcProviderFamily, RpcProviderScheduler } from "./lifi/rpc-scheduler.js";
/** One command's hard transport cap, with POST starts paced across processes by provider family. */
export class EvmDirectRpcGuard {
    state;
    limit;
    now;
    wait;
    physical = 0;
    scheduler;
    constructor(state, limit = 24, now = Date.now, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), remainingWaitMs) {
        this.state = state;
        this.limit = limit;
        this.now = now;
        this.wait = wait;
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new ApnError("APN_RPC_CONFIG", "The direct EVM POST cap must be a positive integer.");
        const coordinator = { coordinate: async (family, work) => {
                const familyHash = providerFamilyHash(family);
                return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await state.loadRpcProviderPacing(familyHash), value => state.writeRpcProviderPacing(familyHash, value), await state.loadRpcProviderCooldown(familyHash), value => state.writeRpcProviderCooldown(familyHash, value)), remainingWaitMs === undefined ? {} : { waitMs: Math.min(5_000, Math.max(0, remainingWaitMs())) });
            } };
        this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "rate_limit");
    }
    get physicalRequests() { return this.physical; }
    /**
     * The refusal post() would meet before any transport, read without starting a POST: this command's cap spent, or the
     * endpoint's provider family cooling down (read under the family lock, as the scheduler reads it).
     */
    async assertCanPost(endpoint) {
        if (this.physical >= this.limit)
            throw this.budgetExceeded();
        const familyHash = providerFamilyHash(rpcProviderFamily(endpoint));
        const until = await this.state.withLocks([`rpc-provider-family:${familyHash}`], async () => await this.state.loadRpcProviderCooldown(familyHash));
        if (until !== null && until > this.now())
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "RPC provider is cooling down.", { reason: "rpc_provider_cooldown" });
    }
    async post(endpoint, task) {
        // Reserve before scheduler entry so parallel logical reads cannot pass the cap.
        if (this.physical >= this.limit)
            throw this.budgetExceeded();
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
    budgetExceeded() {
        return new ApnError("APN_RPC_BUDGET_EXCEEDED", "The direct EVM command exhausted its physical RPC POST budget.", { physicalRequests: this.physical, maxPhysicalRequests: this.limit });
    }
}
const providerFamilyHash = (family) => sha256(`rpc-provider-family\0${family}`);
//# sourceMappingURL=evm-direct-rpc-guard.js.map