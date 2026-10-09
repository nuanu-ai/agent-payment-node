/** Private, invocation-scoped authority while the caller retains profile/owner locks. */
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { ClockPort } from "../ports.js";
export declare class RelayNativeAuthority {
    #private;
    private readonly operation;
    private readonly clock;
    private readonly signal;
    constructor(operation: RelayUnsignedOperation, active: ActiveAssetPolicy, clock: ClockPort, signal: AbortSignal);
    assert(active?: ActiveAssetPolicy): void;
    get deadline(): string;
    dispose(): void;
}
