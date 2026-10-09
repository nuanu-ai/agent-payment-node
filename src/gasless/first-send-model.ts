import { z } from "zod";
import type { Address, Hex } from "../model.js";

export const FIRST_SEND_POLICY = "apn.gasless.sealed-first-send-approval.v1" as const;
export const FIRST_SEND_TTL_MS = 120_000;
export interface GaslessFirstSendApproval {
  readonly policy: typeof FIRST_SEND_POLICY;
  readonly operationId: string;
  readonly operationFingerprint: string;
  readonly profileHash: string;
  readonly envelopeHash: string;
  readonly bootstrapMaterialHash: string;
  readonly bootstrapEstimateHash: string;
  readonly userOperationMaterialHash: string;
  readonly userOperationHash: Hex;
  readonly owner: Address;
  readonly reservationId: string;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly activationDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly approvedAt: string;
  readonly approvalFingerprint: string;
  readonly approvalDigest: string;
}
const hash = z.string().regex(/^[a-f0-9]{64}$/u), iso = z.iso.datetime({ precision: 3 });
export const firstSendApprovalSchema = z.strictObject({ policy: z.literal(FIRST_SEND_POLICY),
  operationId: hash, operationFingerprint: hash, profileHash: hash, envelopeHash: hash,
  bootstrapMaterialHash: hash, bootstrapEstimateHash: hash, userOperationMaterialHash: hash,
  userOperationHash: z.string().regex(/^0x[a-f0-9]{64}$/u), owner: z.string(), reservationId: hash,
  policyDigest: hash, policyRevision: z.number().int().positive(), activationDigest: hash,
  issuedAt: iso, expiresAt: iso, approvedAt: iso, approvalFingerprint: hash, approvalDigest: hash });

