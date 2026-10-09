import { ApnError } from "../errors.js";
export class RelayNativeAuthority {
    operation;
    clock;
    signal;
    #disposed = false;
    #activation;
    #expires;
    #effective;
    #day;
    constructor(operation, active, clock, signal) {
        this.operation = operation;
        this.clock = clock;
        this.signal = signal;
        this.#activation = active.activationDigest;
        this.#expires = Math.min(Date.parse(operation.deadline) - 60_000, active.registry.expiresAt === undefined ? Infinity : Date.parse(active.registry.expiresAt));
        this.#effective = active.registry.effectiveAt === undefined ? -Infinity : Date.parse(active.registry.effectiveAt);
        this.#day = clock.now().toISOString().slice(0, 10);
        this.assert(active);
    }
    assert(active) {
        const now = this.clock.now(), at = now.getTime();
        if (this.operation.sourceChainId === 8453 && this.operation.policyActivationDigest === undefined || this.#disposed || this.signal.aborted || !Number.isFinite(at) || at >= this.#expires ||
            at < this.#effective || now.toISOString().slice(0, 10) !== this.#day || active !== undefined &&
            (active.activationDigest !== this.#activation || active.digest !== this.operation.policyDigest ||
                active.revision !== this.operation.policyRevision ||
                this.operation.policyActivationDigest !== undefined && active.activationDigest !== this.operation.policyActivationDigest))
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay native foreground authority expired or changed.", { reason: "relay_native_authority_expired_or_changed" });
    }
    get deadline() { return new Date(this.#expires).toISOString(); }
    dispose() { this.#disposed = true; }
}
//# sourceMappingURL=native-authority.js.map