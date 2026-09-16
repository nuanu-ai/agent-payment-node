/** Pure Circle V2 preparation to non-EVM source journal binding. No state or execution dependency. */
import { decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { getBase58Encoder } from "@solana/kit";
import { hashObject, sha256 } from "../canonical.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeIso, bridgeUint, BRIDGE_ZERO_WORD } from "./validation.js";
const route = "base_usdc_to_solana_usdc_circle_cctp_v2";
const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
function fail(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_journal_binding_${reason}`); }
function rawHash(value) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
        fail("hash");
    return value;
}
function digestHash(value) {
    if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
        fail("digest");
    return value.slice(7);
}
function frozen(value) {
    if (value === null || typeof value !== "object")
        return true;
    return Object.isFrozen(value) && Object.values(value).every(frozen);
}
export function bindCircleV2SourcePreparationToJournal(input) {
    const p = input.preparation;
    if (!frozen(p) || p.kind !== "circle_v2_base_source_preparation" || p.executionAdmitted !== false ||
        p.quoteAuthenticityVerified !== false || p.baseStateSourceVerified !== false || input.route !== route)
        fail("preparation_or_route");
    const { preparationDigest, ...body } = p;
    if (input.preparationDigest !== preparationDigest || digestHash(preparationDigest) !== hashObject(body))
        fail("preparation_integrity");
    const draftIntegrityHash = digestHash(p.draftIntegrityDigest);
    digestHash(p.quoteHash);
    if (input.draftIntegrityDigest !== p.draftIntegrityDigest)
        fail("draft_identity");
    const payer = bridgeAddress(input.payer), tx = p.transaction;
    if (tx.type !== "eip1559" || tx.chainId !== 8453 || bridgeAddress(tx.from) !== payer ||
        bridgeAddress(tx.to) !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || tx.valueAtomic !== "0")
        fail("envelope_identity");
    const data = bridgeHex(tx.data);
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: ABI, data });
    }
    catch {
        return fail("calldata");
    }
    if (decoded.functionName !== "depositForBurnWithHookAndFees" || !decoded.args)
        fail("method");
    const [amount, destinationDomain, mintRecipient, burnToken, destinationCaller, hookData, claim] = decoded.args;
    const signedQuote = bridgeHex(p.quote.signedQuote, 16 * 1024);
    if (bridgeAddress(p.quote.feeToken) !== BASE_USDC)
        fail("fee_token");
    const refund = bridgeAddress(p.sourceRefundAddress);
    if (destinationDomain !== 5 || bridgeAddress(burnToken) !== BASE_USDC ||
        bridgeHex(destinationCaller, 32, 32) !== BRIDGE_ZERO_WORD ||
        amount.toString() !== p.principalAtomic || bridgeHex(claim.signedQuote, 16 * 1024) !== signedQuote ||
        bridgeAddress(claim.refundAddress) !== refund ||
        bridgeHex(mintRecipient, 32, 32) !== `0x${Buffer.from(ataBytes(p.recipient.ata)).toString("hex")}` ||
        encodeFunctionData({ abi: ABI, functionName: decoded.functionName, args: decoded.args }).toLowerCase() !== data)
        fail("protocol_identity");
    const fee = bridgeUint(p.quote.feeTotalAtomic), principal = bridgeUint(p.principalAtomic, true);
    const maxAllowance = bridgeUint(p.maxAllowanceAtomic, true);
    if (fee >= principal || principal + fee !== bridgeUint(p.requiredUsdcDebitAtomic) ||
        maxAllowance < principal + fee || maxAllowance === (1n << 256n) - 1n ||
        bridgeUint(p.maximumNativeDebitWei) !== bridgeUint(tx.gasLimitAtomic, true) * bridgeUint(tx.maxFeePerGasWei, true) +
            bridgeUint(p.l1DataFeeUpperWei) + bridgeUint(p.operatorFeeUpperWei) ||
        bridgeUint(tx.maxPriorityFeePerGasWei) > bridgeUint(tx.maxFeePerGasWei))
        fail("amount_or_fees");
    const gas = bridgeUint(tx.gasLimitAtomic, true), maxFee = bridgeUint(tx.maxFeePerGasWei, true);
    if (gas * maxFee > (1n << 256n) - 1n)
        fail("native_debit");
    const claimedValidationHash = rawHash(input.admission.claimedValidationHash);
    if (input.admission.minFinalityThreshold !== 1000 && input.admission.minFinalityThreshold !== 2000)
        fail("finality");
    if (typeof input.admission.note !== "string" || input.admission.note.length < 1 || input.admission.note.length > 256)
        fail("note");
    const binding = {
        profileHash: rawHash(input.profileHash), operationId: rawHash(input.operationId), draftIntegrityHash,
        route, createdAt: bridgeIso(input.createdAt), maxSourceNativeDebitWei: p.maximumNativeDebitWei,
        sourceCall: { type: "eip1559", chainId: 8453, from: payer, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES,
            data, dataSha256: sha256(Buffer.from(data.slice(2), "hex")), valueAtomic: "0", nonceAtomic: bridgeUint(tx.nonceAtomic).toString(),
            gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: maxFee.toString(),
            maxPriorityFeePerGasAtomic: bridgeUint(tx.maxPriorityFeePerGasWei).toString(), accessList: [] },
        admissionProof: { kind: "synthetic_untrusted", claimedValidationHash, note: input.admission.note },
    };
    const protocolInputHash = hashObject({ version: "circle_v2_source_journal_binding_v1", preparationDigest,
        draftIntegrityHash, quoteHash: p.quoteHash, signedQuote, quoteExpiry: p.quote.expiry,
        recipient: p.recipient, principalAtomic: p.principalAtomic, requiredUsdcDebitAtomic: p.requiredUsdcDebitAtomic,
        maxAllowanceAtomic: maxAllowance.toString(),
        sourceRefundAddress: refund, hookData: bridgeHex(hookData), minFinalityThreshold: input.admission.minFinalityThreshold,
        l1DataFeeUpperWei: p.l1DataFeeUpperWei, operatorFeeUpperWei: p.operatorFeeUpperWei,
        sourceBlock: p.sourceBlock, preparedAt: p.preparedAt, expiresAt: p.expiresAt, sourceCall: binding.sourceCall });
    return Object.freeze({ binding: Object.freeze({ ...binding, sourceCall: Object.freeze(binding.sourceCall),
            admissionProof: Object.freeze(binding.admissionProof) }), protocolInputHash, executionAdmitted: false, provenance: "synthetic_untrusted" });
}
function ataBytes(ata) {
    try {
        const bytes = getBase58Encoder().encode(ata);
        if (bytes.length !== 32)
            fail("ata");
        return Uint8Array.from(bytes);
    }
    catch {
        return fail("ata");
    }
}
//# sourceMappingURL=circle-v2-source-journal.js.map