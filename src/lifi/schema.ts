import { z } from "zod";
import { bridgeAddress, bridgeIso, bridgeUint } from "./validation.js";

export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const hexSchema = z.string().regex(/^0x(?:[a-f0-9]{2})*$/u).max(24_578);
export const wordSchema = z.string().regex(/^0x[a-f0-9]{64}$/u);
export const uintSchema = z.string().refine((v) => { try { return bridgeUint(v) >= 0n; } catch { return false; } });
export const addressSchema = z.string().refine((v) => { try { return bridgeAddress(v) === v; } catch { return false; } });
export const isoSchema = z.string().refine((v) => { try { return bridgeIso(v) === v; } catch { return false; } });
export const chainSchema = z.union([z.literal(1), z.literal(8453), z.literal(42161)]);
export const toolSchema = z.enum(["across", "stargateV2"]);
export const opaqueSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/u);
export const reasonSchema = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/u);
export const originSchema = z.string().max(256).refine((v) => { try { const u = new URL(v); return u.protocol === "https:" && u.origin === v && !u.username && !u.password; } catch { return false; } });
export const blockSchema = z.strictObject({ numberAtomic: uintSchema, hash: wordSchema, timestampAtomic: uintSchema });
export const ownerSchema = z.strictObject({ profile: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u), profileHash: hashSchema,
  address: addressSchema, walletBindingHash: hashSchema, walletCreatedAt: isoSchema });
export const providerBindingSchema = z.strictObject({ providerId: z.literal("local"), accountBindingHash: hashSchema, capabilityHash: hashSchema, revision: z.number().int().positive().safe() });
export const requestSchema = z.strictObject({ fromChainId: chainSchema, toChainId: chainSchema, fromToken: addressSchema,
  toToken: addressSchema, amountAtomic: uintSchema, recipient: addressSchema, minOutputAtomic: uintSchema,
  maxNativeDebitWei: uintSchema, maxRouteFeeAtomic: uintSchema, slippageBps: z.number().int().min(0).max(1000) });
export const feeSchema = z.strictObject({ name: z.string().min(1).max(192), chainId: chainSchema,
  asset: z.union([addressSchema, z.literal("native")]), amountAtomic: uintSchema, included: z.boolean() });
export const transactionSchema = z.strictObject({ chainId: chainSchema, from: addressSchema, to: addressSchema,
  valueAtomic: uintSchema, data: hexSchema, gasLimitAtomic: uintSchema });
export const materializationSchema = z.strictObject({ routeId: opaqueSchema, stepId: opaqueSchema, tool: toolSchema,
  request: requestSchema, sender: addressSchema, approvalAddress: addressSchema, quotedOutputAtomic: uintSchema,
  minimumOutputAtomic: uintSchema, feeCosts: z.array(feeSchema).max(16), includedStepIdentities: z.array(hashSchema).max(8),
  transaction: transactionSchema, requestHash: hashSchema, responseHash: hashSchema, routeHash: hashSchema,
  stepHash: hashSchema, materializedStepHash: hashSchema, transactionDigest: hashSchema });
export const deploymentSchema = z.strictObject({ chainId: chainSchema, peerChainId: chainSchema, tool: toolSchema,
  block: blockSchema, rpcOrigin: originSchema, contractHash: hashSchema, codeHash: hashSchema, configurationHash: hashSchema });
export const accountSchema = z.strictObject({ chainId: chainSchema, rpcOrigin: originSchema, block: blockSchema,
  owner: addressSchema, token: addressSchema, spender: addressSchema, balanceAtomic: uintSchema, nativeBalanceWei: uintSchema,
  allowanceAtomic: uintSchema, latestNonceAtomic: uintSchema, pendingNonceAtomic: uintSchema });
export const economicsSchema = z.strictObject({ nonceAtomic: uintSchema, gasLimitAtomic: uintSchema,
  maxFeePerGasAtomic: uintSchema, maxPriorityFeePerGasAtomic: uintSchema, maximumGasCostAtomic: uintSchema });
