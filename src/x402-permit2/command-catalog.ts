import { command, option } from "../command-catalog-builders.js";
import type { CommandDefinition } from "../command-catalog-types.js";
const noDefault = { kind: "none" } as const;
const profileRequired = option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const rpcRequired = option("--rpc-url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "public_target_required_at_runtime"], "operator_input");
const operationRequired = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
export const PERMIT2_COMMANDS: readonly CommandDefinition[] = [
  command(["x402", "permit2", "approve"], "apn x402 permit2 approve --url <https-url> --rpc-url <https-rpc> [--profile <profile>] --idempotency-key <key>",
    "Approve one foreground Avalanche USDT Permit2 GET request from the local wallet.",
    [option("--profile", "profile", false, { kind: "literal", value: "default" }, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public"),
      option("--url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "canonical_whatwg_serialization", "maximum_2048_utf8_bytes"], "operator_input"), rpcRequired,
      option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_200_safe_ascii_characters"], "operator_input")],
    "payment_submit", "New operations inspect unsigned terms, reserve frozen material, require foreground approval, sign and send at most one paid GET. Held or terminal replays read status only; HTTP alone never proves settlement.",
    "foreground_tty", "The owner must approve the exact frozen request, maximum debit and payee in the foreground TTY.",
    { terminal: ["settled", "expired_no_effect", "released_unsubmitted"], non_terminal: ["prepared", "reserving", "reserved", "exposure_unknown", "request_pending", "terminal_pending"] },
    [{ command_path: ["x402", "permit2", "observe"], when: "Read canonical chain evidence for the held operation without sending again." }], ["apn x402 permit2 approve --help"]),
  command(["x402", "permit2", "observe"], "apn x402 permit2 observe --operation <operation-id> --rpc-url <https-rpc> [--profile <profile>] [--transaction <hash> | --expired-unused]",
    "Read canonical Avalanche Permit2 evidence and reconcile the owned local journal and usage ledger.",
    [operationRequired, rpcRequired, option("--profile", "profile", false, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public"),
      option("--transaction", "transaction_hash", false, noDefault, ["nonzero_evm_transaction_hash", "mutually_exclusive_with_expired_unused"], "public"),
      option("--expired-unused", "boolean", false, noDefault, ["genuine_finalized_time_and_unused_nonce_proof_required"], "public")],
    "network_read", "Reads existing frozen operation and finite readonly chain evidence. Genuine observer proof may finalize its local journal and ledger; no keys, UI, merchant request, signing or paid retry.",
    "prior_operation_authorization", "Only an owned exposed operation can be observed; existing terminal ledger intent may reconcile without RPC.",
    { terminal: ["settled", "expired_no_effect", "released_unsubmitted"], non_terminal: ["not_found", "held", "prepared", "reserved", "exposure_unknown", "request_pending", "terminal_pending"] }, [], ["apn x402 permit2 observe --help"]),
  command(["x402", "permit2", "preflight"],
    "apn x402 permit2 preflight --profile <profile> --payment-required <base64-header> --expected-challenge-hash <hash> --expected-index <index> --expected-terms <base64-json> --rpc-url <avalanche-rpc>",
    "Check current local owner admission for exact inspected Permit2 terms without signing or saving a payment.",
    [profileRequired, option("--payment-required", "base64", true, noDefault, ["decoded_x402_v2_PAYMENT-REQUIRED"], "operator_input"),
      option("--expected-challenge-hash", "string", true, noDefault, ["64_lowercase_hex_characters"], "public"),
      option("--expected-index", "string", true, noDefault, ["canonical_nonnegative_integer"], "public"),
      option("--expected-terms", "base64", true, noDefault, ["decoded_selected_requirements_json"], "operator_input"), rpcRequired],
    "network_read", "Reads local owner binding, active policy, usage, one finalized Avalanche block and facilitator capability; writes only RPC pacing metadata, never payment state or submission.",
    "none", "Never.", { terminal: ["admissible_unsigned"], non_terminal: [] }, [],
    ["apn x402 permit2 preflight --profile default --payment-required <inspected-header> --expected-challenge-hash <hash> --expected-index 0 --expected-terms <inspected-terms-base64> --rpc-url https://avalanche-rpc.example"]),
  command(["x402", "permit2", "status"], "apn x402 permit2 status --profile <profile> --operation <operation-id>",
    "Read one existing blocked Permit2 intent with redacted output.", [profileRequired, operationRequired],
    "local_read", "Checks existing local state only; never initializes, repairs, reserves, signs or sends.",
    "none", "Never.", { terminal: ["not_found"], non_terminal: ["execution_blocked"] }, [],
    ["apn x402 permit2 status --profile default --operation <operation-id>"]),
];
