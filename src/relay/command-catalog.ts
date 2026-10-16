/** Relay CLI commands. Every command names its profile explicitly; payer, recipient, amounts and fee ceilings are
 * per-operation inputs shown on foreground consent, and admission is the profile's own active owner policy. */
import { command, option } from "../command-catalog-builders.js";
import type { CommandDefinition, CommandGroup } from "../command-catalog-types.js";

const noDefault = { kind: "none" } as const;
const profile = option("--profile", "profile", true, noDefault, ["matches_[a-z0-9][a-z0-9._-]{0,63}"], "public");
const operation = option("--operation", "operation_id", true, noDefault, ["64_lowercase_hex_characters"], "public");
const rpc = option("--rpc-url", "https_url", true, noDefault, ["credential_free_https_without_fragment", "public_target_required_at_runtime"], "operator_input");
const https = (name: `--${string}`, required: boolean) =>
  option(name, "https_url", required, noDefault, ["credential_free_https_without_fragment", "public_target_required_at_runtime"], "operator_input");
const positive = (name: `--${string}`, type: "wei" | "atomic_usdc") => option(name, type, true, noDefault, ["positive_integer"], "operator_input");
const recipient = option("--recipient", "address", true, noDefault, ["canonical_nonzero_evm_address"], "public");
const idempotency = option("--idempotency-key", "idempotency_key", true, noDefault, ["8_to_128_safe_ascii_characters"], "operator_input");
const prepared = { terminal: [], non_terminal: ["prepared"] };
const inspect = [{ command_path: ["operation", "status"], when: "Inspect the saved unsigned quote." }];
const observeArbitrum = (when: string) => [{ command_path: ["relay", "arbitrum", "observe"], when }];
const ADMISSION = "the profile's active owner policy: account equal to the profile wallet, exact asset, rail, relay mechanism pin and caps, and the optional recipient pin";

export const RELAY_COMMAND_GROUPS: readonly CommandGroup[] = [
  { path: ["relay"], summary: "Prepare, execute, observe and retire Relay bridge operations of any profile under its owner policy.", kind: "group" },
];

