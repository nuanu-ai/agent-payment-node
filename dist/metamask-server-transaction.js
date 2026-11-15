import { ApnError } from "./errors.js";
import { MetaMaskGaslessProviderClient } from "./metamask-gasless/client/process.js";
import { serverTransactionInput } from "./metamask-gasless/client/server-transaction.js";
import { takeSubmitDiagnostic } from "./metamask-gasless/client/submit-diagnostic.js";
import { mmClassify } from "./metamask-gasless/reasons.js";
const PAYLOAD_KEYS = ["to", "data", "value", "gas", "nonce", "maxFeePerGas", "maxPriorityFeePerGas"];
const QUANTITY = /^0x[0-9a-fA-F]+$/u, ADDRESS = /^0x[0-9a-fA-F]{40}$/u, DATA = /^0x[0-9a-fA-F]*$/u;
/**
 * The wire `tx` that `mm wallet send-transaction` (pinned @metamask/agent-wallet 6.1.5) POSTs for this `--payload` on
 * chain `chainId` from the server wallet `from`. mm parses the payload (evmInputs: `to` and `data` as
 * trimmed strings, `value`, `gas` and both fees as BigInt, `nonce` as a safe Number), its wallet client writes each
 * quantity back as `0x${value.toString(16)}` (`prepareViaController`), the transaction controller's normalizer
 * lowercases `from` and `to` (`normalizeTxParameters`), and `preparedToRemoteTx` names the fields `{ from, to, chainId,
 * data, value, nonce (a number), gasLimit (from gas), maxFeePerGas, maxPriorityFeePerGas }`, chainId being the chain's
 * number. mm's preparation reads (EIP-1559 support, a gas estimate or nonce only for absent fields, the native balance)
 * change none of these fields when, as here, every field is given. A payload APN would never write (another key, a
 * non-zero value, a field missing or malformed) refuses: nothing is guessed.
 */
export function metaMaskCliPayloadTx(payload, from, chainId) {
    const keys = Object.keys(payload);
    if (keys.length !== PAYLOAD_KEYS.length || PAYLOAD_KEYS.some(key => typeof payload[key] !== "string") ||
        !ADDRESS.test(payload.to) || !DATA.test(payload.data) || !ADDRESS.test(from) ||
        [payload.value, payload.gas, payload.nonce, payload.maxFeePerGas, payload.maxPriorityFeePerGas].some(item => !QUANTITY.test(item)) ||
        BigInt(payload.value) !== 0n || BigInt(payload.nonce) > BigInt(Number.MAX_SAFE_INTEGER))
        internal();
    const quantity = (value) => `0x${BigInt(value).toString(16)}`;
    return { from: from.toLowerCase(), to: payload.to.toLowerCase(), chainId, data: payload.data,
        value: "0x0", nonce: Number(BigInt(payload.nonce)), gasLimit: quantity(payload.gas), maxFeePerGas: quantity(payload.maxFeePerGas),
        maxPriorityFeePerGas: quantity(payload.maxPriorityFeePerGas) };
}
/**
 * The helper's request for `payload` with APN's own request id, checked exactly as the helper will check it. Built
 * before the helper starts, so a malformed one refuses before anything could be sent.
 */
export function metaMaskServerTransaction(input) {
    return serverTransactionInput({ requestId: input.requestId, projectHash: input.projectHash,
        tx: metaMaskCliPayloadTx(input.payload, input.from, input.chainId), intent: input.intent, expiresAt: input.expiresAt });
}
/** Job statuses of a request MetaMask still works on before it has a transaction hash. */
export const MM_REQUEST_PENDING_STATUSES = ["EVALUATING", "AWAITING_MFA", "SIGNING", "BROADCASTING"];
/** The statuses `mm` 6.1.5 itself reports as a failed request (cliWalletExecutor): the provider's word, never proof. */
export const MM_REQUEST_CLOSED_STATUSES = ["FAILED", "BROADCAST_FAILED", "DENIED", "EXPIRED"];
/** Sends `transaction` once through the sandboxed MetaMask helper; it never throws and never sends again. */
export async function sendMetaMaskServerTransaction(transaction, timeoutMs, client = new MetaMaskGaslessProviderClient()) {
    let answer;
    try {
        answer = await client.submitServerTransaction(transaction, timeoutMs);
    }
    catch (error) {
        const diagnostic = takeSubmitDiagnostic(error), helperFailure = mmClassify(error, "mm_gasless_submit_unknown").reason;
        return { kind: "unknown", reason: diagnostic?.check === "response_request_id" ? "provider_request_identity_conflict" : "provider_handoff_outcome_unknown",
            ...(diagnostic === undefined ? {} : { diagnostic }), helperFailure };
    }
    // The production client binds the answer to the request id already; any other port is held to the same rule here.
    if (answer.requestId !== transaction.requestId)
        return { kind: "unknown", reason: "provider_request_identity_conflict" };
    return { kind: "answered", answer };
}
function internal() {
    throw new ApnError("APN_INTERNAL", "A MetaMask server-wallet transaction is built only from APN's own exact payload.");
}
//# sourceMappingURL=metamask-server-transaction.js.map