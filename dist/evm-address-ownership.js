import { ApnError } from "./errors.js";
import { walletEnvelopeIdentity } from "./encrypted-wallet-store.js";
import { listEncryptedWalletEnvelopes, listLocalWallets } from "./wallet-import-collision.js";
import { stateCorrupt, stateSecurity } from "./secure-state-store.js";
import { isGrantedPermissionRecord } from "./metamask-smart-account-record.js";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const PROFILE_HASH = /^[a-f0-9]{64}$/u;
/** All callers that inspect or change an EVM owner must share this kernel lock. */
export function evmAddressLock(address) {
    if (!ADDRESS.test(address))
        throw new ApnError("APN_INVALID_INPUT", "EVM address is invalid.");
    return `evm-owner:${address.toLowerCase()}`;
}
/** Caller holds evmAddressLock(address). Future Relay execution must repeat this check
 * while holding that lock before signing and again before the first submission. */
export async function assertExclusiveEvmOwner(state, address, ownProfileHash) {
    const target = address.toLowerCase();
    if (!ADDRESS.test(address) || !PROFILE_HASH.test(ownProfileHash)) {
        throw new ApnError("APN_INVALID_INPUT", "EVM ownership check identity is invalid.");
    }
    const check = (ownerHash, candidate) => {
        if (candidate.toLowerCase() === target && ownerHash !== ownProfileHash) {
            throw new ApnError("APN_OPERATION_BLOCKED", "EVM address is bound to another APN profile.");
        }
    };
    for (const entry of await state.profileImportEntries()) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !PROFILE_HASH.test(entry.name)) {
            stateSecurity("Profiles directory contains an unsafe entry.");
        }
        const profile = await state.loadProviderProfile(entry.name);
        if (profile === null)
            stateCorrupt("Provider profile disappeared during ownership check.");
        check(entry.name, profile.public_address);
    }
    for (const wallet of await listLocalWallets(state))
        check(wallet.profileHash, wallet.address);
    for (const envelope of await listEncryptedWalletEnvelopes(state)) {
        const identity = walletEnvelopeIdentity(envelope.value, envelope.profile);
        check(state.profileHash(identity.profile), identity.address);
    }
}
/** Execution-only Relay owner check. Call immediately before signing and again
 * before first submission. No network operation belongs in this critical section. */
export async function assertExclusiveRelayExecutionOwner(state, permissions, address, ownProfileHash) {
    const target = address.toLowerCase();
    if (!ADDRESS.test(address) || !PROFILE_HASH.test(ownProfileHash)) {
        throw new ApnError("APN_INVALID_INPUT", "Relay execution ownership identity is invalid.");
    }
    await state.withLocks([evmAddressLock(address)], async () => {
        await assertExclusiveEvmOwner(state, address, ownProfileHash);
        for (const record of await permissions.listAll()) {
            if (isGrantedPermissionRecord(record) && record.owner_address.toLowerCase() === target &&
                record.profile_hash !== ownProfileHash) {
                throw new ApnError("APN_OPERATION_BLOCKED", "EVM address has a Smart Account grant in another APN profile.");
            }
        }
    });
}
//# sourceMappingURL=evm-address-ownership.js.map