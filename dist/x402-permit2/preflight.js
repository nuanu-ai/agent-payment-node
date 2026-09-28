import { getAddress } from "viem";
import { isPlainRecord, sha256 } from "../canonical.js";
import { AssetUsageLedger } from "../asset-usage-ledger.js";
import { ApnError } from "../errors.js";
import { HttpsBaseRpc } from "../rpc.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { walletEnvelopeIdentity } from "../encrypted-wallet-store.js";
import { decodeCanonicalBase64Json, decodePaymentRequiredHeader } from "../x402-codec.js";
import { createPermit2ProductionReadPort } from "./read-port.js";
import { preparePermit2WithPort } from "./prepare.js";
/** An unsigned CLI read with no payment-state persistence; only RPC pacing metadata may be written. */
export async function permit2CurrentOwnerPreflight(root, request, ports) {
    const profile = canonicalProfile(request.profile);
    if (!/^[a-f0-9]{64}$/u.test(request.expectedChallengeHash) ||
        !/^(0|[1-9][0-9]{0,5})$/u.test(request.expectedIndex))
        invalid();
    const expected = decodeCanonicalBase64Json(request.expectedTerms);
    if (!isPlainRecord(expected))
        invalid();
    const challenge = decodePaymentRequiredHeader(request.paymentRequired);
    const state = new StateStore(root);
    const profileHash = state.profileHash(profile);
    const localAccount = async () => {
        const artifacts = await state.loadWalletArtifacts(profile, profileHash);
        const provider = await state.loadProviderProfile(profileHash);
        if (artifacts.stored === null || artifacts.encrypted === null ||
            provider !== null && provider.provider_id !== "local") {
            throw new ApnError("APN_OPERATION_BLOCKED", "A current local owner wallet is required.", { reason: "x402_permit2_local_wallet_required" });
        }
        const envelope = walletEnvelopeIdentity(artifacts.encrypted, profile);
        if (artifacts.stored.profile !== profile || artifacts.stored.profileHash !== profileHash ||
            artifacts.stored.address.toLowerCase() !== envelope.address.toLowerCase() ||
            artifacts.stored.bindingHash !== envelope.bindingHash ||
            provider !== null && (provider.public_address.toLowerCase() !== envelope.address.toLowerCase() ||
                provider.account_binding_hash !== envelope.bindingHash)) {
            throw new ApnError("APN_PROFILE_DRIFT", "Local owner wallet records disagree.");
        }
        return getAddress(envelope.address);
    };
    const payer = await localAccount();
    const now = ports.now ?? (() => new Date());
    const at = now();
    const read = createPermit2ProductionReadPort({ profile, stateRoot: root, localAccount,
        usage: ports.usage ?? { usage: (identity, when) => new AssetUsageLedger(root).usageReadOnly(identity, when) },
        rpc: ports.rpc, ...(ports.transport === undefined ? {} : { transport: ports.transport }), now });
    const prepared = await preparePermit2WithPort(read, { payer, localWallet: true, challenge,
        expected: { challengeHash: request.expectedChallengeHash, index: Number(request.expectedIndex),
            requirement: expected }, nowSeconds: Math.floor(at.getTime() / 1000) });
    return { profile, state: "admissible_unsigned", capability: "execution_blocked", chain: prepared.chain,
        payer: prepared.payer, recipient: prepared.payTo, token: prepared.token,
        amountAtomic: prepared.amountAtomic, deadline: prepared.expiresAtUnix,
        challengeHash: prepared.challengeHash, offerHash: prepared.offerHash,
        policyDigest: prepared.policyDigest, prepareHash: prepared.prepareHash,
        blockerCodes: ["permit2_execution_not_exposed"] };
}
const RPC_GAP_MS = 750;
const RPC_CRASH_GUARD_MS = 15_000 + RPC_GAP_MS;
/** Cross-process pacing uses APN's kernel-backed state lock and operational RPC pacing record. */
export function permit2PublicRpc(url, stateRoot, transport) {
    const rpc = new HttpsBaseRpc(url);
    const endpoint = rpc.endpoint.toString();
    const state = new StateStore(stateRoot);
    const endpointHash = sha256(`permit2-rpc-endpoint\0${endpoint}`);
    return { call: async (method, params, signal) => {
            return await state.withLocks([`rpc-provider-family:${endpointHash}`], async () => {
                if (signal.aborted)
                    aborted();
                const lastStart = await state.loadRpcProviderPacing(endpointHash);
                const cooldownUntil = await state.loadRpcProviderCooldown(endpointHash);
                let now = Date.now();
                if (lastStart !== null && now < lastStart) {
                    throw new ApnError("APN_RPC_CONFIG", "Permit2 RPC pacing clock moved backwards.");
                }
                const nextAllowed = Math.max(lastStart === null ? 0 : lastStart + RPC_GAP_MS, cooldownUntil ?? 0);
                while (now < nextAllowed) {
                    await pause(nextAllowed - now, signal);
                    now = Date.now();
                }
                if (signal.aborted)
                    aborted();
                // A crash releases the kernel lock without running finally. Reserve the whole read window before transport.
                await state.writeRpcProviderCooldown(endpointHash, Date.now() + RPC_CRASH_GUARD_MS);
                try {
                    if (signal.aborted)
                        aborted();
                    return await (transport ?? rpc).permit2ReadCall(method, params, signal);
                }
                finally {
                    const completed = Date.now();
                    await state.writeRpcProviderPacing(endpointHash, completed);
                    await state.writeRpcProviderCooldown(endpointHash, completed);
                }
            }, { waitMs: 1_900 });
        } };
}
async function abortable(promise, signal) {
    if (signal.aborted)
        aborted();
    let onAbort;
    const rejection = new Promise((_resolve, reject) => {
        onAbort = () => reject(new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted."));
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([promise, rejection]);
    }
    finally {
        signal.removeEventListener("abort", onAbort);
    }
}
async function pause(milliseconds, signal) {
    let timer;
    try {
        await abortable(new Promise(resolve => { timer = setTimeout(resolve, milliseconds); }), signal);
    }
    finally {
        clearTimeout(timer);
    }
}
function aborted() { throw new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted."); }
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Expected Permit2 selection is invalid."); }
//# sourceMappingURL=preflight.js.map