import { gunzipSync } from "node:zlib";
import { ApnError } from "../errors.js";
const MAX_RPC_BYTES = 2_097_152;
/** Compression changes transport bytes only; both wire and decoded bodies remain bounded. */
export function decodeSolanaRpcBody(body, contentEncoding) {
    if (body.byteLength > MAX_RPC_BYTES)
        invalid();
    if (contentEncoding === undefined || contentEncoding === "identity")
        return Buffer.from(body);
    if (contentEncoding !== "gzip")
        invalid();
    try {
        return gunzipSync(body, { maxOutputLength: MAX_RPC_BYTES });
    }
    catch {
        return invalid();
    }
}
/** Preserve a bounded provider cooldown response for the RPC layer and durable pacer. */
export function solanaRpcHttpResponse(body, metadata) {
    const { statusCode, contentType, contentEncoding, retryAfter } = metadata;
    if ((statusCode !== 200 && statusCode !== 429) || !contentType.includes("application/json"))
        invalid();
    const decoded = decodeSolanaRpcBody(body, contentEncoding);
    return new Response(new Uint8Array(decoded), { status: statusCode, headers: {
            "content-type": contentType,
            ...(statusCode === 429 && retryAfter !== undefined ? { "retry-after": retryAfter } : {}),
        } });
}
function invalid() {
    throw new ApnError("APN_RPC_PROTOCOL", "The Solana RPC body encoding or size is invalid.");
}
//# sourceMappingURL=https-body.js.map