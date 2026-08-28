import { getAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { CHAIN_CAIP2 } from "./constants.js";
import { ApnError, assertInput } from "./errors.js";
import { parseAtomic } from "./money.js";
const PROFILE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
export function canonicalProfile(value) {
    assertInput(typeof value === "string" && PROFILE.test(value), "Profile must match [a-z0-9][a-z0-9._-]{0,63}.");
    return value;
}
export function canonicalAddress(value) {
    assertInput(typeof value === "string", "Recipient must be an Ethereum address string.");
    try {
        return getAddress(value);
    }
    catch {
        throw new ApnError("APN_INVALID_INPUT", "Recipient must be a valid canonical Ethereum address.");
    }
}
export function parseWalletEnsure(value, profile) {
    if (!isPlainRecord(value) || !exactKeys(value, ["profile", "address", "createdAt", "bindingHash"])) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native wallet.ensure result violates the schema.");
    }
    return nativeWalletFields(value, profile);
}
export function parseWalletDescribe(value, profile) {
    if (!isPlainRecord(value))
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native wallet.describe result is invalid.");
    if (value.found === false && exactKeys(value, ["found"]))
        return { found: false };
    if (value.found === true && exactKeys(value, ["found", "profile", "address", "createdAt", "bindingHash"])) {
        return nativeWalletFields(value, profile);
    }
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native wallet.describe result violates the schema.");
}
export function assertWalletMatches(stored, native) {
    if (stored.profile !== native.profile || stored.address !== native.address ||
        stored.createdAt !== native.createdAt || stored.bindingHash !== native.bindingHash)
        throw new ApnError("APN_WALLET_MISMATCH", "Native wallet identity does not match durable public metadata.");
}
export function publicWallet(wallet, status) {
    return {
        profile: wallet.profile,
        status,
        address: wallet.address,
        chain: CHAIN_CAIP2,
        custody: "local_software_disposable",
        binding_hash: wallet.bindingHash,
        created_at: wallet.createdAt,
        proof_class: "encrypted_apn_home_status",
        next_actions: [],
    };
}
export function validateBalance(snapshot, address) {
    if (snapshot.address.toLowerCase() !== address.toLowerCase()) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC balance response is for a different address.");
    }
    parseAtomic(snapshot.ethAtomic);
    parseAtomic(snapshot.usdcAtomic);
    parseAtomic(snapshot.blockNumberAtomic);
    if (!/^0x[0-9a-f]{64}$/.test(snapshot.blockHash) || snapshot.rpcOrigin.length === 0 || !Number.isFinite(Date.parse(snapshot.observedAt))) {
        throw new ApnError("APN_RPC_PROTOCOL", "RPC balance provenance is invalid.");
    }
}
export function publicProvenance(snapshot) {
    return {
        block_number_atomic: snapshot.blockNumberAtomic,
        block_hash: snapshot.blockHash,
        observed_at: snapshot.observedAt,
        rpc_origin: snapshot.rpcOrigin,
    };
}
function nativeWalletFields(value, profile) {
    if (value.profile !== profile || typeof value.address !== "string" || typeof value.createdAt !== "string" ||
        !Number.isFinite(Date.parse(value.createdAt)) || typeof value.bindingHash !== "string" || !HASH.test(value.bindingHash))
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native wallet result fields are invalid.");
    return {
        found: true,
        profile,
        address: canonicalAddress(value.address),
        createdAt: value.createdAt,
        bindingHash: value.bindingHash,
    };
}
//# sourceMappingURL=wallet-policy.js.map