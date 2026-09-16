/** Durable, deliberately non-executable intent for the first two non-EVM destinations.
 * This module is not imported by bridge preparation or execution.
 */
import { hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { solanaAddress } from "../solana/rpc.js";
import { tronAddress } from "../tron/codec.js";
import { z } from "zod";
import { BASE_SOLANA_CIRCLE_V2_CANDIDATE, BASE_TRON_USDT_CANDIDATE } from "./discovery-candidates.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";
import { addressSchema, hashSchema, hexSchema, isoSchema, opaqueSchema, uintSchema, wordSchema } from "./schema.js";
import { BRIDGE_DIAMOND, bridgeFailure } from "./validation.js";
const positive = uintSchema.refine((v) => BigInt(v) > 0n);
const solanaRecipient = z.string().refine((v) => { try {
    return solanaAddress(v) === v;
}
catch {
    return false;
} });
const tronRecipient = z.string().refine((v) => { try {
    return tronAddress(v) === v;
}
catch {
    return false;
} });
const source = z.strictObject({
    chainId: z.literal(8453), token: z.literal(BASE_SOLANA_CIRCLE_V2_CANDIDATE.fromToken),
    owner: addressSchema, amountAtomic: positive,
});
const sourceCall = z.strictObject({ chainId: z.literal(8453), from: addressSchema,
    to: addressSchema, valueAtomic: uintSchema, data: hexSchema, dataSha256: hashSchema });
const common = {
    schemaVersion: z.literal("apn.non-evm-bridge-operation.v2"), kind: z.literal("non_evm_bridge_intent"),
    executionAdmitted: z.literal(false), state: z.literal("unchecked_draft"),
    sourceCallValidation: z.literal("unchecked"),
    profileHash: hashSchema, operationId: hashSchema, requestHash: hashSchema,
    createdAt: isoSchema, expiresAt: isoSchema, source, sourceCall,
    maxSourceNativeDebitWei: positive, maxProviderFeeAtomic: uintSchema,
    integrityHash: hashSchema,
};
const circle = z.strictObject({ ...common, route: z.literal("base_usdc_to_solana_usdc_circle_cctp_v2"),
    destination: z.strictObject({ chain: z.literal("solana-mainnet"),
        token: z.literal(BASE_SOLANA_CIRCLE_V2_CANDIDATE.toToken), recipient: solanaRecipient,
        minimumReceivedAtomic: positive }),
    provider: z.strictObject({ kind: z.literal("circle_cctp_v2"), feeQuoteHash: hashSchema,
        requestId: opaqueSchema, sourceDomain: z.literal(6), destinationDomain: z.literal(5) }),
});
const near = z.strictObject({ ...common, route: z.literal("base_usdc_to_tron_usdt_lifi_near_intents"),
    destination: z.strictObject({ chainId: z.literal(BASE_TRON_USDT_CANDIDATE.toChainId),
        token: z.literal(BASE_TRON_USDT_CANDIDATE.toToken), recipient: tronRecipient,
        minimumReceivedAtomic: positive }),
    provider: z.strictObject({ kind: z.literal("lifi_near_intents"), quoteHash: hashSchema,
        routeId: opaqueSchema, stepId: opaqueSchema, transactionId: wordSchema, quoteId: wordSchema,
        depositAddress: addressSchema }),
});
export const nonEvmOperationSchema = z.discriminatedUnion("route", [circle, near]);
function corrupt() { return bridgeFailure("APN_STATE_CORRUPT", "non_evm_bridge_contract"); }
export function validateNonEvmBridgeOperation(value) {
    const parsed = nonEvmOperationSchema.safeParse(value);
    if (!parsed.success)
        corrupt();
    const op = parsed.data, { integrityHash, ...body } = op;
    if (integrityHash !== hashObject(body) || Date.parse(op.expiresAt) <= Date.parse(op.createdAt) ||
        op.sourceCall.chainId !== op.source.chainId || op.sourceCall.from !== op.source.owner ||
        BigInt(op.sourceCall.valueAtomic) > BigInt(op.maxSourceNativeDebitWei))
        corrupt();
    if (op.sourceCall.dataSha256 !== sha256(Buffer.from(op.sourceCall.data.slice(2), "hex")))
        corrupt();
    if (op.route === "base_usdc_to_solana_usdc_circle_cctp_v2") {
        if (op.sourceCall.to !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || op.sourceCall.valueAtomic !== "0" ||
            !op.sourceCall.data.startsWith("0xc62fa55e") || op.sourceCall.data.length < 10 + 64 * 7 ||
            BigInt(op.destination.minimumReceivedAtomic) > BigInt(op.source.amountAtomic))
            corrupt();
    }
    else if (op.sourceCall.to !== BRIDGE_DIAMOND || op.sourceCall.valueAtomic !== "0" ||
        !op.sourceCall.data.startsWith("0x3110c7b9") || op.sourceCall.data.length < 10 + 64 * 3)
        corrupt();
    return op;
}
export function freezeNonEvmBridgeOperation(input) {
    return validateNonEvmBridgeOperation({ ...input, integrityHash: hashObject(input) });
}
/** Separate immutable namespace; no bridge_route operation can be read from here. */
export class NonEvmBridgeOperationRepository extends SecureStateStore {
    async save(op) {
        validateNonEvmBridgeOperation(op);
        await this.initialize();
        await this.withLocks([`profile:${op.profileHash}`, `operation:${op.operationId}`], async () => {
            const previous = await this.load(op.profileHash, op.operationId);
            if (previous !== null) {
                if (previous.integrityHash !== op.integrityHash)
                    corrupt();
                return;
            }
            await this.ensureDirectory(`non-evm-bridge-operations/${op.profileHash}`);
            await this.writeJson(this.path(op.profileHash, op.operationId), op);
        });
    }
    async load(profileHash, operationId) {
        const value = await this.readJson(this.path(profileHash, operationId));
        if (value === null)
            return null;
        const op = validateNonEvmBridgeOperation(value);
        if (op.profileHash !== profileHash || op.operationId !== operationId)
            corrupt();
        return op;
    }
    path(profileHash, operationId) {
        stateIdentifier(profileHash, "non-EVM bridge profile");
        stateIdentifier(operationId, "non-EVM bridge operation");
        return `non-evm-bridge-operations/${profileHash}/${operationId}.json`;
    }
}
//# sourceMappingURL=non-evm-operation.js.map