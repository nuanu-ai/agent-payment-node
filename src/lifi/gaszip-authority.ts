import { keccak256, type Hex } from "viem";
import { hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
/** Only callbacks minted in a live foreground scope may authorize a physical send. */
const physicalGuards = new WeakMap<() => void, Hex>();
const refuse = (): never => { throw new ApnError("APN_OPERATION_BLOCKED", "GasZip live effect authority is unavailable or expired."); };
export interface GaszipEffectBinding {
  readonly operationId: string; readonly profile: string; readonly owner: unknown; readonly providerBinding: unknown;
  readonly activationDigest?: string; readonly policyDigest: string; readonly policyRevision: number;
  readonly plan: unknown; readonly amountAtomic: string; readonly minimumOutputAtomic: string; readonly maximumFeeAtomic: string;
  readonly quoteDigest: string; readonly expiresAt: string;
}
export function gaszipEffectBinding(value: GaszipEffectBinding, lane: string): string {
  return hashObject({ lane, operationId: value.operationId, profile: value.profile, owner: value.owner,
    providerBinding: value.providerBinding, activationDigest: value.activationDigest, policyDigest: value.policyDigest,
    policyRevision: value.policyRevision, plan: value.plan, amountAtomic: value.amountAtomic,
    minimumOutputAtomic: value.minimumOutputAtomic, maximumFeeAtomic: value.maximumFeeAtomic,
    quoteDigest: value.quoteDigest, expiresAt: value.expiresAt });
}
export function assertGaszipPhysicalGuard(guard: (() => void) | undefined, raw: unknown): asserts guard is () => void {
  if (guard === undefined || physicalGuards.get(guard) !== raw) refuse();
}
export interface GaszipScopedAuthority {
  assert(binding: string, policyExpiresAt?: string): void;
  beforeSend(binding: string, raw: Hex, hash: Hex): () => void;
}
/** Constructor and grant state stay private; persisted operation metadata cannot mint this scope.
 * The caller supplies the trusted normal foreground flow, then disposes all capabilities on return. */
export async function withGaszipForegroundAuthority<T>(binding: string, operationExpiresAt: string,
  now: () => number, confirm: () => Promise<void>, work: (authority: GaszipScopedAuthority) => Promise<T>): Promise<T> {
  await confirm();
  let live = true, deadline = Math.min(Date.parse(operationExpiresAt), now() + 60_000), armed = false;
  const callbacks: Array<() => void> = [];
  const assert = (candidate: string, policyExpiresAt?: string): void => {
    if (policyExpiresAt !== undefined) deadline = Math.min(deadline, Date.parse(policyExpiresAt));
    if (!live || candidate !== binding || !Number.isFinite(deadline) || now() >= deadline) { live = false; refuse(); }
  };
  const authority: GaszipScopedAuthority = {
    assert,
    beforeSend: (candidate, raw, hash) => {
      assert(candidate); if (armed || keccak256(raw) !== hash) refuse(); armed = true;
      let checks = 0;
      const guard = () => { assert(candidate); if (++checks > 2 || keccak256(raw) !== hash) refuse(); };
      physicalGuards.set(guard, raw); callbacks.push(guard); return guard;
    },
  };
  try { assert(binding); return await work(authority); }
  finally { live = false; for (const guard of callbacks) physicalGuards.delete(guard); callbacks.length = 0; }
}
