import type { RuntimeContext } from "./runtime.js";
import type { X402OperationRecord } from "./x402-state-integrity.js";
/**
 * Before signing and before the first send, the owner's per-payment cap is re-checked from local state on every network,
 * and off Base USDC the frozen payer too. No RPC read is repeated: the token domain, balance and unattended-balance cap
 * were proven at prepare, the signature binds the frozen domain, and an unfunded authorization simply never settles and
 * expires by its own validBefore. On Base USDC only the cap is re-checked; a Smart Account (ERC-7710) payment checks it
 * against its frozen authority in the delegated-policy check instead.
 */
export declare function assertCurrentNetworkPolicy(context: RuntimeContext, operation: X402OperationRecord): Promise<void>;
/**
 * The owner's current per-payment x402 limit against the cap this operation froze at prepare. Below it APN signs and sends
 * nothing, and the refusal says so and names what changes the outcome: the owner raising the limit, or the authorization
 * lapsing at validBefore, after which resume closes an unsent one without effect. Resume itself is never the next action,
 * since an unchanged policy refuses it again.
 */
export declare function assertX402LimitCoversCap(operation: X402OperationRecord, maxX402AmountAtomic: string): void;
/**
 * The owner's optional x402 payee pin (profile policy; absent = not restricted), re-read from local state before signing
 * and before the first paid request on every network, so a pin added after prepare stops an unsent payment.
 */
export declare function assertCurrentX402Payee(context: RuntimeContext, operation: X402OperationRecord): Promise<void>;
