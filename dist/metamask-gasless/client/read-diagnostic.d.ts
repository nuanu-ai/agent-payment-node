import { ApnError } from "../../errors.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
export type ReadMode = "inspect" | "quote";
export type ReadStage = "launch" | "private_state" | "sdk_load" | "hydrate" | "inspect" | "inventory" | "chain_override" | "relay_support" | "fee_quote" | "quote_output" | "helper_response";
export type ReadNetwork = "none" | "mimir-networks" | "accounts-networks" | "sentinel-networks" | "rpc-decimals" | "rpc-balance" | "sentinel-quote";
export interface MetaMaskReadDiagnostic {
    readonly mode: ReadMode;
    readonly stage: ReadStage;
    readonly invariant: "closed_failure" | "unclassified_exception" | "network_validation" | "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid";
    readonly network: ReadNetwork;
    readonly httpStatus: number | null;
    readonly exitCode: number | null;
    readonly signal: "none" | "SIGINT" | "SIGTERM" | "SIGKILL" | "other";
    readonly timedOut: boolean;
}
/** Reject getters and proxies before reading an untrusted diagnostic or failure envelope. */
export declare function readDataRecord(value: unknown): Record<string, unknown>;
export declare function validateReadDiagnostic(value: unknown, mode: ReadMode): MetaMaskReadDiagnostic;
export declare function readDiagnostic(mode: ReadMode, stage: ReadStage, invariant: MetaMaskReadDiagnostic["invariant"], network?: ReadNetwork, httpStatus?: number | null, exitCode?: number | null, signal?: MetaMaskReadDiagnostic["signal"], timedOut?: boolean): MetaMaskReadDiagnostic;
export declare function readFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic): ApnError;
export declare function readRunnerFailure(mode: ReadMode, invariant: MetaMaskReadDiagnostic["invariant"], exitCode?: number | null, signal?: NodeJS.Signals | null): Error;
export declare function takeReadRunnerDiagnostic(error: unknown, mode: ReadMode): MetaMaskReadDiagnostic | undefined;
