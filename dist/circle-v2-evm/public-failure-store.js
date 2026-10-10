import { ApnError } from "../errors.js";
import { isPlainRecord, exactKeys, hashObject } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked } from "./operation-model.js";
export function sanitizedCircleFailure(details) {
    const metadata = {};
    if (!isPlainRecord(details))
        return metadata;
    if (typeof details.method === "string" && /^eth_[A-Za-z]{1,40}$/u.test(details.method))
        metadata.method = details.method;
    if (typeof details.origin === "string" && details.origin.length <= 2048) {
        try {
            const u = new URL(details.origin);
            if (u.protocol === "https:" && u.origin === details.origin && u.username === "" && u.password === "")
                metadata.origin = details.origin;
        }
        catch { }
    }
    if (typeof details.status === "number" && Number.isSafeInteger(details.status) && details.status >= 100 && details.status <= 599)
        metadata.status = details.status;
    if (typeof details.stage === "string" && ["response", "protocol", "transport"].includes(details.stage))
        metadata.stage = details.stage;
    return metadata;
}
/** First public classified failure only: never request bodies, RPC params, key or material bytes. */
export class CirclePublicFailureStore extends SecureStateStore {
    path(op) { return `circle-public-failures/${op.operationId}.json`; }
    async read(op) {
        const v = await this.readJson(this.path(op));
        if (v === null)
            return null;
        if (!isPlainRecord(v) || !exactKeys(v, ["version", "operationId", "fingerprint", "role", "code", "metadata", "failureHash"]) || v.version !== "apn.circle-public-first-failure.v1" || v.operationId !== op.operationId || v.fingerprint !== op.fingerprint || !isPlainRecord(v.metadata) || Object.keys(v.metadata).some(k => !["method", "origin", "status", "stage"].includes(k)))
            circleBlocked("circle_public_failure_binding");
        const { failureHash, ...body } = v;
        if (typeof v.code !== "string" || !/^APN_[A-Z0-9_]{1,80}$/u.test(v.code) || !["approval", "burn", "cleanup", "mint"].includes(String(v.role)) || hashObject(v.metadata) !== hashObject(sanitizedCircleFailure(v.metadata)) || failureHash !== hashObject(body))
            circleBlocked("circle_public_failure_binding");
        return v;
    }
    async record(op, role, error) {
        if (!(error instanceof ApnError) || await this.read(op) !== null)
            return;
        const metadata = sanitizedCircleFailure(error.details);
        const body = { version: "apn.circle-public-first-failure.v1", operationId: op.operationId, fingerprint: op.fingerprint, role, code: error.code, metadata };
        await this.initialize();
        await this.ensureDirectory("circle-public-failures");
        await this.writeJson(this.path(op), { ...body, failureHash: hashObject(body) }, true);
    }
}
//# sourceMappingURL=public-failure-store.js.map