/** One keyless provider assertion for a saved Relay quote. This never proves an onchain effect. */
import { ApnError } from "../errors.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository } from "../relay-unsigned-operation.js";
import { StateStore } from "../state.js";
import { relayStatusLocator } from "./quote.js";
const MAX_RESPONSE_BYTES = 65_536;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/u;
const STATUSES = new Set(["waiting", "depositing", "pending", "submitted", "success", "delayed", "refund", "failure"]);
const REASON = /^[A-Z][A-Z0-9_\/]{0,79}$/u;
function invalid() {
    throw new ApnError("APN_PROVIDER_PROTOCOL", "Relay status response is invalid.");
}
function hashes(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value) || value.length > 32 || !value.every(item => typeof item === "string" && TX_HASH.test(item)))
        invalid();
    return value.map((item) => item.toLowerCase());
}
function reason(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value !== "string" || !REASON.test(value))
        invalid();
    return value;
}
async function boundedJson(response) {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES))
        invalid();
    if (response.body === null)
        invalid();
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES)
                invalid();
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    }
    catch {
        return invalid();
    }
}
export class RelayKeylessStatusService {
    state;
    fetcher;
    constructor(state, fetcher = fetch) {
        this.state = state;
        this.fetcher = fetcher;
    }
    async status(operationId) {
        if (!/^[a-f0-9]{64}$/u.test(operationId))
            throw new ApnError("APN_INVALID_INPUT", "Relay status requires an operation ID.");
        const operation = await new RelayUnsignedOperationRepository(this.state.root).findOperation(operationId);
        if (operation === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Relay operation was not found.");
        // A validated retirement marker is authoritative even though the prepared quote remains intact.
        // A malformed marker throws from the repository before any provider request.
        if (await new RelayRetirementRepository(this.state.root).load(operation) !== null) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation is retired.", { reason: "relay_operation_retired" });
        }
        const locator = operation.statusLocator;
        if (locator === undefined)
            throw new ApnError("APN_OPERATION_BLOCKED", "Relay operation has no status locator.", { reason: "relay_status_locator_missing" });
        let canonical;
        try {
            canonical = relayStatusLocator(locator.requestId, locator.endpoint);
        }
        catch {
            throw new ApnError("APN_STATE_CORRUPT", "Relay status locator is invalid.");
        }
        if (canonical.endpoint !== locator.endpoint || canonical.requestId !== locator.requestId) {
            throw new ApnError("APN_STATE_CORRUPT", "Relay status locator is invalid.");
        }
        let response;
        try {
            response = await this.fetcher(canonical.endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(12_000) });
        }
        catch {
            throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Relay status request failed.");
        }
        if (response.redirected || !response.ok || response.status !== 200)
            invalid();
        const payload = await boundedJson(response);
        if (payload === null || typeof payload !== "object" || Array.isArray(payload))
            invalid();
        const row = payload;
        if (typeof row.status !== "string" || !STATUSES.has(row.status) ||
            row.originChainId !== operation.sourceChainId || row.destinationChainId !== operation.destinationChainId)
            invalid();
        const inTxHashes = hashes(row.inTxHashes);
        const txHashes = hashes(row.txHashes);
        const failReason = reason(row.failReason);
        const refundFailReason = reason(row.refundFailReason);
        return { kind: "relay_provider_status", operationId, provider: "relay",
            sourceChainId: operation.sourceChainId, destinationChainId: operation.destinationChainId,
            status: row.status, inTxHashes, txHashes, failReason, refundFailReason,
            reason: row.status === "failure" ? failReason ?? "relay_reported_failure" :
                row.status === "refund" ? refundFailReason ?? "relay_reported_refund" : `relay_reported_${row.status}`,
            proofClass: "provider_assertion", independentOnchainProof: false,
            paidAcceptance: false, executionAdmitted: false, nextActions: [] };
    }
}
//# sourceMappingURL=status.js.map