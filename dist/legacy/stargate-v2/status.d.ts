import { BridgeHttps } from "../../lifi/https.js";
import { LEGACY_CLOSURE_REASON, type LegacyStargateClosure } from "./closure.js";
import { type LegacyStargateFamily, type LegacyStargateRecord } from "./reader.js";
/** The three public reads the closure check makes, all on the record's own source chain. */
export interface LegacyChainRead {
    call(method: "eth_chainId" | "eth_getTransactionCount" | "eth_getTransactionByHash", params: readonly unknown[]): Promise<unknown>;
}
/** The RPC of each record's signing chain; nothing else is read. */
export declare const LEGACY_CLOSURE_RPC_ENV: Readonly<Record<LegacyStargateFamily, string>>;
export type LegacyClosureCheck = {
    readonly closed: true;
    readonly closure: LegacyStargateClosure;
} | {
    readonly closed: false;
    readonly waitingFor: string;
};
/**
 * R4 exit of a non-terminal unreleased-schema record (no signing, no money, no consent): it is closed only when, at the
 * finalized block of its signing chain, the signer's nonce is past every nonce the record froze (so none of its envelopes
 * can ever be included again) and none of its own transaction hashes is pending. Otherwise it stays open and says why.
 */
export declare function checkLegacyClosure(record: LegacyStargateRecord, rpc: LegacyChainRead, now: () => number): Promise<LegacyClosureCheck>;
/** A keyless public HTTPS JSON-RPC endpoint, one exact result envelope per call, through the shared bounded transport. */
export declare function legacyClosureRpc(url: string, https?: Pick<BridgeHttps, "request">): LegacyChainRead;
export interface LegacyStargateStatus {
    readonly schemaVersion: "apn.stargate-v2-legacy-status.v1";
    readonly operationId: string;
    readonly family: LegacyStargateFamily;
    readonly recordSchemaVersion: string;
    readonly phase: string;
    readonly readOnly: true;
    readonly terminal: boolean;
    readonly terminalReason: "phase" | typeof LEGACY_CLOSURE_REASON | null;
    readonly closure: LegacyStargateClosure | null;
    readonly waitingFor: string | null;
    readonly record: LegacyStargateRecord;
    readonly proofClass: string;
    readonly nextActions: readonly string[];
}
export interface LegacyStatusInput {
    readonly root: string;
    readonly family: LegacyStargateFamily;
    readonly operationId: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly now: () => number;
    readonly rpc?: (url: string) => LegacyChainRead;
}
/**
 * The family status of an unreleased-schema record: terminal by its phase or by its closure (no RPC), otherwise the
 * closure check, whose proof is written once beside the record. Null when the record is not of such a schema.
 */
export declare function legacyStargateStatus(input: LegacyStatusInput): Promise<LegacyStargateStatus | null>;
/** The family status after its live reader refused the schema: an unreleased-schema record answers here; anything else rethrows. */
export declare function legacyStargateStatusAfter(error: unknown, input: LegacyStatusInput): Promise<LegacyStargateStatus>;
