import { z } from "zod";
import { addressSchema, blockSchema, hashSchema, isoSchema, originSchema, ownerSchema, providerBindingSchema, uintSchema, wordSchema } from "../gasless/schema.js";
import { FACILITATOR_HISTORY_LIMIT, FACILITATOR_KIND, FACILITATOR_OPERATION_VERSION, FACILITATOR_POLICY, FACILITATOR_STATES } from "./operation-model.js";
import { AVALANCHE_FACILITATOR as R } from "./registry.js";
const lowerAddress = z.string().regex(/^0x[0-9a-f]{40}$/u);
const positive = z.string().regex(/^[1-9][0-9]{0,77}$/u);
const requirementSchema = z.strictObject({ scheme: z.literal("exact"), network: z.literal(R.network), amount: positive,
    asset: z.literal(R.token), payTo: lowerAddress, maxTimeoutSeconds: z.literal(R.maxTimeoutSeconds),
    extra: z.strictObject({ assetTransferMethod: z.literal("eip3009"), name: z.literal(R.tokenDomain.name),
        version: z.literal(R.tokenDomain.version) }) });
const requestSchema = z.strictObject({ chainId: z.literal(R.chainId), recipient: addressSchema, grossAtomic: uintSchema,
    maxFeeAtomic: uintSchema, minReceivedAtomic: uintSchema });
const intentSchema = z.strictObject({ profile: ownerSchema.shape.profile, request: requestSchema, owner: ownerSchema,
    providerBinding: providerBindingSchema, requirement: requirementSchema, requirementHash: hashSchema,
    facilitator: z.strictObject({ origin: originSchema, endpointHash: hashSchema, signers: z.array(lowerAddress).min(1).max(8),
        supportedResponseHash: hashSchema }),
    initial: z.strictObject({ block: blockSchema, balanceAtomic: uintSchema, rpcOrigin: originSchema, rpcEndpointHash: hashSchema }),
    preparedAt: isoSchema, expiresAt: isoSchema, policyHash: hashSchema });
const authorizationSchema = z.strictObject({ from: lowerAddress, to: lowerAddress, value: positive, validAfter: z.literal("0"),
    validBefore: positive, nonce: wordSchema });
const signedSchema = z.strictObject({ authorization: authorizationSchema, digest: wordSchema, startBlock: blockSchema,
    signatureHash: hashSchema.nullable() });
const exchangeSchema = z.strictObject({ startedAt: isoSchema, responseHash: hashSchema.nullable(), transactionHash: wordSchema.nullable(),
    outcome: z.enum(["accepted", "pending", "rejected", "unknown"]) });
const observationSchema = z.strictObject({ observedAt: isoSchema, rpcOrigin: originSchema, rpcEndpointHash: hashSchema,
    finalized: blockSchema, authorizationUsed: z.boolean(), transactionHash: wordSchema.nullable() });
const settlementSchema = z.strictObject({ transactionHash: wordSchema, block: blockSchema, finalized: blockSchema,
    receiptHash: hashSchema, deliveredAtomic: positive, rpcOrigin: originSchema, rpcEndpointHash: hashSchema, observedAt: isoSchema });
const consentSchema = z.strictObject({ policy: z.literal(FACILITATOR_POLICY), fingerprint: hashSchema, approvedAt: isoSchema,
    expiresAt: isoSchema });
const mutableFields = { state: z.enum(FACILITATOR_STATES), approval: consentSchema.nullable(), signed: signedSchema.nullable(),
    verify: exchangeSchema.nullable(), settle: exchangeSchema.nullable(), observation: observationSchema.nullable(),
    settlement: settlementSchema.nullable(), failure: z.string().regex(/^facilitator_gasless_[a-z0-9_]{1,80}$/u).nullable() };
export const facilitatorOperationSchema = z.strictObject({ ...mutableFields, schemaVersion: z.literal(FACILITATOR_OPERATION_VERSION),
    kind: z.literal(FACILITATOR_KIND), profileHash: hashSchema, operationId: hashSchema, idempotencyHash: hashSchema,
    requestHash: hashSchema, fingerprint: hashSchema, createdAt: isoSchema, updatedAt: isoSchema, terminal: z.boolean(),
    intent: intentSchema,
    transitions: z.array(z.strictObject({ ...mutableFields, at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema }))
        .min(1).max(FACILITATOR_HISTORY_LIMIT),
    integrityHash: hashSchema });
//# sourceMappingURL=schema.js.map