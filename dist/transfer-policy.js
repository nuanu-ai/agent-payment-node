import { encodeFunctionData, getAddress, keccak256, parseTransaction, recoverTransactionAddress } from "viem";
import { exactKeys, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2, CHAIN_ID, TRANSFER_TOPIC, USDC_DECIMALS } from "./constants.js";
import { ApnError, assertInput } from "./errors.js";
import { multiplyAtomic, parseAtomic } from "./money.js";
import { canonicalAddress, validateBalance } from "./wallet-policy.js";
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const HASH = /^[a-f0-9]{64}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
const TRANSFER_ABI = [{
        type: "function",
        name: "transfer",
        stateMutability: "nonpayable",
        inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }],
        outputs: [{ name: "", type: "bool" }],
    }];
export function canonicalOperationId(value) {
    assertInput(typeof value === "string" && HASH.test(value), "Operation ID must be a 64-character lowercase SHA-256 identifier.");
    return value;
}
export function canonicalIdempotencyKey(value) {
    assertInput(typeof value === "string" && IDEMPOTENCY_KEY.test(value), "Idempotency key must be 8-200 safe ASCII characters.");
    return value;
}
export function transferData(recipient, atomic) {
    return encodeFunctionData({ abi: TRANSFER_ABI, functionName: "transfer", args: [recipient, parseAtomic(atomic)] });
}
export function validateEconomics(nonceAtomic, fees) {
    const nonce = parseAtomic(nonceAtomic).toString();
    const gas = parseAtomic(fees.gasLimitAtomic, { positive: true }).toString();
    const maxFee = parseAtomic(fees.maxFeePerGasAtomic, { positive: true }).toString();
    const priority = parseAtomic(fees.maxPriorityFeePerGasAtomic).toString();
    if (parseAtomic(priority) > parseAtomic(maxFee))
        throw new ApnError("APN_RPC_PROTOCOL", "Priority fee exceeds maximum fee.");
    return {
        nonceAtomic: nonce,
        gasLimitAtomic: gas,
        maxFeePerGasAtomic: maxFee,
        maxPriorityFeePerGasAtomic: priority,
        maximumGasCostAtomic: multiplyAtomic(gas, maxFee),
    };
}
export function requireFunding(snapshot, amountAtomic, gasAtomic) {
    if (parseAtomic(snapshot.usdcAtomic) < parseAtomic(amountAtomic)) {
        throw new ApnError("APN_INSUFFICIENT_USDC", "USDC balance is insufficient for the exact transfer amount.");
    }
    if (parseAtomic(snapshot.ethAtomic) < parseAtomic(gasAtomic)) {
        throw new ApnError("APN_INSUFFICIENT_GAS", "ETH balance is insufficient for the frozen worst-case gas cost.");
    }
}
export function parseEffect(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["transactionHash", "rawTransaction", "rawTransactionHash"])) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native effect result violates the schema.");
    }
    for (const key of ["transactionHash", "rawTransaction", "rawTransactionHash"]) {
        if (typeof value[key] !== "string" || !HEX.test(value[key])) {
            throw new ApnError("APN_NATIVE_PROTOCOL", "Native effect result contains invalid hex data.");
        }
    }
    const transactionHash = value.transactionHash;
    const rawTransaction = value.rawTransaction;
    const rawTransactionHash = value.rawTransactionHash;
    if (transactionHash.length !== 66 || rawTransactionHash.length !== 66) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native transaction hash has the wrong length.");
    }
    return {
        transactionHash: transactionHash,
        rawTransaction: rawTransaction,
        rawTransactionHash: rawTransactionHash,
    };
}
export async function verifyEffect(effect, operation) {
    if (operation.transactionData === undefined || operation.economics === undefined) {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native signing requires a local direct operation.");
    }
    const computed = keccak256(effect.rawTransaction);
    if (computed.toLowerCase() !== effect.transactionHash.toLowerCase() ||
        computed.toLowerCase() !== effect.rawTransactionHash.toLowerCase())
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native effect hashes do not match the exact signed bytes.");
    let transaction;
    let recovered;
    try {
        const serialized = effect.rawTransaction;
        transaction = parseTransaction(serialized);
        recovered = getAddress(await recoverTransactionAddress({ serializedTransaction: serialized }));
    }
    catch {
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native effect is not a valid signed Ethereum transaction.");
    }
    const accessList = transaction.accessList ?? [];
    const s = transaction.s === undefined ? 0n : BigInt(transaction.s);
    const halfCurveOrder = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
    if (transaction.type !== "eip1559" || transaction.chainId !== CHAIN_ID ||
        transaction.to?.toLowerCase() !== BASE_USDC.toLowerCase() || (transaction.value ?? 0n) !== 0n ||
        transaction.data?.toLowerCase() !== operation.transactionData.toLowerCase() ||
        transaction.nonce?.toString() !== operation.economics.nonceAtomic ||
        transaction.gas?.toString() !== operation.economics.gasLimitAtomic ||
        transaction.maxFeePerGas?.toString() !== operation.economics.maxFeePerGasAtomic ||
        transaction.maxPriorityFeePerGas?.toString() !== operation.economics.maxPriorityFeePerGasAtomic ||
        accessList.length !== 0 || recovered !== operation.walletAddress || transaction.r === undefined ||
        transaction.s === undefined || s === 0n || s > halfCurveOrder ||
        (transaction.yParity !== 0 && transaction.yParity !== 1))
        throw new ApnError("APN_NATIVE_PROTOCOL", "Native signed transaction does not match the frozen transfer.");
}
export function hasExactTransfer(receipt, operation) {
    const senderTopic = addressTopic(operation.walletAddress);
    const recipientTopic = addressTopic(operation.recipient);
    const value = `0x${parseAtomic(operation.amountAtomic).toString(16).padStart(64, "0")}`;
    return receipt.logs.some((log) => log.address.toLowerCase() === BASE_USDC.toLowerCase() && log.topics.length === 3 &&
        log.topics[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics[1]?.toLowerCase() === senderTopic &&
        log.topics[2]?.toLowerCase() === recipientTopic && log.data.toLowerCase() === value);
}
export function publicOperation(operation) {
    return {
        operation_id: operation.operationId,
        idempotency_hash: operation.idempotencyHash,
        profile: operation.profile,
        state: operation.state,
        terminal: operation.terminal,
        reason: operation.reason,
        proof_class: operation.proofClass,
        chain: CHAIN_CAIP2,
        token: BASE_USDC,
        wallet_address: operation.walletAddress,
        recipient: operation.recipient,
        amount: { atomic: operation.amountAtomic, decimal: operation.amountDecimal, decimals: USDC_DECIMALS },
        ...(operation.economics === undefined ? {} : { economics: operation.economics }),
        prepared_at: operation.preparedAt,
        ...(operation.preparedBlockNumberAtomic === undefined ? {} : {
            prepared_block_number_atomic: operation.preparedBlockNumberAtomic,
        }),
        expires_at: operation.expiresAt,
        ...(operation.transactionHash === undefined ? {} : { transaction_hash: operation.transactionHash }),
        ...(operation.rawTransactionHash === undefined ? {} : { raw_transaction_hash: operation.rawTransactionHash }),
        ...(operation.providerDirect === undefined ? {} : {
            provider: operation.providerDirect.providerId,
            profile_revision: operation.providerDirect.profileRevision,
            capability_hash: operation.providerDirect.capabilityHash,
            execution: {
                mode: operation.providerDirect.executionMode,
                owner: operation.providerDirect.executionOwner,
                retry_owner: operation.providerDirect.retryOwner,
            },
            policy: {
                identity: operation.providerDirect.policy.identity,
                verdict: operation.providerDirect.policy.verdict,
                foreground_approval_required: operation.providerDirect.policy.foregroundApprovalRequired,
            },
            rpc_binding_hash: operation.providerDirect.rpcBindingHash,
        }),
        transition_hash: operation.transitions.at(-1)?.hash,
        receipt_reference: `${operation.operationId}.json`,
        next_actions: operationNextActions(operation),
    };
}
export function publicReceipt(receipt) {
    return {
        operation_id: receipt.operationId,
        state: receipt.state,
        terminal: receipt.terminal,
        reason: receipt.reason,
        proof_class: receipt.proofClass,
        ...(receipt.transactionHash === undefined ? {} : { transaction_hash: receipt.transactionHash }),
        ...(receipt.blockNumberAtomic === undefined ? {} : { block_number_atomic: receipt.blockNumberAtomic }),
        ...(receipt.exactTransferLog === undefined ? {} : { exact_transfer_log: receipt.exactTransferLog }),
        created_at: receipt.createdAt,
        receipt_hash: receipt.integrityHash,
        next_actions: [],
    };
}
export { canonicalAddress, validateBalance };
function addressTopic(address) {
    return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
function operationNextActions(operation) {
    if (operation.state === "failed_before_effect" && operation.reason === "provider_sender_changed" &&
        operation.providerDirect !== undefined)
        return [
            `apn wallet connect --profile ${operation.profile} --provider ${operation.providerDirect.providerId} --expected-revision ${operation.providerDirect.profileRevision}`,
        ];
    if (operation.state === "failed_before_effect" && operation.reason === "provider_amount_encoding_incompatible")
        return [
            `apn pay transfer prepare --profile ${operation.profile} --idempotency-key <new-key> --to ${operation.recipient} --amount-usdc <exact-provider-compatible-decimal> --rpc-url <https-url>`,
        ];
    if (operation.state === "failed_before_effect")
        return [
            `apn pay transfer prepare --profile ${operation.profile} --idempotency-key <new-key> --to ${operation.recipient} --amount-usdc ${operation.amountDecimal} --rpc-url <https-url>`,
        ];
    if (operation.terminal)
        return [];
    if (operation.state === "awaiting_approval")
        return [
            `apn pay transfer approve --operation ${operation.operationId} --rpc-url <https-url>`,
            `apn operation status --operation ${operation.operationId}`,
        ];
    return [
        `apn operation resume --operation ${operation.operationId} --rpc-url <https-url>`,
        `apn operation status --operation ${operation.operationId}`,
        `apn receipt get --operation ${operation.operationId}`,
    ];
}
//# sourceMappingURL=transfer-policy.js.map