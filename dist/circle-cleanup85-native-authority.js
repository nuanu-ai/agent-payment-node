import { keccak256 } from "viem";
import { cleanup85Blocked } from "./circle-cleanup85-native-codec.js";
const physical = new WeakMap();
export function assertCleanup85PhysicalGuard(guard, raw) {
    if (guard === undefined || physical.get(guard)?.raw !== raw)
        cleanup85Blocked("private_physical_guard_required");
}
/** A foreground controller must hold the real owner/custody/policy locks throughout work.
 * No JSON request, journal or recovery sidecar can reconstruct this ephemeral authority. */
export async function withCleanup85NativeAuthority(binding, expiresAt, now, confirm, work) {
    const enteredAt = now();
    if (!Number.isFinite(enteredAt) || enteredAt >= Date.parse(expiresAt))
        cleanup85Blocked("foreground_expired");
    await confirm();
    let live = true, armed = false, deadline = Math.min(enteredAt + 60_000, Date.parse(expiresAt));
    const callbacks = [];
    const assert = (candidate, policyExpiresAt) => {
        deadline = Math.min(deadline, Date.parse(policyExpiresAt));
        if (!live || candidate !== binding || !Number.isFinite(deadline) || now() >= deadline) {
            live = false;
            cleanup85Blocked("foreground_or_policy_expired");
        }
    };
    const authority = Object.freeze({
        assert,
        assertRemaining: (candidate, minimumMs) => { assert(candidate, expiresAt); if (!Number.isSafeInteger(minimumMs) || minimumMs < 0 || deadline - now() < minimumMs)
            cleanup85Blocked("foreground_remaining_time"); },
        beforeSend: (candidate, raw, hash, assertFresh) => {
            assert(candidate, expiresAt);
            if (armed || keccak256(raw) !== hash)
                cleanup85Blocked("one_send_only");
            armed = true;
            let checks = 0;
            const guard = () => {
                assert(candidate, expiresAt);
                assertFresh?.();
                if (++checks > 2 || physical.get(guard)?.binding !== binding || keccak256(raw) !== hash)
                    cleanup85Blocked("physical_material_or_replay");
            };
            physical.set(guard, { raw, binding });
            callbacks.push(guard);
            return guard;
        },
    });
    try {
        assert(binding, expiresAt);
        return await work(authority);
    }
    finally {
        live = false;
        for (const guard of callbacks)
            physical.delete(guard);
        callbacks.length = 0;
    }
}
//# sourceMappingURL=circle-cleanup85-native-authority.js.map