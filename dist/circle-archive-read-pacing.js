import { ApnError } from "./errors.js";
const ORIGIN = "https://arbitrum-one-public.nodies.app";
/** These are the existing Circle/native read methods. Broadcast is deliberately absent. */
const READ = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
export function archiveReadInterval(raw) {
    if (raw === undefined || raw === "0")
        return 0;
    if (!/^[1-9][0-9]{0,2}$/u.test(raw) || Number(raw) > 500) {
        throw new ApnError("APN_RPC_CONFIG", "Arbitrum archive minimum read interval must be a canonical integer from 0 to 500 milliseconds.");
    }
    return Number(raw);
}
/** One process shares request-start scheduling across both finite RPC clients. No retry ownership. */
export class CircleArchiveReadPacer {
    now;
    wait;
    queue = Promise.resolve();
    lastStart;
    constructor(now = () => performance.now(), wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
        this.now = now;
        this.wait = wait;
    }
    async start(endpoint, method, interval, guard, request, signal) {
        const check = () => { signal?.throwIfAborted(); guard(); signal?.throwIfAborted(); };
        signal?.throwIfAborted();
        if (interval === 0 || new URL(endpoint).origin !== ORIGIN || !READ.has(method))
            return request();
        check();
        const scheduled = this.queue.then(async () => {
            check();
            while (this.lastStart !== undefined && this.now() < this.lastStart + interval) {
                // Poll the existing absolute guard; waiting never creates or renews authority.
                await this.wait(Math.min(25, this.lastStart + interval - this.now()));
                check();
            }
            check();
            this.lastStart = this.now();
            return { response: request() };
        });
        this.queue = scheduled.then(() => { }, () => { });
        return (await scheduled).response;
    }
}
export const circleArchiveReadPacer = new CircleArchiveReadPacer();
//# sourceMappingURL=circle-archive-read-pacing.js.map