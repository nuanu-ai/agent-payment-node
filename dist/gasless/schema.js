import { z } from "zod";
import { gaslessAddress, gaslessIso, gaslessUint } from "./validation.js";
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const wordSchema = z.string().regex(/^0x[a-f0-9]{64}$/u);
export const hexSchema = z.string().regex(/^0x(?:[a-f0-9]{2})*$/u).max(32_770);
export const uintSchema = z.string().refine((v) => { try {
    return gaslessUint(v) >= 0n;
}
catch {
    return false;
} });
export const addressSchema = z.string().refine((v) => { try {
    return gaslessAddress(v) === v;
}
catch {
    return false;
} });
export const isoSchema = z.string().refine((v) => { try {
    return gaslessIso(v) === v;
}
catch {
    return false;
} });
export const chainSchema = z.union([z.literal(1), z.literal(10), z.literal(130), z.literal(137),
    z.literal(8453), z.literal(42161), z.literal(43114)]);
export const reasonSchema = z.string().regex(/^gasless_[a-z0-9_]{1,87}$/u);
export const originSchema = z.string().max(256).refine((v) => {
    try {
        const u = new URL(v);
        return u.protocol === "https:" && u.origin === v && !u.username && !u.password;
    }
    catch {
        return false;
    }
});
export const blockSchema = z.strictObject({ numberAtomic: uintSchema, hash: wordSchema, timestampAtomic: uintSchema });
export const ownerSchema = z.strictObject({ profile: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u),
    profileHash: hashSchema, address: addressSchema, walletBindingHash: hashSchema, walletCreatedAt: isoSchema });
export const providerBindingSchema = z.strictObject({ providerId: z.literal("local"), accountBindingHash: hashSchema,
    capabilityHash: hashSchema, revision: z.number().int().positive().safe() });
export const requestSchema = z.strictObject({ chainId: chainSchema, recipient: addressSchema,
    grossAtomic: uintSchema, maxFeeAtomic: uintSchema, minReceivedAtomic: uintSchema });
// Shape only: `validateGaslessIntent` re-validates the whole domain against the registry row the intent names,
// so a stored record can never carry a token name or permit-domain version the row does not admit.
export const tokenDomainSchema = z.strictObject({ name: z.string().min(1).max(64), version: z.string().min(1).max(16),
    chainId: chainSchema, verifyingContract: addressSchema, domainSeparator: wordSchema });
export const gasSchema = z.strictObject({ verificationGasLimit: uintSchema, callGasLimit: uintSchema,
    paymasterVerificationGasLimit: uintSchema, paymasterPostOpGasLimit: uintSchema, preVerificationGas: uintSchema,
    maxFeePerGas: uintSchema, maxPriorityFeePerGas: uintSchema });
export const feeConfigurationSchema = z.strictObject({ additionalGasCharge: uintSchema, feeSpread: uintSchema,
    nativeTokenPrice: uintSchema });
const accountFields = { owner: addressSchema, balanceAtomic: uintSchema, nativeBalanceWei: uintSchema,
    allowanceAtomic: uintSchema, permitNonceAtomic: uintSchema, entryPointNonceAtomic: uintSchema,
    eoaNonceAtomic: uintSchema, pendingEoaNonceAtomic: uintSchema, delegation: z.enum(["empty", "expected"]) };
export const accountSchema = z.strictObject(accountFields);
export const snapshotSchema = z.strictObject({ ...accountFields, chainId: chainSchema,
    rpcOrigin: originSchema, rpcEndpointHash: hashSchema, bundlerOrigin: originSchema, bundlerEndpointHash: hashSchema,
    block: blockSchema, protocolHash: hashSchema, token: addressSchema, feeConfiguration: feeConfigurationSchema,
    baseFeePerGas: uintSchema, maxFeePerGas: uintSchema, maxPriorityFeePerGas: uintSchema });
export const intentSchema = z.strictObject({ wireVersion: z.enum(["apn.gasless-wire.v2", "apn.gasless-wire.v3", "apn.gasless-wire.v4"]).optional(),
    profile: ownerSchema.shape.profile, request: requestSchema,
    owner: ownerSchema, providerBinding: providerBindingSchema, initialSnapshot: snapshotSchema, gas: gasSchema,
    token: addressSchema, tokenDomain: tokenDomainSchema, paymaster: addressSchema, entryPoint: addressSchema,
    delegate: addressSchema, feeCapAtomic: uintSchema, recipientAtomic: uintSchema, callData: hexSchema,
    unsignedEnvelopeHash: hashSchema, preparedAt: isoSchema, expiresAt: isoSchema, policyHash: hashSchema });
