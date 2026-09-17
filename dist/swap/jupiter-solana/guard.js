import { canonicalJson, domainHash } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { associatedUsdc } from "../../solana/accounts.js";
import { ADDRESS_LOOKUP_TABLE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, atomic, canonicalAddress, COMPUTE_BUDGET_PROGRAM, invalid, JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, SYSTEM_PROGRAM, TOKEN_PROGRAM, validateProgramSnapshot, } from "./catalog.js";
/**
 * Validates every safely decodable outer envelope field, then refuses before signing because this
 * module does not guess the JUP6 route instruction/account ABI.
 */
export async function guardJupiterTransaction(envelope, quote, build, policy, snapshot) {
    validateProgramSnapshot(snapshot);
    if (build.requestId !== policy.requestId || build.swapTransaction !== envelope.transactionBase64 || build.lastValidBlockHeight !== policy.lastValidBlockHeight) {
        invalid("Jupiter requestId, transaction, or lifetime binding changed.");
    }
    if (!Number.isFinite(Date.parse(policy.now)) || new Date(policy.now).toISOString() !== policy.now || build.rfqExpiresAt !== null && build.rfqExpiresAt <= policy.now) {
        invalid("Jupiter RFQ order is expired or the guard time is invalid.");
    }
    if (envelope.feePayer !== policy.taker || envelope.signerCount !== 1)
        invalid("Jupiter taker, fee payer, or signer count changed.");
    if (envelope.blockhash !== policy.blockhash)
        invalid("Jupiter recent blockhash changed.");
    atomic(policy.lastValidBlockHeight);
    atomic(policy.maximumComputeUnitPriceMicroLamports, true);
    atomic(policy.maximumPriorityFeeLamports, true);
    atomic(policy.maximumTipLamports, true);
    atomic(policy.maximumPlatformFeeAtomic, true);
    atomic(policy.maximumReferralFeeAtomic, true);
    atomic(policy.maximumRentLamports, true);
    const maximumSpend = atomic(policy.maximumWrappedSolSpendLamports);
    const exactInput = atomic(policy.exactInputLamports);
    const minimumOutput = atomic(policy.minimumOutputAtomic);
    if (atomic(quote.inAmount) !== exactInput || atomic(quote.otherAmountThreshold) < minimumOutput || quote.slippageBps > policy.maximumSlippageBps) {
        invalid("Jupiter quote changed the exact input, minimum output, or slippage bound.");
    }
    if (maximumSpend < exactInput)
        invalid("Jupiter wrapped SOL spend cap is below exact input.");
    if (!Number.isSafeInteger(policy.maximumComputeUnits) || policy.maximumComputeUnits < 1 || policy.maximumComputeUnits > 1_400_000)
        invalid("Jupiter compute unit cap is invalid.");
    if (!Number.isSafeInteger(policy.maximumSlippageBps) || policy.maximumSlippageBps < 0 || policy.maximumSlippageBps > 10_000)
        invalid("Jupiter slippage cap is invalid.");
    if (!Array.isArray(policy.allowedTipAccounts) || policy.allowedTipAccounts.length > 16 ||
        new Set(policy.allowedTipAccounts).size !== policy.allowedTipAccounts.length)
        invalid("Jupiter tip account allowlist is invalid.");
    policy.allowedTipAccounts.forEach(canonicalTipAddress);
    if (await associatedUsdc(policy.recipient) !== policy.recipientTokenAccount)
        invalid("Jupiter recipient ATA derivation changed.");
    const accountMap = new Map(envelope.accounts.map((account) => [account.address, account]));
    const recipient = accountMap.get(policy.recipientTokenAccount);
    if (recipient === undefined || !recipient.writable || recipient.executable || recipient.signer)
        invalid("Jupiter recipient token account binding is invalid.");
    for (const table of envelope.addressTables)
        if (table.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM)
            invalid("Jupiter lookup table owner is invalid.");
    const routes = new Set(snapshot.entries.map((entry) => entry.programId));
    const routeLabels = new Map(snapshot.entries.map((entry) => [entry.programId, entry.label]));
    for (const leg of quote.routePlan) {
        if (routeLabels.get(leg.swapInfo.ammKey) !== leg.swapInfo.label)
            invalid("Jupiter quote route is absent from the frozen program-label snapshot.");
    }
    const allowed = new Set([JUPITER_V6_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM, TOKEN_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, ...routes]);
    let unitLimit = null, unitPrice = null, sawJupiter = false, tip = 0n;
    for (const instruction of envelope.instructions) {
        if (!allowed.has(instruction.programId))
            invalid("Jupiter transaction invokes an unpinned program.");
        if (instruction.programId === COMPUTE_BUDGET_PROGRAM) {
            const decoded = computeBudget(instruction);
            if (decoded.kind === "limit") {
                if (unitLimit !== null)
                    invalid("Jupiter compute unit limit is duplicated.");
                unitLimit = decoded.value;
            }
            else {
                if (unitPrice !== null)
                    invalid("Jupiter compute unit price is duplicated.");
                unitPrice = decoded.value;
            }
        }
        else if (instruction.programId === SYSTEM_PROGRAM)
            tip += systemTip(instruction, policy);
        else if (instruction.programId === ASSOCIATED_TOKEN_PROGRAM)
            validateAtaCreate(instruction, policy);
        else if (instruction.programId === TOKEN_PROGRAM)
            validateTokenCleanup(instruction, policy);
        else if (instruction.programId === JUPITER_V6_PROGRAM)
            sawJupiter = true;
        else if (routes.has(instruction.programId))
            invalid("Top-level route-program instructions are not covered by the pinned JUP6 decoder.");
    }
    if (!sawJupiter)
        invalid("Jupiter V6 instruction is absent.");
    if (unitLimit === null || unitLimit > BigInt(policy.maximumComputeUnits))
        invalid("Jupiter compute unit limit exceeds policy.");
    const price = unitPrice ?? 0n;
    if (price > atomic(policy.maximumComputeUnitPriceMicroLamports, true))
        invalid("Jupiter compute unit price exceeds policy.");
    const priority = (unitLimit * price + 999999n) / 1000000n;
    if (priority > atomic(policy.maximumPriorityFeeLamports, true) || tip > atomic(policy.maximumTipLamports, true))
        invalid("Jupiter priority fee or tip exceeds policy.");
    if (atomic(build.prioritizationFeeLamports, true) !== priority || atomic(build.tipLamports, true) !== tip ||
        atomic(build.rentFeeLamports, true) > atomic(policy.maximumRentLamports, true) ||
        atomic(build.platformFeeAtomic, true) > atomic(policy.maximumPlatformFeeAtomic, true) ||
        atomic(build.referralFeeAtomic, true) > atomic(policy.maximumReferralFeeAtomic, true))
        invalid("Jupiter build fee fields do not match the transaction or policy caps.");
    const binding = { requestId: policy.requestId, quoteHash: quote.responseHash, transactionHash: envelope.transactionHash,
        messageHash: envelope.messageHash, lookupBindingDigest: envelope.lookupBindingDigest, blockhash: envelope.blockhash,
        lastValidBlockHeight: policy.lastValidBlockHeight, rfqExpiresAt: build.rfqExpiresAt, taker: policy.taker, recipient: policy.recipient,
        recipientTokenAccount: policy.recipientTokenAccount,
        inputMint: quote.inputMint, outputMint: quote.outputMint, inputAmount: quote.inAmount, minimumOutput: quote.otherAmountThreshold,
        policyMinimumOutput: policy.minimumOutputAtomic, maximumSlippageBps: policy.maximumSlippageBps,
        computeUnitLimit: unitLimit.toString(), computeUnitPriceMicroLamports: price.toString(), priorityFeeLamports: priority.toString(),
        tipLamports: tip.toString(), programSnapshotDigest: snapshot.digest,
        maximumPlatformFeeAtomic: policy.maximumPlatformFeeAtomic, maximumReferralFeeAtomic: policy.maximumReferralFeeAtomic,
        maximumRentLamports: policy.maximumRentLamports, maximumWrappedSolSpendLamports: policy.maximumWrappedSolSpendLamports };
    return Object.freeze({ signable: false, code: "JUPITER_V6_INSTRUCTION_UNVERIFIED", bindingHash: domainHash("apn.jupiter-guard-binding.v1", canonicalJson(binding)),
        reason: "The pinned JUP6 instruction and account ABI is unavailable; the transaction is refused before signing." });
}
function computeBudget(instruction) {
    if (instruction.accounts.length !== 0)
        invalid("Jupiter compute budget instruction has accounts.");
    const data = Buffer.from(instruction.data);
    if (data.length === 5 && data[0] === 2)
        return { kind: "limit", value: BigInt(data.readUInt32LE(1)) };
    if (data.length === 9 && data[0] === 3)
        return { kind: "price", value: data.readBigUInt64LE(1) };
    return invalid("Jupiter compute budget instruction is unknown.");
}
function systemTip(instruction, policy) {
    const data = Buffer.from(instruction.data);
    if (data.length !== 12 || data.readUInt32LE(0) !== 2 || instruction.accounts.length !== 2 ||
        instruction.accounts[0]?.address !== policy.taker || !instruction.accounts[0]?.signer || !instruction.accounts[0]?.writable ||
        !policy.allowedTipAccounts.includes(instruction.accounts[1].address) || !instruction.accounts[1]?.writable)
        invalid("Jupiter system instruction is not an allowed exact tip.");
    return data.readBigUInt64LE(4);
}
function validateAtaCreate(instruction, policy) {
    const data = Buffer.from(instruction.data);
    if (!(data.length === 1 && data[0] === 1) || instruction.accounts.length !== 6 || instruction.accounts[0]?.address !== policy.taker ||
        !instruction.accounts[0]?.signer || !instruction.accounts[0]?.writable || instruction.accounts[1]?.address !== policy.recipientTokenAccount ||
        !instruction.accounts[1]?.writable || instruction.accounts[2]?.address !== policy.recipient ||
        instruction.accounts[3]?.address !== SOLANA_USDC_MINT || instruction.accounts[4]?.address !== SYSTEM_PROGRAM ||
        instruction.accounts[5]?.address !== TOKEN_PROGRAM)
        invalid("Jupiter associated token instruction is not a bound idempotent create.");
}
function validateTokenCleanup(instruction, policy) {
    const data = Buffer.from(instruction.data);
    const opcode = data[0];
    if (data.length !== 1 || opcode !== 9 && opcode !== 17)
        invalid("Jupiter top-level token instruction is unknown.");
    if (opcode === 9 && (instruction.accounts.length !== 3 || instruction.accounts[1]?.address !== policy.taker || instruction.accounts[2]?.address !== policy.taker))
        invalid("Jupiter token close destination or authority changed.");
    if (opcode === 17 && instruction.accounts.length !== 1)
        invalid("Jupiter sync-native instruction is invalid.");
}
export function assertJupiterSignable(value) {
    throw new ApnError("APN_PROVIDER_CAPABILITY_UNAVAILABLE", value.reason, { nextActions: ["Install a reviewed official JUP6 instruction/account codec before enabling signing."] });
}
function canonicalTipAddress(value) {
    if (typeof value !== "string")
        invalid("Jupiter tip account allowlist is invalid.");
    canonicalAddress(value);
}
//# sourceMappingURL=guard.js.map