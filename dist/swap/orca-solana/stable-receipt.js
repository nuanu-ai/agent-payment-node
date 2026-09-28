import { address, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { SOLANA_USDT } from "../../chain-policy.js";
import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, solanaSignature } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { proveOrcaStableSimulationTransfers } from "./stable-effects.js";
import { validateOrcaStableMaterial } from "./stable-material.js";
import { sha256Hex, TOKEN_PROGRAM, USDC_MINT } from "./pins.js";
/** Pure verification for a future observation route. This does no RPC or state transition. */
export async function verifyOrcaStableFinalizedReceipt(input) {
    const operation = validateSwapOperation(input.operation);
    const material = await validateOrcaStableMaterial(input.material, operation);
    const preview = material.preview;
    solanaSignature(input.signature);
    if (operation.submissionMarker === null || !["submitting", "submitted", "unknown_finality"].includes(operation.state))
        conflict();
    if (!(input.observedAt instanceof Date) || !Number.isFinite(input.observedAt.getTime()) ||
        input.observedAt.toISOString() < operation.submissionMarker.markedAt)
        conflict();
    const statuses = rpcArray(rpcRecord(input.signatureStatuses).value, 1);
    if (statuses.length !== 1)
        conflict();
    if (statuses[0] === null)
        return null;
    const status = rpcRecord(statuses[0]);
    if (!["processed", "confirmed", "finalized"].includes(status.confirmationStatus) ||
        !Object.hasOwn(status, "err") || !transactionError(status.err))
        conflict();
    if (status.confirmationStatus !== "finalized")
        return null;
    const slot = rpcAtomic(status.slot);
    if (input.transaction === null)
        return null;
    const transaction = rpcRecord(input.transaction), meta = rpcRecord(transaction.meta);
    if (rpcAtomic(transaction.slot) !== slot || rpcAtomic(transaction.version) !== 0n)
        conflict();
    const encoded = rpcArray(transaction.transaction, 2);
    if (encoded.length !== 2 || encoded[1] !== "base64" || typeof encoded[0] !== "string" || encoded[0].length > 4096)
        conflict();
    let wire;
    try {
        wire = getTransactionDecoder().decode(Buffer.from(encoded[0], "base64"));
    }
    catch {
        return conflict();
    }
    if (getSignatureFromTransaction(wire) !== input.signature ||
        sha256Hex(new Uint8Array(wire.messageBytes)) !== preview.messageHash ||
        Buffer.from(wire.messageBytes).toString("base64") !== preview.messageBase64)
        conflict();
    const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
    if (message.version !== 0 || (message.addressTableLookups ?? []).length !== 0 ||
        message.staticAccounts[0] !== address(operation.quote.account) || message.lifetimeToken !== preview.blockhash)
        conflict();
    const keys = message.staticAccounts;
    const pre = rpcArray(meta.preBalances, 64).map(rpcAtomic), post = rpcArray(meta.postBalances, 64).map(rpcAtomic);
    if (pre.length !== keys.length || post.length !== keys.length)
        conflict();
    const loaded = isPlainRecord(meta.loadedAddresses) ? meta.loadedAddresses : { writable: [], readonly: [] };
    if (rpcArray(loaded.writable ?? [], 0).length !== 0 || rpcArray(loaded.readonly ?? [], 0).length !== 0)
        conflict();
    const fee = rpcAtomic(meta.fee), rent = BigInt(preview.ataRentLamports);
    if (fee > 5000n + BigInt(preview.maximumPriorityFeeLamports) ||
        fee + rent > BigInt(preview.maximumTotalFeeLamports))
        conflict();
    const statusErr = status.err, metaErr = meta.err;
    if (!Object.hasOwn(meta, "err") || !transactionError(metaErr) ||
        canonicalJson(normalize(statusErr)) !== canonicalJson(normalize(metaErr)))
        conflict();
    const sourceIndex = keys.indexOf(address(preview.sourceAta));
    const destinationIndex = keys.indexOf(address(preview.destinationAta));
    if (sourceIndex < 0 || destinationIndex < 0 || sourceIndex === destinationIndex)
        conflict();
    const beforeSource = tokenBalance(meta.preTokenBalances, sourceIndex, USDC_MINT, preview.owner, false);
    const afterSource = tokenBalance(meta.postTokenBalances, sourceIndex, USDC_MINT, preview.owner, false);
    const beforeDestination = tokenBalance(meta.preTokenBalances, destinationIndex, SOLANA_USDT, preview.owner, preview.createUsdtAta);
    const afterDestination = tokenBalance(meta.postTokenBalances, destinationIndex, SOLANA_USDT, preview.owner, preview.createUsdtAta && metaErr !== null);
    const observedAt = input.observedAt.toISOString();
    if (metaErr !== null) {
        if (pre[0] - post[0] !== fee || beforeSource !== afterSource || beforeDestination !== afterDestination)
            conflict();
        const receiptHash = domainHash("apn.orca-stable-revert-proof.v1", canonicalJson({
            operationId: operation.operationId, markerHash: operation.submissionMarker.markerHash,
            materialDigest: material.materialDigest, signature: input.signature, messageHash: preview.messageHash,
            slot: slot.toString(), fee: fee.toString(), error: normalize(metaErr), observedAt
        }));
        return { outcome: "reverted", proof: { receiptHash, transactionHash: input.signature, observedAt, finalized: true } };
    }
    if (pre[0] - post[0] !== fee + rent || beforeSource - afterSource !== BigInt(preview.amountInAtomic))
        conflict();
    const received = afterDestination - beforeDestination;
    if (received < BigInt(preview.minimumOutputAtomic))
        conflict();
    let transfers;
    try {
        transfers = proveOrcaStableSimulationTransfers(meta.innerInstructions, preview, preview.owner, preview.amountInAtomic, preview.minimumOutputAtomic);
    }
    catch {
        return conflict();
    }
    if (BigInt(transfers.destinationCreditedAtomic) !== received)
        conflict();
    const receiptHash = domainHash("apn.orca-stable-finalized-receipt.v1", canonicalJson({
        operationId: operation.operationId, markerHash: operation.submissionMarker.markerHash,
        materialDigest: material.materialDigest, signature: input.signature, messageHash: preview.messageHash,
        slot: slot.toString(), fee: fee.toString(), rent: rent.toString(),
        usdcDebitedAtomic: preview.amountInAtomic, usdtCreditedAtomic: received.toString(), observedAt
    }));
    return { outcome: "succeeded", proof: { receiptHash, transactionHash: input.signature, observedAt, finalized: true } };
}
function tokenBalance(value, index, mint, owner, allowMissing) {
    let found;
    for (const item of rpcArray(value ?? [], 64)) {
        const balance = rpcRecord(item);
        if (Number(rpcAtomic(balance.accountIndex)) !== index)
            continue;
        const amount = rpcRecord(balance.uiTokenAmount);
        if (balance.mint !== mint || balance.owner !== owner ||
            (balance.programId !== undefined && balance.programId !== TOKEN_PROGRAM) || rpcAtomic(amount.decimals) !== 6n ||
            typeof amount.amount !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(amount.amount) || found !== undefined)
            conflict();
        found = BigInt(amount.amount);
        if (found > (1n << 64n) - 1n)
            conflict();
    }
    if (found === undefined && !allowMissing)
        conflict();
    return found ?? 0n;
}
function normalize(value) {
    return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry));
}
function transactionError(value) {
    if (value === null)
        return true;
    if (typeof value === "string")
        return TRANSACTION_ERRORS.has(value);
    if (!isPlainRecord(value) || Object.keys(value).length !== 1)
        return false;
    if ("DuplicateInstruction" in value)
        return index(value.DuplicateInstruction);
    if ("InstructionError" in value) {
        const pair = value.InstructionError;
        return Array.isArray(pair) && pair.length === 2 && index(pair[0]) && instructionError(pair[1]);
    }
    if ("InsufficientFundsForRent" in value || "ProgramExecutionTemporarilyRestricted" in value) {
        const detail = value.InsufficientFundsForRent ?? value.ProgramExecutionTemporarilyRestricted;
        return isPlainRecord(detail) && Object.keys(detail).length === 1 && index(detail.account_index);
    }
    return false;
}
function instructionError(value) {
    if (typeof value === "string")
        return INSTRUCTION_ERRORS.has(value);
    return isPlainRecord(value) && Object.keys(value).length === 1 && "Custom" in value && uint32(value.Custom);
}
function index(value) {
    return (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255) ||
        (typeof value === "bigint" && value >= 0n && value <= 255n);
}
function uint32(value) {
    return (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff) ||
        (typeof value === "bigint" && value >= 0n && value <= 0xffffffffn);
}
// Canonical variants from @solana/rpc-types transaction-error.d.ts. Unknown future variants fail closed.
const TRANSACTION_ERRORS = new Set([
    "AccountBorrowOutstanding", "AccountInUse", "AccountLoadedTwice", "AccountNotFound",
    "AddressLookupTableNotFound", "AlreadyProcessed", "BlockhashNotFound", "CallChainTooDeep",
    "ClusterMaintenance", "InsufficientFundsForFee", "InvalidAccountForFee", "InvalidAccountIndex",
    "InvalidAddressLookupTableData", "InvalidAddressLookupTableIndex", "InvalidAddressLookupTableOwner",
    "InvalidLoadedAccountsDataSizeLimit", "InvalidProgramForExecution", "InvalidRentPayingAccount",
    "InvalidWritableAccount", "MaxLoadedAccountsDataSizeExceeded", "MissingSignatureForFee",
    "ProgramAccountNotFound", "ResanitizationNeeded", "SanitizeFailure", "SignatureFailure",
    "TooManyAccountLocks", "UnbalancedTransaction", "UnsupportedVersion",
    "WouldExceedAccountDataBlockLimit", "WouldExceedAccountDataTotalLimit", "WouldExceedMaxAccountCostLimit",
    "WouldExceedMaxBlockCostLimit", "WouldExceedMaxVoteCostLimit",
]);
const INSTRUCTION_ERRORS = new Set([
    "AccountAlreadyInitialized", "AccountBorrowFailed", "AccountBorrowOutstanding", "AccountDataSizeChanged",
    "AccountDataTooSmall", "AccountNotExecutable", "AccountNotRentExempt", "ArithmeticOverflow",
    "BorshIoError", "BuiltinProgramsMustConsumeComputeUnits", "CallDepth", "ComputationalBudgetExceeded",
    "DuplicateAccountIndex", "DuplicateAccountOutOfSync", "ExecutableAccountNotRentExempt",
    "ExecutableDataModified", "ExecutableLamportChange", "ExecutableModified", "ExternalAccountDataModified",
    "ExternalAccountLamportSpend", "GenericError", "IllegalOwner", "Immutable", "IncorrectAuthority",
    "IncorrectProgramId", "InsufficientFunds", "InvalidAccountData", "InvalidAccountOwner", "InvalidArgument",
    "InvalidError", "InvalidInstructionData", "InvalidRealloc", "InvalidSeeds",
    "MaxAccountsDataAllocationsExceeded", "MaxAccountsExceeded", "MaxInstructionTraceLengthExceeded",
    "MaxSeedLengthExceeded", "MissingAccount", "MissingRequiredSignature", "ModifiedProgramId",
    "NotEnoughAccountKeys", "PrivilegeEscalation", "ProgramEnvironmentSetupFailure", "ProgramFailedToCompile",
    "ProgramFailedToComplete", "ReadonlyDataModified", "ReadonlyLamportChange", "ReentrancyNotAllowed",
    "RentEpochModified", "UnbalancedInstruction", "UninitializedAccount", "UnsupportedProgramId", "UnsupportedSysvar",
]);
function conflict() {
    throw new ApnError("APN_OPERATION_BLOCKED", "Finalized stable Orca receipt conflicts with the saved operation.", { reason: "orca_stable_receipt_conflict" });
}
//# sourceMappingURL=stable-receipt.js.map