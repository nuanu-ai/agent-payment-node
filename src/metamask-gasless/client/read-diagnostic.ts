import { types } from "node:util";
import { ApnError } from "../../errors.js";
import { mmError, mmFail, type MetaMaskGaslessFailureReason } from "../reasons.js";

export type ReadMode = "inspect" | "quote";
export type ReadStage = "launch" | "private_state" | "sdk_load" | "hydrate" | "inspect" | "inventory" |
  "chain_override" | "relay_support" | "fee_quote" | "quote_output" | "helper_response";
export type ReadNetwork = "none" | "mimir-networks" | "accounts-networks" | "sentinel-networks" |
  "rpc-decimals" | "rpc-balance" | "sentinel-quote";
export const readValidationPredicates = ["response_json", "response_root", "sentinel_mode", "sentinel_keys", "sentinel_jsonrpc", "sentinel_id", "sentinel_result", "sentinel_transactions", "sentinel_transactions_length", "sentinel_last_transaction", "sentinel_fees", "sentinel_fees_length", "sentinel_low_tier", "sentinel_token_fees", "sentinel_token_fees_length", "sentinel_entry", "sentinel_token", "sentinel_token_address", "sentinel_token_match", "sentinel_entry_error", "sentinel_symbol", "sentinel_decimals", "sentinel_fee_quantity", "sentinel_fee_recipient"] as const;
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
const FACT_VALUES: Readonly<Record<keyof ReadFacts, readonly string[]>> = {
  sentinelSimulation: ["succeeded", "reverted", "absent", "other"], sentinelFeeError: ["present", "absent", "other"],
  sentinelSponsorship: ["sponsored", "not_sponsored", "absent", "other"],
  relayServerWalletNetwork: ["listed", "unlisted"], relaySentinelFlag: ["enabled", "disabled", "absent"],
};
const FEE_FACTS = ["sentinelSimulation", "sentinelFeeError", "sentinelSponsorship"] as const;
const RELAY_FACTS = ["relayServerWalletNetwork", "relaySentinelFlag"] as const;

export interface MetaMaskReadDiagnostic extends ReadFacts {
  readonly tokenFeesKind?: TokenFeesKind;
  readonly validationPredicate?: ReadValidationPredicate;
  readonly mode: ReadMode;
  readonly stage: ReadStage;
  readonly invariant: "closed_failure" | "unclassified_exception" | "network_validation" |
    "runner_launch" | "runner_exit" | "runner_timeout" | "runner_output" | "response_invalid";
  readonly network: ReadNetwork;
  readonly httpStatus: number | null;
  readonly exitCode: number | null;
  readonly signal: "none" | "SIGINT" | "SIGTERM" | "SIGKILL" | "other";
  readonly timedOut: boolean;
}
const keys = ["mode", "stage", "invariant", "network", "httpStatus", "exitCode", "signal", "timedOut"] as const;
const stages: readonly string[] = ["launch", "private_state", "sdk_load", "hydrate", "inspect", "inventory",
  "chain_override", "relay_support", "fee_quote", "quote_output", "helper_response"];
const invariants: readonly string[] = ["closed_failure", "unclassified_exception", "network_validation",
  "runner_launch", "runner_exit", "runner_timeout", "runner_output", "response_invalid"];
const networks: readonly string[] = ["none", "mimir-networks", "accounts-networks", "sentinel-networks",
  "rpc-decimals", "rpc-balance", "sentinel-quote"];