export const feeQuoteSchema = z.strictObject({ chainId: chainSchema, feeModel: z.literal("arbitrum-inclusive").optional(),
  blockNumberAtomic: uintSchema, blockHash: wordSchema, observedAt: isoSchema, rpcOrigin: originSchema, l1DataFeeUpperWei: uintSchema, operatorFeeUpperWei: uintSchema,
  maximumExecutionFeeWei: uintSchema, totalQuoteWei: uintSchema, totalFeeEnforcedOnchain: z.literal(false) });
export const feeCeilingSchema = z.strictObject({ policy: z.literal("apn.bridge-fee-headroom.v1"),
  headroomBps: z.number().int().min(0).max(10_000), quotedMaxFeePerGasAtomic: uintSchema, quotedMaxPriorityFeePerGasAtomic: uintSchema });
export const envelopeSchema = z.strictObject({ role: z.enum(["approval", "bridge"]), chainId: chainSchema, from: addressSchema,
  to: addressSchema, valueAtomic: uintSchema, data: hexSchema, economics: economicsSchema, feeQuote: feeQuoteSchema,
  provisionalGas: z.boolean(), feeCeiling: feeCeilingSchema, envelopeHash: hashSchema });
export const txProofSchema = z.strictObject({ chainId: chainSchema, transactionHash: wordSchema, block: blockSchema,
  safeBlock: blockSchema.nullable(), rpcOrigin: originSchema, from: addressSchema, to: addressSchema,
  nonceAtomic: uintSchema, valueAtomic: uintSchema, dataHash: hashSchema, gasLimitAtomic: uintSchema,
  maxFeePerGasAtomic: uintSchema, maxPriorityFeePerGasAtomic: uintSchema, gasUsedAtomic: uintSchema,
  effectiveGasPriceAtomic: uintSchema, executionFeeWei: uintSchema, l1DataFeeWei: uintSchema,
  operatorFeeWei: uintSchema, blobFeeWei: uintSchema, actualTotalFeeWei: uintSchema,
  feeEvidence: z.strictObject({ receiptHash: hashSchema, ruleHash: hashSchema, arbitrumPosterGasAtomic: uintSchema.nullable(),
    baseOracle: z.strictObject({ oracle: addressSchema, from: addressSchema, callData: hexSchema, rawReturn: wordSchema,
      blockHash: wordSchema, requireCanonical: z.literal(true), version: z.literal("1.6.0"), regime: z.literal("jovian"), scalarAtomic: uintSchema, constantWei: uintSchema }).nullable() }),
  status: z.enum(["success", "reverted"]), logsHash: hashSchema });
const acrossCorrelationSchema = z.strictObject({ kind: z.literal("across"), depositId: uintSchema, originChainId: chainSchema,
  destinationChainId: chainSchema, inputToken: wordSchema, outputToken: wordSchema, inputAmountAtomic: uintSchema,
  outputAmountAtomic: uintSchema, depositor: wordSchema, recipient: wordSchema, exclusiveRelayer: wordSchema,
  quoteTimestamp: uintSchema, fillDeadline: uintSchema, exclusivityDeadline: uintSchema, message: z.literal("0x") });
const stargateCorrelationSchema = z.strictObject({ kind: z.literal("stargateV2"), guid: wordSchema,
  sourceEid: z.number().int().positive().safe(), destinationEid: z.number().int().positive().safe(), sender: addressSchema,
  recipient: addressSchema, amountSentAtomic: uintSchema, amountReceivedAtomic: uintSchema });
export const sourceProofSchema = z.strictObject({ tool: toolSchema, chainId: chainSchema, transactionHash: wordSchema,
  blockNumberAtomic: uintSchema, blockHash: wordSchema, sourceAmountAtomic: uintSchema, bridgeAmountAtomic: uintSchema,
  feeForwardedAtomic: uintSchema, logsHash: hashSchema, correlation: z.union([acrossCorrelationSchema, stargateCorrelationSchema]) });
