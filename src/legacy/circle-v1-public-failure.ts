import { isPlainRecord, exactKeys, hashObject } from "../canonical.js";
import { SecureStateStore } from "../secure-state-store.js";
import { circleBlocked, publicCircle, type CircleOperationV1 } from "../circle-v2-evm/operation-model.js";
function sanitizedCircleFailure(details: unknown): Record<string, string | number> {
  const metadata: Record<string, string | number> = {}; if (!isPlainRecord(details)) return metadata;
  if (typeof details.method === "string" && /^eth_[A-Za-z]{1,40}$/u.test(details.method)) metadata.method = details.method;
  if (typeof details.origin === "string" && details.origin.length <= 2048) { try { const u = new URL(details.origin); if (u.protocol === "https:" && u.origin === details.origin && u.username === "" && u.password === "") metadata.origin = details.origin; } catch {} }
  if (typeof details.status === "number" && Number.isSafeInteger(details.status) && details.status >= 100 && details.status <= 599) metadata.status = details.status;
  if (typeof details.stage === "string" && ["response", "protocol", "transport"].includes(details.stage)) metadata.stage = details.stage;
  return metadata;
}
/** Frozen reader of the first public classified failure the deleted v1 runtime recorded (never request bodies, RPC params,
 * key or material bytes). Nothing writes it any more. */
export class CirclePublicFailureStore extends SecureStateStore {
  private path(op: CircleOperationV1) { return `circle-public-failures/${op.operationId}.json`; }
  async read(op: CircleOperationV1): Promise<unknown | null> {
    const v = await this.readJson(this.path(op)); if (v === null) return null;
    if (!isPlainRecord(v) || !exactKeys(v, ["version", "operationId", "fingerprint", "role", "code", "metadata", "failureHash"]) || v.version !== "apn.circle-public-first-failure.v1" || v.operationId !== op.operationId || v.fingerprint !== op.fingerprint || !isPlainRecord(v.metadata) || Object.keys(v.metadata).some(k => !["method", "origin", "status", "stage"].includes(k))) circleBlocked("circle_public_failure_binding");
    const { failureHash, ...body } = v; if (typeof v.code !== "string" || !/^APN_[A-Z0-9_]{1,80}$/u.test(v.code) || !["approval", "burn", "cleanup", "mint"].includes(String(v.role)) || hashObject(v.metadata) !== hashObject(sanitizedCircleFailure(v.metadata)) || failureHash !== hashObject(body)) circleBlocked("circle_public_failure_binding"); return v;
  }
}
/** Status of a read-only v1 operation (`apn.circle-v2-evm-operation.v1`): the checked journal and its recorded failure. */
export async function circleV1Status(root: string, op: CircleOperationV1) {
  const failure = await new CirclePublicFailureStore(root).read(op);
  return { ...publicCircle(op), ...(failure === null ? {} : { first_public_effect_failure: failure }) };
}
