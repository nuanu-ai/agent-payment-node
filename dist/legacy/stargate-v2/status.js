import { canonicalJson, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { BridgeHttps } from "../../lifi/https.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { parseRpcResultEnvelope } from "../../rpc-envelope.js";
import { LEGACY_CLOSURE_REASON, legacyClosureFacts, legacyPhaseTerminal, LegacyStargateClosureStore, sealLegacyClosure } from "./closure.js";
import { loadLegacyStargateRecord } from "./reader.js";
/** The RPC of each record's signing chain; nothing else is read. */
export const LEGACY_CLOSURE_RPC_ENV = Object.freeze({
    stargate_native: "APN_ETHEREUM_RPC_URL", stargate_token: "APN_OPTIMISM_RPC_URL"
});
function quantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed RPC quantity.");
    return BigInt(value);
}
/**
 * R4 exit of a non-terminal unreleased-schema record (no signing, no money, no consent): it is closed only when, at the
 * finalized block of its signing chain, the signer's nonce is past every nonce the record froze (so none of its envelopes
 * can ever be included again) and none of its own transaction hashes is pending. Otherwise it stays open and says why.
 */
export async function checkLegacyClosure(record, rpc, now) {
    const facts = legacyClosureFacts(record);
    if (quantity(await rpc.call("eth_chainId", [])) !== BigInt(facts.chainId)) {
        throw new ApnError("APN_CHAIN_MISMATCH", "The closure RPC does not serve the record's signing chain.", { chainId: String(facts.chainId) });
    }
    const finalized = quantity(await rpc.call("eth_getTransactionCount", [facts.account, "finalized"]));
    if (finalized <= facts.highestNonce) {
        return { closed: false, waitingFor: `the finalized nonce of ${facts.account} on chain ${facts.chainId} to pass ${facts.highestNonce} (it is ${finalized})` };
    }
    const ownTransactions = [];
    for (const transactionHash of facts.ownHashes) {
        const found = await rpc.call("eth_getTransactionByHash", [transactionHash]);
        if (found === null) {
            ownTransactions.push({ transactionHash, seen: "not_found" });
            continue;
        }
        if (!isPlainRecord(found) || typeof found.hash !== "string" || found.hash.toLowerCase() !== transactionHash.toLowerCase()) {
            throw new ApnError("APN_RPC_PROTOCOL", "The RPC answered another transaction than the one asked for.");
        }
        if (found.blockNumber === null || found.blockNumber === undefined)
            return { closed: false, waitingFor: `own transaction ${transactionHash} to leave the pending pool` };
        quantity(found.blockNumber);
        ownTransactions.push({ transactionHash, seen: "included" });
    }
    return { closed: true, closure: sealLegacyClosure({ schemaVersion: "apn.stargate-v2-legacy-closure.v1", family: facts.family,
            operationId: record.operationId, recordSchemaVersion: record.schemaVersion, recordIntegrityHash: record.integrityHash, recordPhase: record.phase,
            reason: LEGACY_CLOSURE_REASON, chainId: facts.chainId, account: facts.account, blockTag: "finalized",
            highestEnvelopeNonceAtomic: facts.highestNonce.toString(), finalizedNonceAtomic: finalized.toString(), ownTransactions,
            closedAt: new Date(now()).toISOString() }) };
}
/** A keyless public HTTPS JSON-RPC endpoint, one exact result envelope per call, through the shared bounded transport. */
export function legacyClosureRpc(url, https = new BridgeHttps()) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Stargate legacy closure RPC endpoint", 2048);
    if (parsed.search !== "")
        throw new ApnError("APN_RPC_CONFIG", "Stargate legacy closure RPC endpoint must not carry a query.");
    const endpoint = parsed.toString();
    let sequence = 0;
    return {
        async call(method, params) {
            const id = String(++sequence);
            const response = await https.request(endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG");
            if (response.status !== 200)
                throw new ApnError("APN_RPC_PROTOCOL", "Stargate legacy closure RPC answered a non-200 status.", { status: response.status });
            return parseRpcResultEnvelope(response.body, id, method);
        },
    };
}
/**
 * The family status of an unreleased-schema record: terminal by its phase or by its closure (no RPC), otherwise the
 * closure check, whose proof is written once beside the record. Null when the record is not of such a schema.
 */
export async function legacyStargateStatus(input) {
    const record = await loadLegacyStargateRecord(input.root, input.family, input.operationId);
    if (record === null)
        return null;
    const view = (terminalReason, closure, waitingFor, proofClass) => ({ schemaVersion: "apn.stargate-v2-legacy-status.v1", operationId: record.operationId,
        family: input.family, recordSchemaVersion: record.schemaVersion, phase: record.phase, readOnly: true, terminal: terminalReason !== null,
        terminalReason, closure, waitingFor, record, proofClass,
        nextActions: terminalReason === null ? [`apn operation status --operation ${record.operationId}`] : [] });
    if (legacyPhaseTerminal(record))
        return view("phase", null, null, "durable_public_state");
    const store = new LegacyStargateClosureStore(input.root), existing = await store.load(record);
    if (existing !== null)
        return view(LEGACY_CLOSURE_REASON, existing, null, "durable_public_state");
    const variable = LEGACY_CLOSURE_RPC_ENV[input.family], url = input.environment[variable];
    if (url === undefined || url === "") {
        throw new ApnError("APN_RPC_CONFIG", `Closing this unreleased Stargate record reads its signing chain: set ${variable}.`, { reason: "legacy_closure_rpc_required" });
    }
    const check = await checkLegacyClosure(record, (input.rpc ?? legacyClosureRpc)(url), input.now);
    if (!check.closed)
        return view(null, null, check.waitingFor, "chain_verified_public_read");
    return view(LEGACY_CLOSURE_REASON, await store.create(record, check.closure), null, "chain_verified_public_read");
}
/** The family status after its live reader refused the schema: an unreleased-schema record answers here; anything else rethrows. */
export async function legacyStargateStatusAfter(error, input) {
    if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT" && error.details?.reason === "schema") {
        const status = await legacyStargateStatus(input);
        if (status !== null)
            return status;
    }
    throw error;
}
//# sourceMappingURL=status.js.map