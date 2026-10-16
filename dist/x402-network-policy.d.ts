import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
/**
 * Before signing and before the first send on Ethereum or Arbitrum, the frozen payer and the owner's per-payment cap
 * are re-checked from local state. No RPC read is repeated: the token domain, balance and unattended-balance cap were
 * proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. Base keeps its single prepare-time admission.
 */
export declare function assertCurrentNetworkPolicy(context: RuntimeContext, operation: X402OperationRecord): Promise<void>;