export const RELAY_COMMANDS: readonly CommandDefinition[] = [
  command(["relay", "arbitrum", "prepare"],
    "apn relay arbitrum prepare --profile <profile> --owner <arbitrum-account> --recipient <ethereum-address> --amount-atomic <usdc> --min-output-atomic <usdc> --max-provider-fee-atomic <usdc> --max-approval-network-fee-wei <wei> --max-deposit-network-fee-wei <wei> --quote-file <absolute-json-path> --idempotency-key <key>",
    "Save one unsigned Arbitrum USDC to Ethereum USDC Relay quote for an explicit recipient.",
    [profile, option("--owner", "address", true, noDefault, ["canonical_evm_address"], "public"), recipient,
      positive("--amount-atomic", "atomic_usdc"), positive("--min-output-atomic", "atomic_usdc"), positive("--max-provider-fee-atomic", "atomic_usdc"),
      positive("--max-approval-network-fee-wei", "wei"), positive("--max-deposit-network-fee-wei", "wei"),
      option("--quote-file", "string", true, noDefault, ["absolute_regular_json_file_maximum_65536_bytes"], "operator_input"), idempotency],
    "payment_prepare", `Reads a local Relay quote file and ${ADMISSION}; writes an immutable unsigned operation. The signed order must pay the named recipient; the source refund goes to the owner account and the Ethereum refund to the recipient. No signing or network.`,
    "none", "Never.", prepared, inspect,
    ["apn relay arbitrum prepare --profile <profile> --owner <account> --recipient <address> --amount-atomic 500000 --min-output-atomic 441888 --max-provider-fee-atomic 60000 --max-approval-network-fee-wei 2000000000000 --max-deposit-network-fee-wei 2000000000000 --quote-file /absolute/quote.json --idempotency-key relay-arb-eth-0001"]),
  command(["relay", "arbitrum", "observe"], "apn relay arbitrum observe --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>",
    "Read canonical safe Arbitrum source receipts for a saved Relay attempt.", [profile, operation, rpc], "network_read",
    "Reads only Arbitrum, with at most five physical RPC POSTs under persisted 750 ms pacing and no 429 retry. A matching safe receipt may advance only the saved source effect journal. No signer, broadcaster, destination credit or paid acceptance.",
    "prior_operation_authorization", "A hash-bound submitting marker in the saved source effect journal is required.",
    { terminal: [], non_terminal: ["source_effect_not_recorded", "observation_only", "source_proof_pending", "approval_source_confirmed", "approval_skipped", "deposit_source_confirmed"] },
    [], ["apn relay arbitrum observe --profile <profile> --operation <operation-id> --rpc-url https://arbitrum-rpc.example"]),
  command(["relay", "arbitrum", "approval-check"], "apn relay arbitrum approval-check --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>",
    "Check the saved Arbitrum Relay allowance and persist an approval skip only with fresh canonical proof.", [profile, operation, rpc], "payment_prepare",
    "At most six read-only Arbitrum RPC POSTs under one persisted 24-POST guard and 750 ms pacing. An insufficient or changed allowance writes nothing. No signing, send, deposit dispatch, destination credit or paid acceptance.",
    "prior_operation_authorization", "An exact saved unsigned operation and active owner policy are required.",
    { terminal: [], non_terminal: ["approval_required", "preflight_blocked", "approval_skipped"] },
    [], ["apn relay arbitrum approval-check --profile <profile> --operation <operation-id> --rpc-url https://arbitrum-rpc.example"]),
  command(["relay", "arbitrum", "approval-execute"], "apn relay arbitrum approval-execute --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>",
    "Foreground-confirm and submit one exact saved Arbitrum USDC approval.", [profile, operation, rpc], "payment_submit",
    `Requires ${ADMISSION}, fresh canonical allowance, balance, nonce and fee checks, an encrypted local wallet, and a durable single-send marker. A started approval is observation-only on replay. Never dispatches the deposit.`,
    "foreground_tty", "After saved operation validation and before signing or submission.",
    { terminal: [], non_terminal: ["approval_not_needed", "approval_submitted", "observation_only"] },
    observeArbitrum("Observe the saved approval transaction at safe finality."),
    ["apn relay arbitrum approval-execute --profile <profile> --operation <operation-id> --rpc-url https://arbitrum-rpc.example"]),
  command(["relay", "arbitrum", "deposit-dispatch"], "apn relay arbitrum deposit-dispatch --profile <profile> --operation <operation-id> --rpc-url <arbitrum-rpc>",
    "Foreground-confirm and submit one exact saved Arbitrum USDC Relay deposit.", [profile, operation, rpc], "payment_submit",
    `Requires a confirmed approval or verified approval skip, ${ADMISSION}, fresh canonical allowance, balance, nonce and fee checks, encrypted local wallet and durable single-send marker. A started deposit is observation-only on replay. At most 24 physical RPC POSTs under persisted 750 ms pacing; 429 ends the invocation. Ethereum delivery and paid acceptance remain unproven.`,
    "foreground_tty", "After saved operation validation and before deposit signing or submission.",
    { terminal: [], non_terminal: ["deposit_submitted", "observation_only"] },
    observeArbitrum("Observe the saved deposit transaction at safe finality."),
    ["apn relay arbitrum deposit-dispatch --profile <profile> --operation <operation-id> --rpc-url https://arbitrum-rpc.example"]),
  command(["relay", "base", "prepare"], "apn relay base prepare --profile <profile> --recipient <address> --amount-atomic <usdc> --min-output-atomic <wei> --max-approval-network-fee-wei <wei> --max-deposit-network-fee-wei <wei> --idempotency-key <key>",
    "Freeze one unsigned Ethereum USDC to Base ETH Relay quote.",
    [profile, recipient, positive("--amount-atomic", "atomic_usdc"), positive("--min-output-atomic", "wei"), positive("--max-approval-network-fee-wei", "wei"), positive("--max-deposit-network-fee-wei", "wei"), idempotency],
    "payment_prepare", `Reads ${ADMISSION} (relay / ethereum-usdc-base-eth-v1) and one no-key Relay quote; saves only an unsigned quote. Source refund = payer, Base refund = recipient. Execution needs the same profile and fresh foreground confirmation.`,
    "none", "Never.", prepared, inspect,
    ["apn relay base prepare --profile <profile> --recipient <address> --amount-atomic 2500000 --min-output-atomic 891439003839815 --max-approval-network-fee-wei 100000000000000 --max-deposit-network-fee-wei 100000000000000 --idempotency-key relay-base-0001"]),
  command(["relay", "base", "observe"], "apn relay base observe --profile <profile> --operation <operation-id> --rpc-url <base-rpc> [--ethereum-rpc-url <source-rpc>]",
    "Read one provider candidate and safe Base native recipient credit.", [profile, operation, rpc, https("--ethereum-rpc-url", false)], "network_read",
    "Uses up to three Ethereum source RPC POSTs when supplied, one Relay status GET, and up to eight Base RPC POSTs with persisted 750 ms pacing. Operational acceptance requires finalized source, provider source binding, and safe credit to the operation's own recipient; paid acceptance remains unproven.",
    "none", "Never.", { terminal: [], non_terminal: ["prepared_waiting", "provider_candidate_unproven", "recipient_credit_observed", "operational_acceptance"] },
    [], ["apn relay base observe --profile <profile> --operation <operation-id> --rpc-url https://base-rpc.example --ethereum-rpc-url https://ethereum-rpc.example"]),
  command(["relay", "prepare"], "apn relay prepare --profile <profile> --recipient <address> --amount-atomic <usdc> --min-output-atomic <wei> --max-approval-network-fee-wei <wei> --max-deposit-network-fee-wei <wei> --idempotency-key <key>",
    "Freeze one unsigned Ethereum USDC to BNB native Relay quote.",
    [profile, recipient, positive("--amount-atomic", "atomic_usdc"), positive("--min-output-atomic", "wei"), positive("--max-approval-network-fee-wei", "wei"), positive("--max-deposit-network-fee-wei", "wei"), idempotency],
    "payment_prepare", `Reads ${ADMISSION} (relay / ethereum-usdc-bnb-native-v1) and one no-key Relay quote; writes an unsigned PREPARED journal. Does not inspect funds or allowance.`,
    "none", "Never.", prepared, inspect,
    ["apn relay prepare --profile <profile> --recipient <address> --amount-atomic 1000000 --min-output-atomic 1000000000000000 --max-approval-network-fee-wei 1000000000000000 --max-deposit-network-fee-wei 1000000000000000 --idempotency-key relay-quote-0001"]),
  command(["relay", "native", "prepare"], "apn relay native prepare --profile <profile> --source-chain <eip155:56|eip155:8453> --destination-chain <eip155:137|eip155:143|eip155:4326> --recipient <address> --amount-atomic <source-wei> --min-output-atomic <destination-atomic> --max-deposit-network-fee-wei <source-wei> --idempotency-key <key>",
    "Freeze one unsigned BNB or Base native Relay quote to Polygon POL, Monad MON or MegaETH USDm.",
    [profile, option("--source-chain", "string", true, noDefault, ["eip155:56_or_eip155:8453"], "public"),
      option("--destination-chain", "string", true, noDefault, ["eip155:137_or_eip155:143_from_bnb", "eip155:137_or_eip155:4326_from_base"], "public"),
      recipient, positive("--amount-atomic", "wei"), positive("--min-output-atomic", "wei"), positive("--max-deposit-network-fee-wei", "wei"), idempotency],
    "payment_prepare", `Routes and their relay pins: BNB to Polygon (bnb-native-polygon-native-v1), BNB to Monad (bnb-native-monad-native-v1), Base to MegaETH USDm (base-native-megaeth-usdm-v1), Base to Polygon (base-native-polygon-native-v1). Reads ${ADMISSION} and one public Relay quote; writes an unsigned operation. The payer is the profile wallet; amount, minimum output and fee ceiling are the caller's, and on Base the ceiling bounds the full OP Stack fee. No signing or send occurs.`,
    "none", "Never.", prepared, inspect,
    ["apn relay native prepare --profile <profile> --source-chain eip155:56 --destination-chain eip155:137 --recipient <address> --amount-atomic 1500000000000000 --min-output-atomic 9000000000000000000 --max-deposit-network-fee-wei 30000000000000 --idempotency-key relay-bnb-pol-0001",
      "apn relay native prepare --profile <profile> --source-chain eip155:8453 --destination-chain eip155:4326 --recipient <address> --amount-atomic 60000000000000 --min-output-atomic 100000000000000000 --max-deposit-network-fee-wei 1000000000000 --idempotency-key relay-base-mega-0001"]),
  command(["relay", "preflight"], "apn relay preflight --profile <profile> --operation <operation-id> --rpc-url <ethereum-rpc>",
    "Observe source funds and exact Relay allowance for a saved unsigned quote.", [profile, operation, rpc], "network_read",
    "Reads active policy and two bounded Ethereum RPC batches pinned to one block hash; never signs, approves, or submits.",
    "none", "Never.", prepared, [], ["apn relay preflight --profile <profile> --operation <operation-id> --rpc-url https://rpc.example"]),
  command(["relay", "execute"], "apn relay execute --profile <profile> --operation <operation-id> --rpc-url <ethereum-rpc>",
    "Foreground-confirm and run the exact saved Ethereum approval and deposit source effects.", [profile, operation, rpc], "payment_submit",
    `Requires the operation's own profile, explicit foreground confirmation, the exact saved Ethereum USDC to BNB native or Base ETH route, and ${ADMISSION}; may sign and submit the exact saved Ethereum source effects once per durable effect. Returns only the source effect journal; destination delivery and paid acceptance remain unproven.`,
    "foreground_tty", "Inside the source runtime, after operation validation and before any durable source effect or signing.",
    { terminal: ["confirmed", "failed"], non_terminal: ["pending", "signing_started", "sealed", "submitting", "submission_marked", "tx_known"] },
    [{ command_path: ["operation", "status"], when: "Inspect saved source state without a new signing attempt." }],
    ["apn relay execute --profile <profile> --operation <operation-id> --rpc-url https://rpc.example"]),
  command(["relay", "native", "execute"], "apn relay native execute --profile <profile> --operation <operation-id> --rpc-url <source-rpc>",
    "Foreground-confirm and submit the exact saved native Relay deposit once.", [profile, operation, rpc], "payment_submit",
    `Requires the operation's own profile and saved route, ${ADMISSION}, fresh funding and nonce, encrypted local wallet, and one durable send marker. Base sources simulate the exact deposit and bound the full OP Stack fee by the consented ceiling before signing and dispatch. Returns source evidence only; destination delivery and paid acceptance remain unproven.`,
    "foreground_tty", "After saved operation validation and before signing or source effects.",
    { terminal: ["confirmed", "failed", "failed_before_effect"], non_terminal: ["pending", "signing_started", "sealed", "submitting"] },
    inspect, ["apn relay native execute --profile <profile> --operation <operation-id> --rpc-url https://bnb-rpc.example"]),
  command(["relay", "retire"], "apn relay retire --profile <profile> --operation <operation-id>",
    "Retire an untouched Relay quote, or abandon a token route whose only sent effect is a confirmed approval.", [profile, operation], "local_write",
    "Writes a durable retirement marker for an untouched quote of this profile (no signing marker), an exact native attempt proven to have failed before any effect, or a token route whose only sent effect is a confirmed or verified-skipped approval; the principal usage hold is released and that approval stays on chain. Never retires a signing marker, signed-but-unsent bytes or an unresolved send. Does not sign or use the network.",
    "foreground_tty", "Only to abandon a route after its confirmed approval; an untouched quote needs none.",
    { terminal: ["retired"], non_terminal: [] }, [{ command_path: ["operation", "status"], when: "Inspect the retained quote and retirement proof." }],
    ["apn relay retire --profile <profile> --operation <operation-id>"]),
  command(["relay", "status"], "apn relay status --profile <profile> --operation <operation-id>",
    "Read one keyless Relay provider status for a saved quote.", [profile, operation], "network_read",
    "Checks the retirement marker and makes one bounded GET to Relay status/v3; reads saved operation and makes no journal or usage changes. Provider hashes are candidates, not onchain proof or paid acceptance.",
    "none", "Never.", prepared, [], ["apn relay status --profile <profile> --operation <operation-id>"]),
  command(["relay", "observe"], "apn relay observe --profile <profile> --operation <operation-id> --rpc-url <source-rpc> --bnb-rpc-url <destination-rpc>",
    "Read source and destination evidence for one saved Relay operation.", [profile, operation, rpc, https("--bnb-rpc-url", true)], "network_read",
    "Reads the saved quote and source journal, up to three source RPC POSTs, one bounded Relay status GET, and up to eight destination RPC POSTs; physical starts share persisted 750 ms provider-family pacing. One proof per destination chain credits only the operation's own recipient; a proven native source receipt reconciles its local journal and usage reservation. Never signs, submits, or establishes paid acceptance.",
    "none", "Never.", { terminal: [], non_terminal: ["prepared", "source_finalized", "recipient_credit_observed", "operational_acceptance"] },
    [], ["apn relay observe --profile <profile> --operation <operation-id> --rpc-url https://source-rpc.example --bnb-rpc-url https://destination-rpc.example"]),
];
