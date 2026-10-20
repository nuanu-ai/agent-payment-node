import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
/**
 * Before signing and before the first send on every network but Base USDC, the frozen payer and the owner's per-payment cap
 * are re-checked from local state. No RPC read is repeated: the token domain, balance and unattended-balance cap were
 * proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. Base USDC keeps its single prepare-time admission.
 */
export declare function assertCurrentNetworkPolicy(context: RuntimeContext, operation: X402OperationRecord): Promise<void>;
/**
 * The owner's optional x402 payee pin (profile policy; absent = not restricted), re-read from local state before signing
 * and before the first paid request on every network, so a pin added after prepare stops an unsent payment.
 */
export declare function assertCurrentX402Payee(context: RuntimeContext, operation: X402OperationRecord): Promise<void>;
