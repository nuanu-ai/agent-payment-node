/** Private, invocation-scoped authority while the caller retains profile/owner locks. */
import type { ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { ClockPort } from "../ports.js";
import { ApnError } from "../errors.js";
export class RelayNativeAuthority {
  #disposed = false;
  readonly #activation: string;
  readonly #expires: number;
  readonly #effective: number;
  readonly #day: string;
  constructor(private readonly operation: RelayUnsignedOperation, active: ActiveAssetPolicy,
    private readonly clock: ClockPort, private readonly signal: AbortSignal) {
    this.#activation = active.activationDigest;
    this.#expires = Math.min(Date.parse(operation.deadline) - 60_000,
      active.registry.expiresAt === undefined ? Infinity : Date.parse(active.registry.expiresAt));
    this.#effective = active.registry.effectiveAt === undefined ? -Infinity : Date.parse(active.registry.effectiveAt);
    this.#day = clock.now().toISOString().slice(0, 10);
    this.assert(active);
  }
  assert(active?: ActiveAssetPolicy): void {
    const now = this.clock.now(), at = now.getTime();
    if (this.operation.sourceChainId === 8453 && this.operation.policyActivationDigest === undefined || this.#disposed || this.signal.aborted || !Number.isFinite(at) || at >= this.#expires ||
      at < this.#effective || now.toISOString().slice(0, 10) !== this.#day || active !== undefined &&
      (active.activationDigest !== this.#activation || active.digest !== this.operation.policyDigest ||
       active.revision !== this.operation.policyRevision ||
       this.operation.policyActivationDigest !== undefined && active.activationDigest !== this.operation.policyActivationDigest))
      throw new ApnError("APN_OPERATION_BLOCKED", "Relay native foreground authority expired or changed.", { reason: "relay_native_authority_expired_or_changed" });
  }
  get deadline(): string { return new Date(this.#expires).toISOString(); }
  dispose(): void { this.#disposed = true; }
}
