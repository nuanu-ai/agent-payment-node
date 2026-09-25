import { SecureStateStore } from "../secure-state-store.js";
import { z } from "zod";
declare const safe: z.ZodObject<{
    provenance: z.ZodLiteral<"synthetic_untrusted">;
    transactionHash: z.ZodString;
    status: z.ZodEnum<{
        success: "success";
        reverted: "reverted";
    }>;
    blockNumberAtomic: z.ZodString;
    blockHash: z.ZodString;
    safeBlockNumberAtomic: z.ZodString;
    safeBlockHash: z.ZodString;
    observedAt: z.ZodString;
}, z.core.$strict>;
declare const rpcObservedSafe: z.ZodObject<{
    provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
    transactionHash: z.ZodString;
    status: z.ZodEnum<{
        success: "success";
        reverted: "reverted";
    }>;
    blockNumberAtomic: z.ZodString;
    blockHash: z.ZodString;
    safeBlockNumberAtomic: z.ZodString;
    safeBlockHash: z.ZodString;
    observedAt: z.ZodString;
    rpcOrigin: z.ZodString;
    logsHash: z.ZodString;
    receiptHash: z.ZodString;
    protocolInputDigest: z.ZodString;
    protocolProofHash: z.ZodNullable<z.ZodString>;
    executionAdmitted: z.ZodLiteral<false>;
    bridgeCompletion: z.ZodLiteral<false>;
}, z.core.$strict>;
declare const rpcObservedNearSafe: z.ZodObject<{
    status: z.ZodEnum<{
        success: "success";
        reverted: "reverted";
    }>;
    observedAt: z.ZodString;
    transactionHash: z.ZodString;
    blockHash: z.ZodString;
    rpcOrigin: z.ZodString;
    logsHash: z.ZodString;
    blockNumberAtomic: z.ZodString;
    safeBlockNumberAtomic: z.ZodString;
    safeBlockHash: z.ZodString;
    receiptHash: z.ZodString;
    executionAdmitted: z.ZodLiteral<false>;
    bridgeCompletion: z.ZodLiteral<false>;
    protocolInputDigest: z.ZodString;
    protocolProofHash: z.ZodNullable<z.ZodString>;
    provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
}, z.core.$strict>;
declare const schemaV1: z.ZodObject<{
    transitions: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        previousHash: z.ZodString;
        transitionHash: z.ZodString;
        phase: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            submitted_pending: "submitted_pending";
            signing_started: "signing_started";
            submitting: "submitting";
            sealed: "sealed";
            source_confirmed: "source_confirmed";
            staged_untrusted: "staged_untrusted";
            source_observed_untrusted: "source_observed_untrusted";
            source_reverted: "source_reverted";
        }>;
        signedTransaction: z.ZodNullable<z.ZodString>;
        transactionHash: z.ZodNullable<z.ZodString>;
        nonceAtomic: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
            provenance: z.ZodLiteral<"synthetic_untrusted">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            receiptHash: z.ZodString;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
        }, z.core.$strict>, z.ZodObject<{
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            observedAt: z.ZodString;
            transactionHash: z.ZodString;
            blockHash: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            blockNumberAtomic: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            receiptHash: z.ZodString;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
        }, z.core.$strict>]>>;
        reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
    phase: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        submitted_pending: "submitted_pending";
        signing_started: "signing_started";
        submitting: "submitting";
        sealed: "sealed";
        source_confirmed: "source_confirmed";
        staged_untrusted: "staged_untrusted";
        source_observed_untrusted: "source_observed_untrusted";
        source_reverted: "source_reverted";
    }>;
    signedTransaction: z.ZodNullable<z.ZodString>;
    transactionHash: z.ZodNullable<z.ZodString>;
    nonceAtomic: z.ZodNullable<z.ZodString>;
    submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
        provenance: z.ZodLiteral<"synthetic_untrusted">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        receiptHash: z.ZodString;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        observedAt: z.ZodString;
        transactionHash: z.ZodString;
        blockHash: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        receiptHash: z.ZodString;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
    }, z.core.$strict>]>>;
    reason: z.ZodNullable<z.ZodString>;
    schemaVersion: z.ZodLiteral<"apn.non-evm-source-journal.v1">;
    kind: z.ZodLiteral<"non_evm_source_journal">;
    executionAdmitted: z.ZodLiteral<false>;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    draftIntegrityHash: z.ZodString;
    route: z.ZodEnum<{
        base_usdc_to_solana_usdc_circle_cctp_v2: "base_usdc_to_solana_usdc_circle_cctp_v2";
        base_usdc_to_tron_usdt_lifi_near_intents: "base_usdc_to_tron_usdt_lifi_near_intents";
    }>;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
        type: z.ZodLiteral<"eip1559">;
        nonceAtomic: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        accessList: z.ZodTuple<[], null>;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    admissionProof: z.ZodObject<{
        kind: z.ZodLiteral<"synthetic_untrusted">;
        claimedValidationHash: z.ZodString;
        note: z.ZodString;
    }, z.core.$strict>;
    createdAt: z.ZodString;
}, z.core.$strict>;
declare const schemaV2: z.ZodObject<{
    transitions: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        previousHash: z.ZodString;
        transitionHash: z.ZodString;
        phase: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            submitted_pending: "submitted_pending";
            signing_started: "signing_started";
            submitting: "submitting";
            sealed: "sealed";
            source_confirmed: "source_confirmed";
            staged_untrusted: "staged_untrusted";
            source_observed_untrusted: "source_observed_untrusted";
            source_reverted: "source_reverted";
        }>;
        signedTransaction: z.ZodNullable<z.ZodString>;
        transactionHash: z.ZodNullable<z.ZodString>;
        nonceAtomic: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
            provenance: z.ZodLiteral<"synthetic_untrusted">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            receiptHash: z.ZodString;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
        }, z.core.$strict>, z.ZodObject<{
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            observedAt: z.ZodString;
            transactionHash: z.ZodString;
            blockHash: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            blockNumberAtomic: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            receiptHash: z.ZodString;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
        }, z.core.$strict>]>>;
        reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
    phase: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        submitted_pending: "submitted_pending";
        signing_started: "signing_started";
        submitting: "submitting";
        sealed: "sealed";
        source_confirmed: "source_confirmed";
        staged_untrusted: "staged_untrusted";
        source_observed_untrusted: "source_observed_untrusted";
        source_reverted: "source_reverted";
    }>;
    signedTransaction: z.ZodNullable<z.ZodString>;
    transactionHash: z.ZodNullable<z.ZodString>;
    nonceAtomic: z.ZodNullable<z.ZodString>;
    submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
        provenance: z.ZodLiteral<"synthetic_untrusted">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        receiptHash: z.ZodString;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        observedAt: z.ZodString;
        transactionHash: z.ZodString;
        blockHash: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        receiptHash: z.ZodString;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
    }, z.core.$strict>]>>;
    reason: z.ZodNullable<z.ZodString>;
    kind: z.ZodLiteral<"non_evm_source_journal">;
    executionAdmitted: z.ZodLiteral<false>;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    draftIntegrityHash: z.ZodString;
    route: z.ZodEnum<{
        base_usdc_to_solana_usdc_circle_cctp_v2: "base_usdc_to_solana_usdc_circle_cctp_v2";
        base_usdc_to_tron_usdt_lifi_near_intents: "base_usdc_to_tron_usdt_lifi_near_intents";
    }>;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
        type: z.ZodLiteral<"eip1559">;
        nonceAtomic: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        accessList: z.ZodTuple<[], null>;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    admissionProof: z.ZodObject<{
        kind: z.ZodLiteral<"synthetic_untrusted">;
        claimedValidationHash: z.ZodString;
        note: z.ZodString;
    }, z.core.$strict>;
    createdAt: z.ZodString;
    schemaVersion: z.ZodLiteral<"apn.non-evm-source-journal.v2">;
    protocolInputHash: z.ZodString;
}, z.core.$strict>;
declare const schemaV3: z.ZodObject<{
    kind: z.ZodLiteral<"non_evm_source_journal">;
    reason: z.ZodNullable<z.ZodString>;
    integrityHash: z.ZodString;
    profileHash: z.ZodString;
    phase: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        submitted_pending: "submitted_pending";
        signing_started: "signing_started";
        submitting: "submitting";
        sealed: "sealed";
        source_confirmed: "source_confirmed";
        staged_untrusted: "staged_untrusted";
        source_observed_untrusted: "source_observed_untrusted";
        source_reverted: "source_reverted";
    }>;
    transactionHash: z.ZodNullable<z.ZodString>;
    operationId: z.ZodString;
    createdAt: z.ZodString;
    transitions: z.ZodArray<z.ZodObject<{
        at: z.ZodString;
        previousHash: z.ZodString;
        transitionHash: z.ZodString;
        phase: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            submitted_pending: "submitted_pending";
            signing_started: "signing_started";
            submitting: "submitting";
            sealed: "sealed";
            source_confirmed: "source_confirmed";
            staged_untrusted: "staged_untrusted";
            source_observed_untrusted: "source_observed_untrusted";
            source_reverted: "source_reverted";
        }>;
        signedTransaction: z.ZodNullable<z.ZodString>;
        transactionHash: z.ZodNullable<z.ZodString>;
        nonceAtomic: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
            provenance: z.ZodLiteral<"synthetic_untrusted">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
            transactionHash: z.ZodString;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            observedAt: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            receiptHash: z.ZodString;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
        }, z.core.$strict>, z.ZodObject<{
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            observedAt: z.ZodString;
            transactionHash: z.ZodString;
            blockHash: z.ZodString;
            rpcOrigin: z.ZodString;
            logsHash: z.ZodString;
            blockNumberAtomic: z.ZodString;
            safeBlockNumberAtomic: z.ZodString;
            safeBlockHash: z.ZodString;
            receiptHash: z.ZodString;
            executionAdmitted: z.ZodLiteral<false>;
            bridgeCompletion: z.ZodLiteral<false>;
            protocolInputDigest: z.ZodString;
            protocolProofHash: z.ZodNullable<z.ZodString>;
            provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
        }, z.core.$strict>]>>;
        reason: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    nonceAtomic: z.ZodNullable<z.ZodString>;
    submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    route: z.ZodEnum<{
        base_usdc_to_solana_usdc_circle_cctp_v2: "base_usdc_to_solana_usdc_circle_cctp_v2";
        base_usdc_to_tron_usdt_lifi_near_intents: "base_usdc_to_tron_usdt_lifi_near_intents";
    }>;
    signedTransaction: z.ZodNullable<z.ZodString>;
    safeSourceProof: z.ZodNullable<z.ZodUnion<readonly [z.ZodObject<{
        provenance: z.ZodLiteral<"synthetic_untrusted">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        provenance: z.ZodLiteral<"rpc_observed_untrusted_circle_v2_base_source_v1">;
        transactionHash: z.ZodString;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        observedAt: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        receiptHash: z.ZodString;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        observedAt: z.ZodString;
        transactionHash: z.ZodString;
        blockHash: z.ZodString;
        rpcOrigin: z.ZodString;
        logsHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        safeBlockNumberAtomic: z.ZodString;
        safeBlockHash: z.ZodString;
        receiptHash: z.ZodString;
        executionAdmitted: z.ZodLiteral<false>;
        bridgeCompletion: z.ZodLiteral<false>;
        protocolInputDigest: z.ZodString;
        protocolProofHash: z.ZodNullable<z.ZodString>;
        provenance: z.ZodLiteral<"rpc_observed_untrusted_near_tron_base_source_v1">;
    }, z.core.$strict>]>>;
    draftIntegrityHash: z.ZodString;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
        type: z.ZodLiteral<"eip1559">;
        nonceAtomic: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        accessList: z.ZodTuple<[], null>;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    schemaVersion: z.ZodLiteral<"apn.non-evm-source-journal.v3">;
    executionAdmitted: z.ZodLiteral<true>;
    admissionProof: z.ZodObject<{
        kind: z.ZodLiteral<"circle_v2_live_transport_v1">;
        circleOrigin: z.ZodLiteral<"https://iris-api.circle.com">;
        rpcOrigin: z.ZodString;
        quoteHash: z.ZodString;
        validationHash: z.ZodString;
        sourceBlockHash: z.ZodString;
        preparationDigest: z.ZodString;
        payer: z.ZodString;
        recipientOwner: z.ZodString;
        recipientAta: z.ZodString;
        feeTotalAtomic: z.ZodString;
    }, z.core.$strict>;
    protocolInputHash: z.ZodString;
}, z.core.$strict>;
export type NonEvmSourceJournalV1 = z.infer<typeof schemaV1>;
export type NonEvmSourceJournalV2 = z.infer<typeof schemaV2>;
export type NonEvmSourceJournalV3 = z.infer<typeof schemaV3>;
export type NonEvmSourceJournal = NonEvmSourceJournalV1 | NonEvmSourceJournalV2 | NonEvmSourceJournalV3;
export type NonEvmSourceBinding = Pick<NonEvmSourceJournalV1, "profileHash" | "operationId" | "draftIntegrityHash" | "route" | "sourceCall" | "maxSourceNativeDebitWei" | "admissionProof" | "createdAt">;
export type NonEvmSourceBindingV2 = NonEvmSourceBinding & Pick<NonEvmSourceJournalV2, "schemaVersion" | "protocolInputHash">;
export type LiveCircleSourceBinding = Omit<NonEvmSourceBinding, "admissionProof"> & Pick<NonEvmSourceJournalV3, "admissionProof" | "protocolInputHash">;
export type SafeSourceObservation = z.infer<typeof safe>;
export type RpcObservedCircleSourceObservation = z.infer<typeof rpcObservedSafe>;
export type RpcObservedNearTronSourceObservation = z.infer<typeof rpcObservedNearSafe>;
export declare function validateNonEvmSourceJournal(value: unknown): NonEvmSourceJournal;
/** All mutations lock the exact draft identity and compare the expected record hash. */
export declare class NonEvmSourceJournalRepository extends SecureStateStore {
    private path;
    load(profileHash: string, operationId: string): Promise<NonEvmSourceJournal | null>;
    private reservationPath;
    private reserve;
    private assertReservation;
    /** Legacy synthetic proof remains permanently untrusted for live source execution. */
    stage(binding: NonEvmSourceBinding): Promise<NonEvmSourceJournal>;
    /** Stage a new record with a durable, untrusted protocol input identity. */
    stageV2(binding: NonEvmSourceBindingV2): Promise<NonEvmSourceJournalV2>;
    /** Records structural live-admission claims. This repository cannot authenticate network origin or authorize a source effect. */
    stageLiveCircle(binding: LiveCircleSourceBinding): Promise<NonEvmSourceJournalV3>;
    private stageBuilt;
    private change;
    signingStarted(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    seal(profileHash: string, operationId: string, expectedHash: string, raw: `0x${string}`, nonceAtomic: string, at: string): Promise<NonEvmSourceJournal>;
    /** Commit the sole attempt before a future adapter may send. No send or retry method exists here. */
    committingSubmission(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    observePending(profileHash: string, operationId: string, expectedHash: string, at: string): Promise<NonEvmSourceJournal>;
    observeUnknown(profileHash: string, operationId: string, expectedHash: string, reason: string, at: string): Promise<NonEvmSourceJournal>;
    /** Stores a claimed safe observation for offline state testing; neither phase nor provenance grants trust. */
    observeSafeSource(profileHash: string, operationId: string, expectedHash: string, observation: SafeSourceObservation | RpcObservedCircleSourceObservation | RpcObservedNearTronSourceObservation, at: string): Promise<NonEvmSourceJournal>;
    /** Stores a bound RPC observation without granting its caller an authenticated provenance claim. */
    recordRpcObservedCircleSource(profileHash: string, operationId: string, expectedHash: string, observation: RpcObservedCircleSourceObservation, at: string): Promise<NonEvmSourceJournal>;
    /** The caller and structural RPC port cannot assert authenticated source finality. */
    recordRpcObservedNearTronSource(profileHash: string, operationId: string, expectedHash: string, observation: RpcObservedNearTronSourceObservation, at: string): Promise<NonEvmSourceJournal>;
}
export {};
