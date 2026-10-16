import { getAddress } from "viem";
import { isPlainRecord } from "../canonical.js";
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
        rpc: ports.rpc, now });
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
/**
 * Prepare-time Permit2 reads go through the shared direct-EVM transport: provider-family pacing across processes and a
 * per-command POST cap (EvmDirectRpcGuard), the same mechanism as the signing fence and the observer. One instance per
 * command keeps the DNS pin; each batch races the caller's abort signal.
 */
export function permit2PublicRpc(url, stateRoot, transport) {
    const rpc = new HttpsBaseRpc(url, { directGuardState: new StateStore(stateRoot) });
    if (transport === undefined)
        rpc.armEvmDirectRpcGuard();
    return { batch: async (calls, signal) => {
            if (signal.aborted)
                aborted();
            let onAbort;
            const rejection = new Promise((_resolve, reject) => {
                onAbort = () => reject(new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted."));
                signal.addEventListener("abort", onAbort, { once: true });
            });
            try {
                return await Promise.race([(transport ?? rpc).batchCall(calls), rejection]);
            }
            finally {
                signal.removeEventListener("abort", onAbort);
            }
        } };
}
function aborted() { throw new ApnError("APN_RPC_PROTOCOL", "Permit2 RPC read was aborted."); }
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Expected Permit2 selection is invalid."); }
//# sourceMappingURL=preflight.js.map