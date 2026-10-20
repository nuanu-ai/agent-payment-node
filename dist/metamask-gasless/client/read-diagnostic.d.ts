import { ApnError } from "../../errors.js";
import { type MetaMaskGaslessFailureReason } from "../reasons.js";
export type ReadMode = "inspect" | "quote";
export type ReadStage = "launch" | "private_state" | "sdk_load" | "hydrate" | "inspect" | "inventory" | "chain_override" | "relay_support" | "fee_quote" | "quote_output" | "helper_response";
export type ReadNetwork = "none" | "mimir-networks" | "accounts-networks" | "sentinel-networks" | "rpc-decimals" | "rpc-balance" | "sentinel-quote";
export declare const readValidationPredicates: readonly ["response_json", "response_root", "sentinel_mode", "sentinel_keys", "sentinel_jsonrpc", "sentinel_id", "sentinel_result", "sentinel_transactions", "sentinel_transactions_length", "sentinel_last_transaction", "sentinel_fees", "sentinel_fees_length", "sentinel_low_tier", "sentinel_token_fees", "sentinel_token_fees_length", "sentinel_entry", "sentinel_token", "sentinel_token_address", "sentinel_token_match", "sentinel_entry_error", "sentinel_symbol", "sentinel_decimals", "sentinel_fee_quantity", "sentinel_fee_recipient"];
export type ReadValidationPredicate = typeof readValidationPredicates[number];
export type TokenFeesKind = "missing" | "null" | "object" | "string" | "number" | "boolean";
/**
 * Closed facts of the same Sentinel answer that carried no token-fee list (never provider text): the simulated
 * transfer's status, whether its low fee tier carried an error, and the sponsorship flag.
 */
export interface SentinelFeeFacts {
    readonly sentinelSimulation: "succeeded" | "reverted" | "absent" | "other";
    readonly sentinelFeeError: "present" | "absent" | "other";
    readonly sentinelSponsorship: "sponsored" | "not_sponsored" | "absent" | "other";
}
/** Closed facts of the two provider inventories the SDK's relay-support answer is derived from, for the quoted chain. */
export interface RelaySupportFacts {
    /** `GET agentic-mimir-service /v1/supportedNetworks`: whether the server wallet lists the chain. */
    readonly relayServerWalletNetwork: "listed" | "unlisted";
    /** `GET tx-sentinel-ethereum-mainnet/networks`: the chain row's `relayTransactions` flag. */
    readonly relaySentinelFlag: "enabled" | "disabled" | "absent";
}
export type ReadFacts = Partial<SentinelFeeFacts & RelaySupportFacts>;
export interface MetaMaskReadDiagnostic extends ReadFacts {
    readonly tokenFeesKind?: TokenFeesKind;
    readonly validationPredicate?: ReadValidationPredicate;
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
export declare function readDiagnostic(mode: ReadMode, stage: ReadStage, invariant: MetaMaskReadDiagnostic["invariant"], network?: ReadNetwork, httpStatus?: number | null, exitCode?: number | null, signal?: MetaMaskReadDiagnostic["signal"], timedOut?: boolean, validationPredicate?: ReadValidationPredicate, shape?: TokenFeesKind, facts?: ReadFacts): MetaMaskReadDiagnostic;
export declare function readFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic): ApnError;
export declare function readRunnerFailure(mode: ReadMode, invariant: MetaMaskReadDiagnostic["invariant"], exitCode?: number | null, signal?: NodeJS.Signals | null): Error;
export declare function takeReadRunnerDiagnostic(error: unknown, mode: ReadMode): MetaMaskReadDiagnostic | undefined;
