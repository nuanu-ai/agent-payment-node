import { SecureStateStore } from "../secure-state-store.js";
import type { X402PaymentRequired } from "../x402-codec.js";
import { type Permit2OwnerAdmission, type Permit2PrepareEvidence, type Permit2PreparedMaterial } from "./prepare.js";
declare const SCHEMA = "apn.x402-permit2.execution-intent.v1";
declare const ENDPOINT = "https://facilitator.payai.network";
/** A local, unsigned admission. There is deliberately no signature, submission or paid state. */
export interface Permit2ExecutionIntent {
    readonly schemaVersion: typeof SCHEMA;
    readonly operationId: string;
    readonly idempotencyHash: string;
    readonly profileHash: string;
    readonly requestHash: string;
    readonly prepareHash: string;
    readonly challengeHash: string;
    readonly merchantOrigin: string;
    readonly resourceUrl: string;
    readonly facilitatorEndpoint: typeof ENDPOINT;
    readonly chain: "eip155:43114";
    readonly token: string;
    readonly owner: string;
    readonly recipient: string;
    readonly amountAtomic: string;
    readonly permit2Contract: string;
    readonly exactProxy: string;
    readonly typedDataDigest: string;
    readonly eip2612Digest: string | null;
    readonly nonce: string;
    readonly deadline: string;
    readonly policyDigest: string;
    readonly reservationId: string;
    readonly reservationState: "intended";
    readonly capability: "execution_blocked";
    readonly createdAtUnix: number;
    readonly integrityHash: string;
}
/** The port must load the local wallet and active policy for the requested profile from authenticated state.
 * Caller-supplied profile/account labels are insufficient. The port has no effect methods. */
export interface Permit2IntentReadPort {
    read(input: {
        readonly profile: string;
        readonly payer: string;
        readonly nonceBitmapWordIndex: string;
        readonly amountAtomic: string;
        readonly nowSeconds: number;
    }): Promise<{
        readonly owner: Permit2OwnerAdmission;
        readonly evidence: Permit2PrepareEvidence;
        readonly gasBalanceAtomic: string;
        readonly binding: {
            readonly walletProfile: string;
            readonly walletAccount: string;
            readonly policyProfile: string;
            readonly policyDigest: string;
        };
        readonly facilitatorEndpoint: string;
    }>;
}
export interface Permit2IntentInput {
    readonly profile: string;
    readonly idempotencyKey: string;
    readonly prepared: Permit2PreparedMaterial;
    readonly challenge: X402PaymentRequired;
    readonly merchantOrigin: string;
    readonly resourceUrl: string;
    readonly facilitatorEndpoint: string;
    readonly minimumGasAtomic: string;
    readonly nowSeconds: number;
}
/** Internal-only journal. It owns one durable, immutable file per profile/idempotency key. */
export declare class Permit2ExecutionIntentJournal extends SecureStateStore {
    private ready;
    protected syncIntentDirectoryParent(): Promise<void>;
    private path;
    create(input: Permit2IntentInput, port: Permit2IntentReadPort): Promise<Permit2ExecutionIntent>;
    load(operationId: string): Promise<Permit2ExecutionIntent | null>;
}
export {};
