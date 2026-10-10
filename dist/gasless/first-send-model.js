import { z } from "zod";
export const FIRST_SEND_POLICY = "apn.gasless.sealed-first-send-approval.v1";
export const FIRST_SEND_TTL_MS = 120_000;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), iso = z.iso.datetime({ precision: 3 });
export const firstSendApprovalSchema = z.strictObject({ policy: z.literal(FIRST_SEND_POLICY),
    operationId: hash, operationFingerprint: hash, profileHash: hash, envelopeHash: hash,
    bootstrapMaterialHash: hash, bootstrapEstimateHash: hash, userOperationMaterialHash: hash,
    userOperationHash: z.string().regex(/^0x[a-f0-9]{64}$/u), owner: z.string(), reservationId: hash,
    policyDigest: hash, policyRevision: z.number().int().positive(), activationDigest: hash,
    issuedAt: iso, expiresAt: iso, approvedAt: iso, approvalFingerprint: hash, approvalDigest: hash });
//# sourceMappingURL=first-send-model.js.map