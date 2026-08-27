import { closeSync, createReadStream, writeSync } from "node:fs";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { MAX_IPC_FRAME_BYTES, NATIVE_IPC_VERSION, NATIVE_REQUEST_FD_ENV, NATIVE_RESPONSE_FD_ENV, } from "./constants.js";
import { ApnError } from "./errors.js";
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CODE = /^[A-Z0-9_]{3,64}$/;
export function encodeFrame(value) {
    const payload = Buffer.from(JSON.stringify(value), "utf8");
    if (payload.length === 0 || payload.length > MAX_IPC_FRAME_BYTES) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame exceeds the size limit.");
    }
    const frame = Buffer.allocUnsafe(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
}
export function decodeSingleFrame(frame) {
    if (frame.length < 4)
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame is truncated.");
    const length = frame.readUInt32BE(0);
    if (length === 0 || length > MAX_IPC_FRAME_BYTES) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame length is invalid.");
    }
    if (frame.length !== length + 4) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC must contain exactly one frame.");
    }
    try {
        return JSON.parse(frame.subarray(4).toString("utf8"));
    }
    catch {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response is not valid JSON.");
    }
}
export class InheritedNativeIpc {
    requestFd;
    responseFd;
    timeoutMs;
    used = false;
    constructor(requestFd, responseFd, timeoutMs = 15 * 60 * 1000) {
        if (!Number.isSafeInteger(requestFd) || requestFd < 3 || !Number.isSafeInteger(responseFd) || responseFd < 3) {
            throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "A valid inherited native channel is required.");
        }
        if (requestFd === responseFd) {
            throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "Native request and response channels must be distinct.");
        }
        this.requestFd = requestFd;
        this.responseFd = responseFd;
        this.timeoutMs = timeoutMs;
    }
    static fromEnvironment(environment = process.env) {
        const requestFd = parseInheritedFd(environment[NATIVE_REQUEST_FD_ENV]);
        const responseFd = parseInheritedFd(environment[NATIVE_RESPONSE_FD_ENV]);
        return new InheritedNativeIpc(requestFd, responseFd);
    }
    async request(request) {
        if (this.used)
            throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC permits one request per child session.");
        this.used = true;
        validateRequest(request);
        const requestFrame = encodeFrame(request);
        let offset = 0;
        try {
            try {
                while (offset < requestFrame.length)
                    offset += writeSync(this.requestFd, requestFrame, offset);
            }
            catch {
                throw nativeTransportError("Native IPC request transport failed.");
            }
        }
        finally {
            closeSync(this.requestFd);
        }
        const response = validateResponse(await readFrame(this.responseFd, this.timeoutMs), request.requestId);
        if (!response.ok) {
            throw new ApnError("APN_NATIVE_REJECTED", "The native host rejected the bounded request.", {
                nativeCode: response.error.code,
            });
        }
        return response.result;
    }
}
function parseInheritedFd(value) {
    if (value === undefined || !/^[0-9]+$/.test(value)) {
        throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "The signed native host must provide inherited IPC channels.");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 3) {
        throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "The signed native host provided an invalid IPC channel.");
    }
    return parsed;
}
function validateRequest(request) {
    if (request.version !== NATIVE_IPC_VERSION ||
        !REQUEST_ID.test(request.requestId) ||
        ![
            "wallet.describe",
            "wallet.ensure",
            "directTransfer.approveAndSign",
            "effectMaterial.get",
            "x402Exact.approveAndAuthorize",
            "x402Exact.authorizationMaterial.get",
        ].includes(request.operation) ||
        !isPlainRecord(request.payload))
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC request violates the bounded schema.");
}
function validateResponse(value, requestId) {
    if (!isPlainRecord(value) || value.version !== NATIVE_IPC_VERSION || value.requestId !== requestId) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response identity is invalid.");
    }
    if (value.ok === true && exactKeys(value, ["version", "requestId", "ok", "result"])) {
        return value;
    }
    if (value.ok === false &&
        exactKeys(value, ["version", "requestId", "ok", "error"]) &&
        isPlainRecord(value.error) &&
        exactKeys(value.error, ["code", "message"]) &&
        typeof value.error.code === "string" &&
        ERROR_CODE.test(value.error.code) &&
        typeof value.error.message === "string" &&
        value.error.message.length <= 256)
        return value;
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response violates the bounded schema.");
}
async function readFrame(fd, timeoutMs) {
    return await readFrameStream(createReadStream("", { fd, autoClose: true }), timeoutMs);
}
export async function readFrameStream(stream, timeoutMs = 15_000) {
    return await new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let expected = null;
        let settled = false;
        const timeout = setTimeout(() => finish(nativeTransportError("Native IPC response timed out.")), timeoutMs);
        function finish(error, value) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            if (error !== undefined)
                stream.destroy();
            if (error !== undefined)
                reject(error);
            else
                resolve(value);
        }
        stream.on("data", (chunk) => {
            const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
            chunks.push(bytes);
            total += bytes.length;
            if (total > MAX_IPC_FRAME_BYTES + 4) {
                finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response exceeds the size limit."));
                return;
            }
            const combined = Buffer.concat(chunks, total);
            if (expected === null && combined.length >= 4) {
                const length = combined.readUInt32BE(0);
                if (length === 0 || length > MAX_IPC_FRAME_BYTES) {
                    finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame length is invalid."));
                    return;
                }
                expected = length + 4;
            }
            if (expected !== null && total > expected) {
                finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response contains trailing data or a second frame."));
            }
        });
        stream.on("error", () => finish(nativeTransportError("Native IPC response transport failed.")));
        stream.on("end", () => {
            if (expected === null || total !== expected) {
                finish(nativeTransportError("Native IPC response ended before one complete frame."));
                return;
            }
            try {
                finish(undefined, decodeSingleFrame(Buffer.concat(chunks, total)));
            }
            catch (error) {
                finish(error instanceof Error ? error : new Error("Native IPC decode failure."));
            }
        });
    });
}
function nativeTransportError(message) {
    return new ApnError("APN_NATIVE_PROTOCOL", message, { nativeTransport: true });
}
//# sourceMappingURL=native-ipc.js.map