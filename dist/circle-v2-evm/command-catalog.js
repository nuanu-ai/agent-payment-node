import { deriveCircleFundingParameters } from "./funding-binding.js";
import { exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { isCircleDestinationChain } from "./catalog.js";
const option = (name, type, constraints, required = true) => ({ name, type, required,
    default: { kind: "none" }, constraints, sensitivity: "operator_input" });
const operation = option("--operation", "operation_id", ["64_lowercase_hex_characters"]);
export const CIRCLE_EVM_GROUPS = [{ path: ["circle", "evm"], summary: "CCTP V2 Fast Arbitrum USDC to Sei, Linea or Monad for any profile, with separate destination gas consent.", kind: "group" }];
export const CIRCLE_EVM_COMMANDS = [
    command("prepare", [option("--profile", "profile", ["local_evm_custody_source_signer"]), option("--destination-profile", "profile", ["local_evm_custody_destination_gas_signer"]),
        option("--destination-chain", "string", ["1329_or_59144_or_143"]), option("--idempotency-key", "idempotency_key", ["global_payment_key"]),
        option("--beneficiary", "address", ["canonical_nonzero_address"]),
        option("--gross-atomic", "atomic_usdc", ["positive_uint256"]),
        option("--max-issuer-fee-atomic", "atomic_usdc", ["positive_less_than_gross"]),
        option("--min-mint-atomic", "atomic_usdc", ["positive_at_most_gross_minus_max_fee"])], "Freeze one CCTP V2 Fast burn of --gross-atomic Arbitrum USDC from the --profile wallet to --beneficiary on the destination chain, minted by the --destination-profile wallet; admitted by each profile's active policy for circle-cctp-v2 / circle-v2-evm-fast-42161-<destination>.v2 and caps.", "payment_prepare"),
    command("approve-source", [operation], "Foreground-confirm, sign and send exact bounded approval and burn at most once.", "payment_submit"),
    command("adopt-external-mint", [operation, option("--transaction-hash", "string", ["0x_64_lowercase_hex_characters"])], "Verify one explicit third-party mint of this burn on its destination, preserve source charges and close only never-entered owned holds without signing or sending; observe does this itself when its bounded log scan finds the mint.", "recovery"),
    command("approve-mint", [operation], "Foreground-confirm the destination gas owner and mint the issuer-verified same burn nonce once; a message someone else already minted is adopted instead, with no consent and nothing signed.", "payment_submit"),
    command("observe", [operation], "Observe canonical source, issuer signature, destination mint and independent finality without signing; a mint someone else relayed is found from transmitter logs and adopted.", "network_read"),
    command("refresh-attestation", [operation], "Read-only issuer refresh for the same burn and nonce before mint; never reburn.", "network_read"),
    command("cleanup", [operation], "Explicit foreground approve-zero cleanup after confirmed approval/revert, or cancellation before private entry.", "payment_submit"),
    command("status", [operation], "Read the checked durable local Circle operation with both signing profiles.", "local_read"),
];
function command(action, options, summary, effect) {
    const foreground = effect === "payment_submit";
    return { path: ["circle", "evm", action], synopsis: `apn circle evm ${action}${options.map(o => o.required ? ` ${o.name} <${o.type}>` : ` [${o.name} <${o.type}>]`).join("")}`, summary, options,
        effect: { class: effect, summary }, approval: { class: foreground ? "foreground_tty" : "none", when: foreground ? "Exact physical foreground TTY consent before signing; MCP provides the CLI handoff." : "No financial effect." },
        output: { contract: "apn.cli.v1", success_exit: 0, failure_exit: 1, success: "Checked Circle operation, receipts and usage state.", failures: ["Classified refusal; ambiguous effects hold all reservations and are never resent."] },
        states: { terminal: ["completed", "cleaned", "cancelled_unsubmitted", "nonce_retired", "external_fulfilled"], non_terminal: ["awaiting_source", "source_unknown", "awaiting_mint", "mint_unknown", "awaiting_finality", "cleanup_required"] },
        recovery: [{ command_path: ["circle", "evm", "observe"], when: "Any prior effect marker exists." }], examples: [`apn circle evm ${action}`] };
}
export function bindCircleEvmCommand(path, input) {
    const action = path.slice("circle evm ".length);
    if (!isPlainRecord(input))
        invalid();
    if (action === "adopt-external-mint") {
        if (!exactKeys(input, ["--operation", "--transaction-hash"]) || !/^[a-f0-9]{64}$/u.test(input["--operation"]) || !/^0x[a-f0-9]{64}$/u.test(input["--transaction-hash"]))
            invalid();
        return { command: "circle.evm.adopt-external-mint", operationId: input["--operation"], transactionHash: input["--transaction-hash"] };
    }
    if (action === "prepare") {
        // Every input is required: no default profile, beneficiary or amount. The fixed v1 shape is read-only.
        const fields = ["--beneficiary", "--gross-atomic", "--max-issuer-fee-atomic", "--min-mint-atomic"];
        if (!exactKeys(input, ["--profile", "--destination-profile", "--destination-chain", "--idempotency-key", ...fields]))
            invalid();
        const funding = deriveCircleFundingParameters(Object.fromEntries(fields.map((k, i) => [["recipient", "amountAtomic", "maxFeeAtomic", "minMintAtomic"][i], input[k]])));
        const chain = Number(input["--destination-chain"]);
        if (funding === null || !/^[1-9][0-9]*$/u.test(input["--destination-chain"]) || !isCircleDestinationChain(chain))
            invalid();
        return { command: "circle.evm.prepare", profile: input["--profile"], destinationProfile: input["--destination-profile"], destinationChain: chain, idempotencyKey: input["--idempotency-key"], funding };
    }
    if (!["approve-source", "approve-mint", "observe", "refresh-attestation", "cleanup", "status"].includes(action) || !exactKeys(input, ["--operation"]) || !/^[a-f0-9]{64}$/u.test(input["--operation"]))
        invalid();
    return { command: `circle.evm.${action}`, operationId: input["--operation"] };
}
function invalid() { throw new ApnError("APN_INVALID_INPUT", "Circle EVM options are invalid."); }
//# sourceMappingURL=command-catalog.js.map