export const destinationProofSchema = z.strictObject({ tool: toolSchema, chainId: chainSchema, transactionHash: wordSchema,
  blockNumberAtomic: uintSchema, blockHash: wordSchema, recipient: addressSchema, token: addressSchema, amountAtomic: uintSchema,
  correlationHash: hashSchema, logsHash: hashSchema, fillType: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  relayerCredit: wordSchema.nullable(), repaymentChainIdAtomic: uintSchema.nullable(),
  safeBlock: blockSchema, rpcOrigin: originSchema, transactionProofHash: hashSchema });
export const scanSchema = z.strictObject({ startBlock: blockSchema, nextBlockAtomic: uintSchema, previousEndBlock: blockSchema.nullable() });
export const providerObservationSchema = z.strictObject({ status: z.enum(["not_found", "pending", "completed_observed", "partial_observed", "refund_observed", "failed_observed", "unknown"]),
  destinationTransactionHash: wordSchema.nullable(), observedAt: isoSchema, responseHash: hashSchema.nullable() });
export const failureSchema = z.strictObject({ reason: reasonSchema, residualAllowance: z.strictObject({ amountAtomic: uintSchema, block: blockSchema, rpcOrigin: originSchema }).nullable() });
export const consentSchema = z.strictObject({ policy: z.literal("apn.bridge.foreground-approval.v1"), fingerprint: hashSchema, approvedAt: isoSchema, expiresAt: isoSchema });
export const stateSchema = z.enum(["awaiting_approval", "execution_pending", "source_pending", "destination_pending", "unknown_finality", "completed", "failed_before_effect", "failed_after_approval", "failed_confirmed_revert"]);
export const phaseSchema = z.enum(["unsealed", "signing_started", "sealed", "submitting", "submitted_pending", "unknown_finality", "included_success", "included_revert", "safe_success", "safe_revert"]);
const effectFields = { role: z.enum(["approval", "bridge"]), phase: phaseSchema, transactionHash: wordSchema.nullable(),
  sealedMaterialHash: hashSchema.nullable(), submittedAt: isoSchema.nullable(), submissionAttempts: z.union([z.literal(0), z.literal(1)]), includedProof: txProofSchema.nullable(), safeProof: txProofSchema.nullable() };
export const effectSchema = z.strictObject({ ...effectFields, envelope: envelopeSchema });
const effectSnapshotSchema = z.strictObject({ ...effectFields, envelopeHash: hashSchema });
const mutableFields = { state: stateSchema, approval: consentSchema.nullable(), sourceProof: sourceProofSchema.nullable(),
  destinationProof: destinationProofSchema.nullable(), providerObservation: providerObservationSchema.nullable(),
  destinationScan: scanSchema, failure: failureSchema.nullable() };
export const transitionSchema = z.strictObject({ ...mutableFields, effects: z.array(effectSnapshotSchema).min(1).max(2),
  at: isoSchema, previousHash: hashSchema, transitionHash: hashSchema });
export const operationSchema = z.strictObject({ ...mutableFields, schemaVersion: z.literal("apn.bridge-operation.v1"), kind: z.literal("bridge_route"),
  profileHash: hashSchema, operationId: hashSchema, idempotencyHash: hashSchema, requestHash: hashSchema, fingerprint: hashSchema,
  createdAt: isoSchema, updatedAt: isoSchema, terminal: z.boolean(), effects: z.array(effectSchema).min(1).max(2),
  intent: z.strictObject({ profile: ownerSchema.shape.profile, quoteHash: hashSchema, owner: ownerSchema, providerBinding: providerBindingSchema,
    materialization: materializationSchema, decoded: z.unknown(), sourceDeployment: deploymentSchema, destinationDeployment: deploymentSchema,
    sourceAccount: accountSchema, destinationStartBlock: blockSchema, sourceRpcOrigin: originSchema, destinationRpcOrigin: originSchema,
    preparedAt: isoSchema, expiresAt: isoSchema, policyHash: hashSchema, implicitProtocolFeeAtomic: uintSchema }),
  transitions: z.array(transitionSchema).min(1).max(512), integrityHash: hashSchema });
