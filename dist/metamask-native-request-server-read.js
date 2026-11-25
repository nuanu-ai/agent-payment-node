import { ApnError } from "./errors.js";
import { MetaMaskGaslessProviderClient } from "./metamask-gasless/client/process.js";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REASON = /^[a-z][a-z0-9_]{0,63}$/u, CHECK = /^[a-z][a-z0-9_]{0,31}$/u;
/**
 * The read runs in the sandboxed MetaMask helper the gasless lane uses (its network policy admits this one GET only),
 * from mm's own signed-in session, and only when that session's project hashes to `projectHash`: another project
 * refuses with `metamask_session_project_changed` before anything is read. A stored id that is not a canonical v4 UUID
 * (the form mm's requests have) refuses with `provider_request_binding_invalid`, so no other path can be read.
 */
export async function readMetaMaskNativeServerRequest(requestId, projectHash, binding, client = new MetaMaskGaslessProviderClient()) {
    if (!UUID.test(requestId) || !/^[a-f0-9]{64}$/u.test(projectHash) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.sender) ||
        !Number.isSafeInteger(binding.chainId) || binding.chainId < 1)
        return { outcome: "refused", reason: "provider_request_binding_invalid", check: null };
    let read;
    try {
        read = await client.readServerRequest({ requestId, projectHash, sender: binding.sender.toLowerCase(), chainId: binding.chainId });
    }
    catch (error) {
        const details = error instanceof ApnError ? error.details : undefined, named = details?.reason, refused = details?.observeCheck;
        const reason = typeof named === "string" && REASON.test(named) ? named : "metamask_server_read_unclassified";
        const check = typeof refused === "string" && CHECK.test(refused) ? refused : null;
        return { outcome: "refused", reason: reason === "mm_gasless_binding_changed" ? "metamask_session_project_changed" : reason, check };
    }
    if (read.requestId !== requestId)
        return { outcome: "refused", reason: "provider_request_identity_conflict", check: null };
    return read.found ? { outcome: "verified", status: read.status, transactionHash: read.txHash, mfa: read.mfa, failure: read.failure,
        responseHash: read.responseHash }
        : { outcome: "not_found" };
}
//# sourceMappingURL=metamask-native-request-server-read.js.map