export const estimateSchema = z.strictObject({ verificationGasLimit: uintSchema, callGasLimit: uintSchema,
    paymasterVerificationGasLimit: uintSchema, paymasterPostOpGasLimit: uintSchema, preVerificationGas: uintSchema,
    responseHash: hashSchema });
export const cursorSchema = z.strictObject({ startBlock: blockSchema, nextBlockAtomic: uintSchema,
    previousEndBlock: blockSchema.nullable() });
export const accountingSchema = z.strictObject({ success: z.boolean(),
    branch: z.enum(["sponsored", "post_op_reverted", "prefund_too_low"]), prefundAtomic: uintSchema,
    refundAtomic: uintSchema, feeAtomic: uintSchema, deliveredAtomic: uintSchema, logsHash: hashSchema });
export const settlementSchema = z.strictObject({ chainId: chainSchema, userOperationHash: wordSchema,
    transactionHash: wordSchema, block: blockSchema, safeBlock: blockSchema, outerSender: addressSchema,
    transactionProofHash: hashSchema, receiptHash: hashSchema, protocolHash: hashSchema,
    effectAccount: accountSchema, safeAccount: accountSchema, accounting: accountingSchema });
export const permissionInvalidationSchema = z.strictObject({ chainId: chainSchema, intentHash: hashSchema,
    bootstrapMaterialHash: hashSchema, protocolHash: hashSchema, safeBlock: blockSchema, headBlock: blockSchema,
    safeAccount: accountSchema, headAccount: accountSchema,
    userOperationMaterialHash: hashSchema.optional(), userOperationHash: wordSchema.optional() });
export const observationSourceSchema = z.strictObject({ policy: z.literal("apn.gasless.observation-rpc.v1"),
    environmentName: z.string().max(128).regex(/^APN_[A-Z0-9_]+_RPC_URL$/u),
    rpcOrigin: originSchema, rpcEndpointHash: hashSchema, intentHash: hashSchema, initialBlock: blockSchema });
export const observationSchema = z.strictObject({ status: z.enum(["not_found", "pending", "safe", "unresolved", "permissions_invalidated"]),
    transactionHash: wordSchema.nullable(), settlement: settlementSchema.nullable(), cursor: cursorSchema,
    evidenceHash: hashSchema.nullable(), reason: reasonSchema.nullable(),
    permissionInvalidation: permissionInvalidationSchema.optional(), source: observationSourceSchema.optional() });
export const consentSchema = z.strictObject({ policy: z.literal("apn.gasless.foreground-approval.v1"),
    fingerprint: hashSchema, approvedAt: isoSchema, expiresAt: isoSchema });
export const stateSchema = z.enum(["awaiting_approval", "execution_pending", "bootstrap_pending", "user_operation_pending",
    "submitted_pending", "unknown_finality", "included_success", "included_revert", "failed_effects_pending",
    "completed", "failed_before_effect", "failed_confirmed_revert", "failed_permissions_invalidated", "abandoned_unknown"]);
export const phaseSchema = z.enum(["unsealed", "signing_started", "sealed", "disclosure_started", "checked",
    "submitting", "submitted_pending", "unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"]);
const attemptSchema = z.union([z.literal(0), z.literal(1)]);
export const effectSchema = z.strictObject({ role: z.enum(["bootstrap", "user_operation"]), phase: phaseSchema,
    signingAttempts: attemptSchema, materialHash: hashSchema.nullable(), disclosureAttempts: attemptSchema,
    submissionAttempts: attemptSchema, userOperationHash: wordSchema.nullable(), estimate: estimateSchema.nullable(),
    signingStartedAt: isoSchema.nullable(), sealedAt: isoSchema.nullable(), disclosedAt: isoSchema.nullable(),
    submittedAt: isoSchema.nullable() });
const mutableFields = { state: stateSchema, approval: consentSchema.nullable(), bootstrap: effectSchema,
    userOperation: effectSchema, cursor: cursorSchema, observation: observationSchema.nullable(),
    settlement: settlementSchema.nullable(), failure: reasonSchema.nullable() };
export const transitionSchema = z.strictObject({ ...mutableFields, at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema });
export const operationSchema = z.strictObject({ ...mutableFields, schemaVersion: z.literal("apn.gasless-operation.v1"),
    kind: z.literal("gasless_transfer"), profileHash: hashSchema, operationId: hashSchema, idempotencyHash: hashSchema,
    requestHash: hashSchema, fingerprint: hashSchema, createdAt: isoSchema, updatedAt: isoSchema,
    terminal: z.boolean(), intent: intentSchema, transitions: z.array(transitionSchema).min(1).max(512), integrityHash: hashSchema });
//# sourceMappingURL=schema.js.map