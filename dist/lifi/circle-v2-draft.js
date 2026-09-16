/** Composed Circle V2 inspection artifact. It has no submission or persistence path. */
import { createHash } from "node:crypto";
import { inspectCircleV2Preflight } from "./circle-v2-preflight.js";
import { inspectCircleV2UpfrontOffline } from "./circle-v2-upfront-offline.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_draft_${reason}`); }
function jsonCopy(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return value;
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value))
            fail("json_number");
        return value;
    }
    if (Array.isArray(value))
        return value.map(jsonCopy);
    if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
        fail("json_value");
    const result = {};
    for (const key of Object.keys(value).sort()) {
        if (key === "__proto__" || key === "constructor" || key === "prototype")
            fail("json_key");
        result[key] = jsonCopy(value[key]);
    }
    return result;
}
function canonical(value) { return JSON.stringify(jsonCopy(value)); }
/** The returned data is an unsubmitted inspection record; callers must re-preflight before any later submission. */
export async function inspectCircleV2PreflightedDraft(input, transport) {
    if (input.executable !== undefined ||
        input.executionAdmitted !== undefined)
        fail("executable_flag");
    const tx = bridgeRecord(input.transaction);
    if (tx.executable !== undefined || tx.executionAdmitted !== undefined)
        fail("executable_flag");
    const payer = bridgeAddress(input.payer);
    if (tx.from !== undefined && bridgeAddress(tx.from) !== payer)
        fail("payer_mismatch");
    const snapshot = jsonCopy(input);
    const preflight = await inspectCircleV2Preflight(snapshot, transport);
    const upfront = await inspectCircleV2UpfrontOffline({ ...snapshot, sourceBlockNumber: preflight.blockNumber });
    const frozenTx = bridgeRecord(snapshot.transaction);
    const blockers = [
        "The quote and validation response are synthetic or externally supplied; remote schema behavior is not established by this artifact",
        "Recipient ATA existence or setup execution is not observed",
        "Source submission, source receipt, Circle attestation, and destination mint are not observed",
        "The Base block and quote may expire; revalidate immediately before any separately authorized submission",
    ];
    const fields = {
        kind: "circle_v2_preflighted_draft", state: "preflighted_unsubmitted",
        executionAdmitted: false, sourceChainId: 8453, sourcePayer: payer,
        sourceTransaction: { to: bridgeAddress(frozenTx.to), data: bridgeHex(frozenTx.data), valueAtomic: "0",
            refundAddress: bridgeAddress(frozenTx.refundAddress) },
        quoteEndpoint: snapshot.quoteEndpoint, quoteRequest: snapshot.quoteRequest, quoteResponse: snapshot.quoteResponse,
        recipientWallet: snapshot.recipientWallet, recipientAta: upfront.recipientAta, recipientSetup: upfront.recipientSetup,
        amountAtomic: upfront.amountAtomic, quotedFeeAtomic: upfront.quotedFeeAtomic,
        maxSourceFeeAtomic: snapshot.maxSourceFeeAtomic,
        preflight: { blockNumber: preflight.blockNumber, blockHash: preflight.blockHash, abiSignature: preflight.abiSignature },
        blockers,
    };
    return { ...fields, integrityDigest: `sha256:${createHash("sha256").update(canonical(fields)).digest("hex")}` };
}
//# sourceMappingURL=circle-v2-draft.js.map