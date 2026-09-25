import { SecureStateStore } from "../secure-state-store.js";
import type { Permit2PreparedMaterial } from "./prepare.js";
declare const SCHEMA = "apn.x402-permit2.exposure-lifecycle.v1";
declare const STATES: readonly ["reserving", "reserved", "exposure_unknown", "submitted_pending", "settled"];
type State = typeof STATES[number];
/** No production adapter is supplied or connected to a CLI, MCP, wallet or HTTP sender. */
export interface Permit2EffectPorts {
    /** Atomic, idempotent owner-policy usage reservation under this exact reservationId. */
    reserve(input: Permit2EffectBinding): Promise<Permit2EffectBinding>;
    /** Returns opaque authorization bytes only to the immediately following submit call. */
    sign(input: Permit2EffectBinding, prepared: Permit2PreparedMaterial): Promise<unknown>;
    submit(input: Permit2EffectBinding, authorization: unknown): Promise<{
        readonly reference: string;
    }>;
    /** Read-only observation. Null, timeout, 429 and not-found remain unknown. */
    observe(input: Permit2EffectBinding, reference: string | null): Promise<{
        readonly kind: "pending";
    } | {
        readonly kind: "settled";
        readonly proofDigest: string;
    } | null>;
}
export interface Permit2EffectBinding {
    readonly operationId: string;
    readonly reservationId: string;
    readonly profileHash: string;
    readonly policyDigest: string;
    readonly prepareHash: string;
    readonly challengeHash: string;
    readonly typedDataDigest: string;
    readonly eip2612Digest: string | null;
    readonly chain: "eip155:43114";
    readonly token: string;
    readonly owner: string;
    readonly amountAtomic: string;
    readonly nonce: string;
    readonly deadline: string;
}
export interface Permit2ExposureRecord extends Permit2EffectBinding {
    readonly schemaVersion: typeof SCHEMA;
    readonly state: State;
    readonly reference: string | null;
    readonly proofDigest: string | null;
    readonly integrityHash: string;
}
/** Durable single-attempt boundary. A persisted exposure marker forbids a second sign or send. */
export declare class Permit2ExposureLifecycle extends SecureStateStore {
    private readonly intents;
    constructor(root: string);
    private ready;
    private path;
    private lock;
    load(operationId: string): Promise<Permit2ExposureRecord | null>;
    /**
     * The caller supplies an explicitly scoped port set. It is intentionally not in production wiring.
     * The effect lock covers the whole attempt, including the external call. After any ambiguity,
     * resume only observes the same binding and never obtains another authorization.
     */
    resume(operationId: string, prepared: Permit2PreparedMaterial, ports: Permit2EffectPorts, nowSeconds: number): Promise<Permit2ExposureRecord>;
    /** Read-only reconciliation; observation errors leave the exposure marker and reservation intact. */
    reconcile(operationId: string, ports: Pick<Permit2EffectPorts, "observe">): Promise<Permit2ExposureRecord>;
}
export {};
