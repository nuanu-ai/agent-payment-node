/** Composed Circle V2 inspection artifact. It has no submission or persistence path. */
import { createHash } from "node:crypto";
import { inspectCircleV2Preflight, type CircleV2PreflightInput, type CircleV2PreflightTransport } from "./circle-v2-preflight.js";
import { inspectCircleV2UpfrontOffline } from "./circle-v2-upfront-offline.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord } from "./validation.js";

export interface CircleV2DraftInput extends CircleV2PreflightInput { readonly executable?: false }
export interface CircleV2PreflightedDraft {
  readonly kind: "circle_v2_preflighted_draft";
  readonly state: "preflighted_unsubmitted";
  readonly executionAdmitted: false;
  readonly sourceChainId: 8453;
  readonly sourcePayer: string;
  readonly sourceTransaction: { readonly to: string; readonly data: string; readonly valueAtomic: "0"; readonly refundAddress: string };
  readonly quoteEndpoint: string;
  readonly quoteRequest: unknown;
  readonly quoteResponse: unknown;
  readonly recipientWallet: string;
  readonly recipientAta: string;
  readonly recipientSetup: "existing_ata" | "create_ata";
  readonly amountAtomic: string;
  readonly quotedFeeAtomic: string;
  readonly maxSourceFeeAtomic: string;
  readonly preflight: { readonly blockNumber: string; readonly blockHash: string; readonly abiSignature: string };
  /** SHA-256 over canonical JSON of all other draft fields, excluding integrityDigest. */
  readonly integrityDigest: string;
  readonly blockers: readonly string[];
}
function fail(reason: string): never { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_draft_${reason}`); }
function jsonCopy(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("json_number"); return value; }
  if (Array.isArray(value)) return value.map(jsonCopy);
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("json_value");
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") fail("json_key");
    result[key] = jsonCopy((value as Record<string, unknown>)[key]);
  }
  return result;
}
function canonical(value: unknown): string { return JSON.stringify(jsonCopy(value)); }

/** The returned data is an unsubmitted inspection record; callers must re-preflight before any later submission. */
export async function inspectCircleV2PreflightedDraft(input: CircleV2DraftInput, transport: CircleV2PreflightTransport): Promise<CircleV2PreflightedDraft> {
  if ((input as { executable?: unknown }).executable !== undefined ||
      (input as { executionAdmitted?: unknown }).executionAdmitted !== undefined) fail("executable_flag");
  const tx = bridgeRecord(input.transaction);
  if (tx.executable !== undefined || tx.executionAdmitted !== undefined) fail("executable_flag");
  const payer = bridgeAddress(input.payer);
  if (tx.from !== undefined && bridgeAddress(tx.from) !== payer) fail("payer_mismatch");
  const snapshot = jsonCopy(input) as CircleV2PreflightInput;
  const preflight = await inspectCircleV2Preflight(snapshot, transport);
  const upfront = await inspectCircleV2UpfrontOffline({ ...snapshot, sourceBlockNumber: preflight.blockNumber });
  const frozenTx = bridgeRecord(snapshot.transaction);
  const blockers = [
    "The quote and validation response are synthetic or externally supplied; remote schema behavior is not established by this artifact",
    "Recipient ATA existence or setup execution is not observed",
    "Source submission, source receipt, Circle attestation, and destination mint are not observed",
    "The Base block and quote may expire; revalidate immediately before any separately authorized submission",
  ] as const;
  const fields = {
    kind: "circle_v2_preflighted_draft" as const, state: "preflighted_unsubmitted" as const,
    executionAdmitted: false as const, sourceChainId: 8453 as const, sourcePayer: payer,
    sourceTransaction: { to: bridgeAddress(frozenTx.to), data: bridgeHex(frozenTx.data), valueAtomic: "0" as const,
      refundAddress: bridgeAddress(frozenTx.refundAddress) },
    quoteEndpoint: snapshot.quoteEndpoint, quoteRequest: snapshot.quoteRequest, quoteResponse: snapshot.quoteResponse,
    recipientWallet: snapshot.recipientWallet, recipientAta: upfront.recipientAta, recipientSetup: upfront.recipientSetup,
    amountAtomic: upfront.amountAtomic, quotedFeeAtomic: upfront.quotedFeeAtomic,
    maxSourceFeeAtomic: snapshot.maxSourceFeeAtomic,
    preflight: { blockNumber: preflight.blockNumber, blockHash: preflight.blockHash, abiSignature: preflight.abiSignature },
    blockers,
  };
  return { ...fields, integrityDigest: `sha256:${createHash("sha256").update(canonical(fields)).digest("hex")}` };
}
