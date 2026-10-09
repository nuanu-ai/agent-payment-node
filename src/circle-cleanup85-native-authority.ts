import { keccak256, type Hex } from "viem";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";

const physical = new WeakMap<() => void, { raw: Hex; binding: string }>();
export interface Cleanup85NativeAuthority {
  assert(binding: string, policyExpiresAt: string): void;
  assertRemaining(binding:string,minimumMs:number):void;
  beforeSend(binding: string, raw: Hex, hash: Hex, assertFresh?: () => void): () => void;
}
export function assertCleanup85PhysicalGuard(guard: (() => void) | undefined, raw: unknown): asserts guard is () => void {
  if (guard === undefined || physical.get(guard)?.raw !== raw) cleanup85Blocked("private_physical_guard_required");
}
/** A foreground controller must hold the real owner/custody/policy locks throughout work.
 * No JSON request, journal or recovery sidecar can reconstruct this ephemeral authority. */
export async function withCleanup85NativeAuthority<T>(binding: string, expiresAt: string, now: () => number,
  confirm: () => Promise<void>, work: (authority: Cleanup85NativeAuthority) => Promise<T>): Promise<T> {
  const enteredAt = now();
  if (!Number.isFinite(enteredAt) || enteredAt >= Date.parse(expiresAt)) cleanup85Blocked("foreground_expired");
  await confirm();
  let live = true, armed = false, deadline = Math.min(enteredAt + 60_000, Date.parse(expiresAt));
  const callbacks: Array<() => void> = [];
  const assert = (candidate: string, policyExpiresAt: string): void => {
    deadline = Math.min(deadline, Date.parse(policyExpiresAt));
    if (!live || candidate !== binding || !Number.isFinite(deadline) || now() >= deadline) {
      live = false; cleanup85Blocked("foreground_or_policy_expired");
    }
  };
  const authority: Cleanup85NativeAuthority = Object.freeze({
    assert,
    assertRemaining:(candidate:string,minimumMs:number)=>{assert(candidate,expiresAt);if(!Number.isSafeInteger(minimumMs)||minimumMs<0||deadline-now()<minimumMs)cleanup85Blocked("foreground_remaining_time");},
    beforeSend: (candidate: string, raw: Hex, hash: Hex, assertFresh?: () => void) => {
      assert(candidate, expiresAt);
      if (armed || keccak256(raw) !== hash) cleanup85Blocked("one_send_only");
      armed = true;
      let checks = 0;
      const guard = () => {
        assert(candidate, expiresAt); assertFresh?.();
        if (++checks > 2 || physical.get(guard)?.binding !== binding || keccak256(raw) !== hash) cleanup85Blocked("physical_material_or_replay");
      };
      physical.set(guard, { raw, binding }); callbacks.push(guard); return guard;
    },
  });
  try { assert(binding, expiresAt); return await work(authority); }
  finally { live = false; for (const guard of callbacks) physical.delete(guard); callbacks.length = 0; }
}
