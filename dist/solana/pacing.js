import { sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { RpcHttpFailure, RpcProviderScheduler } from "../lifi/rpc-scheduler.js";
/** Persist POST starts by provider host so separate CLI invocations respect the same public RPC allowance. */
export class SolanaRpcPacer {
    now;
    wait;
    scheduler;
    constructor(state, now = Date.now, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
        this.now = now;
        this.wait = wait;
        const coordinator = { coordinate: async (family, work) => {
                const familyHash = sha256(`rpc-provider-family\0${family}`);
                return await state.withLocks([`rpc-provider-family:${familyHash}`], async () => await work(await state.loadRpcProviderPacing(familyHash), (value) => state.writeRpcProviderPacing(familyHash, value), await state.loadRpcProviderCooldown(familyHash), (value) => state.writeRpcProviderCooldown(familyHash, value)));
            } };
        this.scheduler = new RpcProviderScheduler(coordinator, now, "reject", "rate_limit");
    }
    async schedule(endpoint, task) {
        let rateLimit = null;
        try {
            return await this.scheduler.schedule(endpoint, this.now, this.wait, () => { }, async () => {
                try {
                    return await task();
                }
                catch (error) {
                    if (error instanceof ApnError && error.code === "APN_RPC_RATE_LIMITED") {
                        rateLimit = error;
                        throw new RpcHttpFailure("solana", 429, error.details?.retryAfterMs);
                    }
                    throw error;
                }
            });
        }
        catch (error) {
            if (error instanceof RpcHttpFailure && rateLimit !== null)
                throw rateLimit;
            throw error;
        }
    }
}
//# sourceMappingURL=pacing.js.map