/** Reject getters and proxies before reading an untrusted diagnostic or failure envelope. */
export function readDataRecord(value: unknown): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || types.isProxy(value)) throw new Error();
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new Error();
    const result: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error();
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
    return result;
  } catch { return mmFail("mm_gasless_provider_unavailable"); }
}
export function validateReadDiagnostic(value: unknown, mode: ReadMode): MetaMaskReadDiagnostic {
  const d = readDataRecord(value);
  const bounded = (v: unknown, low: number, high: number) => v === null ||
    typeof v === "number" && Number.isSafeInteger(v) && v >= low && v <= high;
  const hasShape = Object.hasOwn(d, "tokenFeesKind");
  const feeFacts = FEE_FACTS.filter(key => Object.hasOwn(d, key)), relayFacts = RELAY_FACTS.filter(key => Object.hasOwn(d, key));
  if (Object.keys(d).length !== keys.length + (Object.hasOwn(d, "validationPredicate") ? 1 : 0) + (hasShape ? 1 : 0) +
    feeFacts.length + relayFacts.length || keys.some(key => !Object.hasOwn(d, key)) || d.mode !== mode ||
    typeof d.stage !== "string" || !stages.includes(d.stage) || typeof d.invariant !== "string" || !invariants.includes(d.invariant) ||
    typeof d.network !== "string" || !networks.includes(d.network) ||
    !bounded(d.httpStatus, 100, 599) || !bounded(d.exitCode, 0, 255) ||
    typeof d.signal !== "string" || !["none", "SIGINT", "SIGTERM", "SIGKILL", "other"].includes(d.signal) || typeof d.timedOut !== "boolean" ||
    mode === "inspect" && (d.network !== "none" || d.httpStatus !== null) ||
    d.network === "none" && d.httpStatus !== null ||
    mode === "inspect" && !["launch", "private_state", "hydrate", "inspect", "helper_response"].includes(String(d.stage)) ||
    d.stage === "launch" && (!["runner_launch", "runner_exit", "runner_timeout", "runner_output"].includes(String(d.invariant)) || d.network !== "none" ||
      d.timedOut !== (d.invariant === "runner_timeout") || d.invariant !== "runner_exit" && (d.exitCode !== null || d.signal !== "none")) ||
    d.stage !== "launch" && (d.exitCode !== null || d.signal !== "none" || d.timedOut !== false) ||
    d.stage === "helper_response" && d.invariant !== "response_invalid") mmFail("mm_gasless_provider_unavailable");
  if (Object.hasOwn(d, "validationPredicate") && (typeof d.validationPredicate !== "string" ||
    !readValidationPredicates.includes(d.validationPredicate as ReadValidationPredicate) || mode !== "quote" ||
    d.invariant !== "network_validation" || d.network !== "sentinel-quote" || d.httpStatus === null ||
    (d.httpStatus as number) < 200 || (d.httpStatus as number) >= 300)) mmFail("mm_gasless_provider_unavailable");
  if (hasShape && (typeof d.tokenFeesKind !== "string" ||
    !["missing", "null", "object", "string", "number", "boolean"].includes(d.tokenFeesKind) ||
    d.validationPredicate !== "sentinel_token_fees" || d.stage !== "fee_quote")) mmFail("mm_gasless_provider_unavailable");
  // Fee facts come only with a classified missing token-fee list; relay facts only with the closed relay refusal.
  if (feeFacts.length !== 0 && (feeFacts.length !== FEE_FACTS.length || !hasShape) ||
    relayFacts.length !== 0 && (relayFacts.length !== RELAY_FACTS.length || mode !== "quote" || d.stage !== "relay_support" ||
      d.invariant !== "closed_failure" || d.network !== "none") ||
    [...feeFacts, ...relayFacts].some(key => typeof d[key] !== "string" || !FACT_VALUES[key].includes(d[key] as string))) {
    mmFail("mm_gasless_provider_unavailable");
  }
  // Construct a new closed object; never retain caller-owned properties.
  return Object.freeze(Object.fromEntries([...keys.map(key => [key, d[key]]),
    ...(Object.hasOwn(d, "validationPredicate") ? [["validationPredicate", d.validationPredicate]] : []),
    ...(hasShape ? [["tokenFeesKind", d.tokenFeesKind]] : []),
    ...[...feeFacts, ...relayFacts].map(key => [key, d[key]])])) as unknown as MetaMaskReadDiagnostic;
}
export function readDiagnostic(mode: ReadMode, stage: ReadStage,
  invariant: MetaMaskReadDiagnostic["invariant"], network: ReadNetwork = "none", httpStatus: number | null = null,
  exitCode: number | null = null, signal: MetaMaskReadDiagnostic["signal"] = "none", timedOut = false, validationPredicate?: ReadValidationPredicate, shape?: TokenFeesKind,
  facts: ReadFacts = {}): MetaMaskReadDiagnostic {
  return validateReadDiagnostic({ mode, stage, invariant, network, httpStatus, exitCode, signal, timedOut,
    ...(validationPredicate === undefined ? {} : { validationPredicate }),
    ...(shape === undefined ? {} : { tokenFeesKind: shape }), ...facts }, mode);
}
const FACT_DETAILS: Readonly<Record<keyof ReadFacts, string>> = { sentinelSimulation: "mm_read_sentinel_simulation",
  sentinelFeeError: "mm_read_sentinel_fee_error", sentinelSponsorship: "mm_read_sentinel_sponsorship",
  relayServerWalletNetwork: "mm_read_relay_server_wallet_network", relaySentinelFlag: "mm_read_relay_sentinel_flag" };
export function readFailureError(reason: MetaMaskGaslessFailureReason, d: MetaMaskReadDiagnostic): ApnError {
  const plain = readDataRecord(d);
  if (plain.mode !== "inspect" && plain.mode !== "quote") mmFail("mm_gasless_provider_unavailable");
  const diagnostic = validateReadDiagnostic(plain, plain.mode), base = mmError(reason);
  return new ApnError(base.code, base.message, { reason,
    mm_read_mode: diagnostic.mode, mm_read_stage: diagnostic.stage, mm_read_invariant: diagnostic.invariant,
    ...(diagnostic.validationPredicate === undefined ? {} : { mm_read_validation_predicate: diagnostic.validationPredicate }),
    ...(diagnostic.tokenFeesKind === undefined ? {} : { mm_read_token_fees_kind: diagnostic.tokenFeesKind }),
    ...Object.fromEntries([...FEE_FACTS, ...RELAY_FACTS].filter(key => diagnostic[key] !== undefined)
      .map(key => [FACT_DETAILS[key], diagnostic[key]!])),
    mm_read_network: diagnostic.network, mm_read_signal: diagnostic.signal, mm_read_timed_out: diagnostic.timedOut,
    ...(diagnostic.httpStatus === null ? {} : { mm_read_http_status: diagnostic.httpStatus }),
    ...(diagnostic.exitCode === null ? {} : { mm_read_exit_code: diagnostic.exitCode }) });
}
const runnerFailures = new WeakMap<object, MetaMaskReadDiagnostic>();
export function readRunnerFailure(mode: ReadMode, invariant: MetaMaskReadDiagnostic["invariant"],
  exitCode: number | null = null, signal: NodeJS.Signals | null = null): Error {
  const error = new Error("MetaMask read helper unavailable");
  const closedSignal = signal === null ? "none" : ["SIGINT", "SIGTERM", "SIGKILL"].includes(signal)
    ? signal as "SIGINT" | "SIGTERM" | "SIGKILL" : "other";
  runnerFailures.set(error, readDiagnostic(mode, "launch", invariant, "none", null,
    exitCode !== null && Number.isSafeInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : null,
    closedSignal, invariant === "runner_timeout"));
  return error;
}
export function takeReadRunnerDiagnostic(error: unknown, mode: ReadMode): MetaMaskReadDiagnostic | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const d = runnerFailures.get(error); runnerFailures.delete(error);
  return d?.mode === mode ? d : undefined;
}
