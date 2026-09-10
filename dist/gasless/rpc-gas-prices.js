import { exactKeys } from "../canonical.js";
import { quantity, rpcQuantity, rpcRecord } from "./rpc-codec.js";
import { gasPrices } from "./rpc-state.js";
import { GASLESS_MAX_UINT120, gaslessFailure } from "./validation.js";
/** Quote a new bounded offer from fast; an existing offer must still cover slow. */
export function bundlerGasPrices(raw, rawBase, rawPriority, approved) {
    const tiers = rpcRecord(raw);
    if (!exactKeys(tiers, ["slow", "standard", "fast"]))
        invalid();
    const prices = ["slow", "standard", "fast"].map(name => {
        const tier = rpcRecord(tiers[name]);
        if (!exactKeys(tier, ["maxFeePerGas", "maxPriorityFeePerGas"]))
            invalid();
        const maximum = rpcQuantity(tier.maxFeePerGas), priority = rpcQuantity(tier.maxPriorityFeePerGas);
        if (maximum === 0n || maximum > GASLESS_MAX_UINT120 || priority > maximum)
            invalid();
        return { maximum, priority };
    });
    const [slow, standard, fast] = prices;
    if (slow.maximum > standard.maximum || standard.maximum > fast.maximum ||
        slow.priority > standard.priority || standard.priority > fast.priority)
        invalid();
    if (approved !== undefined && (BigInt(approved.maxFeePerGas) < slow.maximum ||
        BigInt(approved.maxPriorityFeePerGas) < slow.priority)) {
        gaslessFailure("APN_OPERATION_BLOCKED", "gasless_bundler_fee_drift");
    }
    const base = rpcQuantity(rawBase), rpcPriority = rpcQuantity(rawPriority);
    const priority = [rpcPriority, fast.priority, fast.maximum - 2n * base].reduce((a, b) => a > b ? a : b);
    return gasPrices(rawBase, quantity(priority));
}
function invalid() { return gaslessFailure("APN_RPC_PROTOCOL", "gasless_bundler_gas_prices"); }
//# sourceMappingURL=rpc-gas-prices.js.map