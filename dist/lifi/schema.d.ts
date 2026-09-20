import { z } from "zod";
export declare const hashSchema: z.ZodString;
export declare const hexSchema: z.ZodString;
export declare const wordSchema: z.ZodString;
/** The EVM word is unchanged; a base58 Solana signature is admitted beside it, nothing else. */
export declare const railStatusSchema: z.ZodUnion<readonly [z.ZodString, z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>]>;
export declare const uintSchema: z.ZodString;
export declare const addressSchema: z.ZodString;
export declare const isoSchema: z.ZodString;
export declare const chainSchema: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
export declare const destinationChainSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>, z.ZodLiteral<10>, z.ZodLiteral<137>, z.ZodLiteral<43114>, z.ZodLiteral<130>]>;
export declare const toolSchema: z.ZodEnum<{
    across: "across";
    stargateV2: "stargateV2";
}>;
export declare const opaqueSchema: z.ZodString;
export declare const reasonSchema: z.ZodString;
export declare const originSchema: z.ZodString;
export declare const blockSchema: z.ZodObject<{
    numberAtomic: z.ZodString;
    hash: z.ZodString;
    timestampAtomic: z.ZodString;
}, z.core.$strict>;
export declare const ownerSchema: z.ZodObject<{
    profile: z.ZodString;
    profileHash: z.ZodString;
    address: z.ZodString;
    walletBindingHash: z.ZodString;
    walletCreatedAt: z.ZodString;
}, z.core.$strict>;
export declare const providerBindingSchema: z.ZodObject<{
    providerId: z.ZodLiteral<"local">;
    accountBindingHash: z.ZodString;
    capabilityHash: z.ZodString;
    revision: z.ZodNumber;
}, z.core.$strict>;
export declare const requestSchema: z.ZodObject<{
    fromChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    toChainId: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>, z.ZodLiteral<10>, z.ZodLiteral<137>, z.ZodLiteral<43114>, z.ZodLiteral<130>]>;
    fromToken: z.ZodString;
    toToken: z.ZodString;
    amountAtomic: z.ZodString;
    recipient: z.ZodString;
    minOutputAtomic: z.ZodString;
    maxNativeDebitWei: z.ZodString;
    maxRouteFeeAtomic: z.ZodString;
    slippageBps: z.ZodNumber;
}, z.core.$strict>;
export declare const feeSchema: z.ZodObject<{
    name: z.ZodString;
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    asset: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"native">]>;
    amountAtomic: z.ZodString;
    included: z.ZodBoolean;
}, z.core.$strict>;
export declare const transactionSchema: z.ZodObject<{
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    from: z.ZodString;
    to: z.ZodString;
    valueAtomic: z.ZodString;
    data: z.ZodString;
    gasLimitAtomic: z.ZodString;
}, z.core.$strict>;
export declare const materializationSchema: z.ZodObject<{
    routeId: z.ZodString;
    stepId: z.ZodString;
    tool: z.ZodEnum<{
        across: "across";
        stargateV2: "stargateV2";
    }>;
    request: z.ZodObject<{
        fromChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        toChainId: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>, z.ZodLiteral<10>, z.ZodLiteral<137>, z.ZodLiteral<43114>, z.ZodLiteral<130>]>;
        fromToken: z.ZodString;
        toToken: z.ZodString;
        amountAtomic: z.ZodString;
        recipient: z.ZodString;
        minOutputAtomic: z.ZodString;
        maxNativeDebitWei: z.ZodString;
        maxRouteFeeAtomic: z.ZodString;
        slippageBps: z.ZodNumber;
    }, z.core.$strict>;
    sender: z.ZodString;
    approvalAddress: z.ZodString;
    quotedOutputAtomic: z.ZodString;
    minimumOutputAtomic: z.ZodString;
    feeCosts: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        asset: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"native">]>;
        amountAtomic: z.ZodString;
        included: z.ZodBoolean;
    }, z.core.$strict>>;
    includedStepIdentities: z.ZodArray<z.ZodString>;
    transaction: z.ZodObject<{
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        gasLimitAtomic: z.ZodString;
    }, z.core.$strict>;
    requestHash: z.ZodString;
    responseHash: z.ZodString;
    routeHash: z.ZodString;
    stepHash: z.ZodString;
    materializedStepHash: z.ZodString;
    transactionDigest: z.ZodString;
}, z.core.$strict>;
export declare const deploymentSchema: z.ZodObject<{
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    peerChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    tool: z.ZodEnum<{
        across: "across";
        stargateV2: "stargateV2";
    }>;
    block: z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>;
    rpcOrigin: z.ZodString;
    contractHash: z.ZodString;
    codeHash: z.ZodString;
    configurationHash: z.ZodString;
}, z.core.$strict>;
export declare const accountSchema: z.ZodObject<{
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    rpcOrigin: z.ZodString;
    block: z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>;
    owner: z.ZodString;
    token: z.ZodString;
    spender: z.ZodString;
    balanceAtomic: z.ZodString;
    nativeBalanceWei: z.ZodString;
    allowanceAtomic: z.ZodString;
    latestNonceAtomic: z.ZodString;
    pendingNonceAtomic: z.ZodString;
}, z.core.$strict>;
export declare const economicsSchema: z.ZodObject<{
    nonceAtomic: z.ZodString;
    gasLimitAtomic: z.ZodString;
    maxFeePerGasAtomic: z.ZodString;
    maxPriorityFeePerGasAtomic: z.ZodString;
    maximumGasCostAtomic: z.ZodString;
}, z.core.$strict>;
export declare const feeQuoteSchema: z.ZodObject<{
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    feeModel: z.ZodOptional<z.ZodLiteral<"arbitrum-inclusive">>;
    blockNumberAtomic: z.ZodString;
    blockHash: z.ZodString;
    observedAt: z.ZodString;
    rpcOrigin: z.ZodString;
    l1DataFeeUpperWei: z.ZodString;
    operatorFeeUpperWei: z.ZodString;
    maximumExecutionFeeWei: z.ZodString;
    totalQuoteWei: z.ZodString;
    totalFeeEnforcedOnchain: z.ZodLiteral<false>;
}, z.core.$strict>;
export declare const feeCeilingSchema: z.ZodObject<{
    policy: z.ZodLiteral<"apn.bridge-fee-headroom.v1">;
    headroomBps: z.ZodNumber;
    quotedMaxFeePerGasAtomic: z.ZodString;
    quotedMaxPriorityFeePerGasAtomic: z.ZodString;
}, z.core.$strict>;
export declare const envelopeSchema: z.ZodObject<{
    role: z.ZodEnum<{
        bridge: "bridge";
        approval: "approval";
    }>;
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    from: z.ZodString;
    to: z.ZodString;
    valueAtomic: z.ZodString;
    data: z.ZodString;
    economics: z.ZodObject<{
        nonceAtomic: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        maximumGasCostAtomic: z.ZodString;
    }, z.core.$strict>;
    feeQuote: z.ZodObject<{
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        feeModel: z.ZodOptional<z.ZodLiteral<"arbitrum-inclusive">>;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        observedAt: z.ZodString;
        rpcOrigin: z.ZodString;
        l1DataFeeUpperWei: z.ZodString;
        operatorFeeUpperWei: z.ZodString;
        maximumExecutionFeeWei: z.ZodString;
        totalQuoteWei: z.ZodString;
        totalFeeEnforcedOnchain: z.ZodLiteral<false>;
    }, z.core.$strict>;
    provisionalGas: z.ZodBoolean;
    feeCeiling: z.ZodObject<{
        policy: z.ZodLiteral<"apn.bridge-fee-headroom.v1">;
        headroomBps: z.ZodNumber;
        quotedMaxFeePerGasAtomic: z.ZodString;
        quotedMaxPriorityFeePerGasAtomic: z.ZodString;
    }, z.core.$strict>;
    envelopeHash: z.ZodString;
}, z.core.$strict>;
export declare const txProofSchema: z.ZodObject<{
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    transactionHash: z.ZodString;
    block: z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>;
    safeBlock: z.ZodNullable<z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>>;
    rpcOrigin: z.ZodString;
    from: z.ZodString;
    to: z.ZodString;
    nonceAtomic: z.ZodString;
    valueAtomic: z.ZodString;
    dataHash: z.ZodString;
    gasLimitAtomic: z.ZodString;
    maxFeePerGasAtomic: z.ZodString;
    maxPriorityFeePerGasAtomic: z.ZodString;
    gasUsedAtomic: z.ZodString;
    effectiveGasPriceAtomic: z.ZodString;
    executionFeeWei: z.ZodString;
    l1DataFeeWei: z.ZodString;
    operatorFeeWei: z.ZodString;
    blobFeeWei: z.ZodString;
    actualTotalFeeWei: z.ZodString;
    feeEvidence: z.ZodObject<{
        receiptHash: z.ZodString;
        ruleHash: z.ZodString;
        arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
        baseOracle: z.ZodNullable<z.ZodObject<{
            oracle: z.ZodString;
            from: z.ZodString;
            callData: z.ZodString;
            rawReturn: z.ZodString;
            blockHash: z.ZodString;
            requireCanonical: z.ZodLiteral<true>;
            version: z.ZodLiteral<"1.6.0">;
            regime: z.ZodLiteral<"jovian">;
            scalarAtomic: z.ZodString;
            constantWei: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    status: z.ZodEnum<{
        success: "success";
        reverted: "reverted";
    }>;
    logsHash: z.ZodString;
}, z.core.$strict>;
export declare const sourceProofSchema: z.ZodObject<{
    tool: z.ZodEnum<{
        across: "across";
        stargateV2: "stargateV2";
    }>;
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    transactionHash: z.ZodString;
    blockNumberAtomic: z.ZodString;
    blockHash: z.ZodString;
    sourceAmountAtomic: z.ZodString;
    bridgeAmountAtomic: z.ZodString;
    feeForwardedAtomic: z.ZodString;
    logsHash: z.ZodString;
    correlation: z.ZodUnion<readonly [z.ZodObject<{
        kind: z.ZodLiteral<"across">;
        depositId: z.ZodString;
        originChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        inputToken: z.ZodString;
        outputToken: z.ZodString;
        inputAmountAtomic: z.ZodString;
        outputAmountAtomic: z.ZodString;
        depositor: z.ZodString;
        recipient: z.ZodString;
        exclusiveRelayer: z.ZodString;
        quoteTimestamp: z.ZodString;
        fillDeadline: z.ZodString;
        exclusivityDeadline: z.ZodString;
        message: z.ZodLiteral<"0x">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"stargateV2">;
        guid: z.ZodString;
        sourceEid: z.ZodNumber;
        destinationEid: z.ZodNumber;
        sender: z.ZodString;
        recipient: z.ZodString;
        amountSentAtomic: z.ZodString;
        amountReceivedAtomic: z.ZodString;
    }, z.core.$strict>]>;
}, z.core.$strict>;
export declare const destinationProofSchema: z.ZodObject<{
    tool: z.ZodEnum<{
        across: "across";
        stargateV2: "stargateV2";
    }>;
    chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
    transactionHash: z.ZodString;
    blockNumberAtomic: z.ZodString;
    blockHash: z.ZodString;
    recipient: z.ZodString;
    token: z.ZodString;
    amountAtomic: z.ZodString;
    correlationHash: z.ZodString;
    logsHash: z.ZodString;
    fillType: z.ZodNullable<z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
    relayerCredit: z.ZodNullable<z.ZodString>;
    repaymentChainIdAtomic: z.ZodNullable<z.ZodString>;
    safeBlock: z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>;
    rpcOrigin: z.ZodString;
    transactionProofHash: z.ZodString;
}, z.core.$strict>;
export declare const scanSchema: z.ZodObject<{
    startBlock: z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>;
    nextBlockAtomic: z.ZodString;
    previousEndBlock: z.ZodNullable<z.ZodObject<{
        numberAtomic: z.ZodString;
        hash: z.ZodString;
        timestampAtomic: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const providerObservationSchema: z.ZodObject<{
    status: z.ZodEnum<{
        unknown: "unknown";
        pending: "pending";
        not_found: "not_found";
        completed_observed: "completed_observed";
        partial_observed: "partial_observed";
        refund_observed: "refund_observed";
        failed_observed: "failed_observed";
    }>;
    destinationTransactionHash: z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>]>>;
    observedAt: z.ZodString;
    responseHash: z.ZodNullable<z.ZodString>;
}, z.core.$strict>;
export declare const failureSchema: z.ZodObject<{
    reason: z.ZodString;
    residualAllowance: z.ZodNullable<z.ZodObject<{
        amountAtomic: z.ZodString;
        block: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        rpcOrigin: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const consentSchema: z.ZodObject<{
    policy: z.ZodLiteral<"apn.bridge.foreground-approval.v1">;
    fingerprint: z.ZodString;
    approvedAt: z.ZodString;
    expiresAt: z.ZodString;
}, z.core.$strict>;
export declare const stateSchema: z.ZodEnum<{
    unknown_finality: "unknown_finality";
    failed_before_effect: "failed_before_effect";
    failed_confirmed_revert: "failed_confirmed_revert";
    awaiting_approval: "awaiting_approval";
    completed: "completed";
    execution_pending: "execution_pending";
    source_pending: "source_pending";
    destination_pending: "destination_pending";
    failed_after_approval: "failed_after_approval";
}>;
export declare const phaseSchema: z.ZodEnum<{
    unknown_finality: "unknown_finality";
    submitted_pending: "submitted_pending";
    signing_started: "signing_started";
    submitting: "submitting";
    unsealed: "unsealed";
    sealed: "sealed";
    included_success: "included_success";
    included_revert: "included_revert";
    safe_success: "safe_success";
    safe_revert: "safe_revert";
}>;
export declare const effectSchema: z.ZodObject<{
    envelope: z.ZodObject<{
        role: z.ZodEnum<{
            bridge: "bridge";
            approval: "approval";
        }>;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        economics: z.ZodObject<{
            nonceAtomic: z.ZodString;
            gasLimitAtomic: z.ZodString;
            maxFeePerGasAtomic: z.ZodString;
            maxPriorityFeePerGasAtomic: z.ZodString;
            maximumGasCostAtomic: z.ZodString;
        }, z.core.$strict>;
        feeQuote: z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            feeModel: z.ZodOptional<z.ZodLiteral<"arbitrum-inclusive">>;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            observedAt: z.ZodString;
            rpcOrigin: z.ZodString;
            l1DataFeeUpperWei: z.ZodString;
            operatorFeeUpperWei: z.ZodString;
            maximumExecutionFeeWei: z.ZodString;
            totalQuoteWei: z.ZodString;
            totalFeeEnforcedOnchain: z.ZodLiteral<false>;
        }, z.core.$strict>;
        provisionalGas: z.ZodBoolean;
        feeCeiling: z.ZodObject<{
            policy: z.ZodLiteral<"apn.bridge-fee-headroom.v1">;
            headroomBps: z.ZodNumber;
            quotedMaxFeePerGasAtomic: z.ZodString;
            quotedMaxPriorityFeePerGasAtomic: z.ZodString;
        }, z.core.$strict>;
        envelopeHash: z.ZodString;
    }, z.core.$strict>;
    role: z.ZodEnum<{
        bridge: "bridge";
        approval: "approval";
    }>;
    phase: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        submitted_pending: "submitted_pending";
        signing_started: "signing_started";
        submitting: "submitting";
        unsealed: "unsealed";
        sealed: "sealed";
        included_success: "included_success";
        included_revert: "included_revert";
        safe_success: "safe_success";
        safe_revert: "safe_revert";
    }>;
    transactionHash: z.ZodNullable<z.ZodString>;
    sealedMaterialHash: z.ZodNullable<z.ZodString>;
    submittedAt: z.ZodNullable<z.ZodString>;
    submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    includedProof: z.ZodNullable<z.ZodObject<{
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        block: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        safeBlock: z.ZodNullable<z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>>;
        rpcOrigin: z.ZodString;
        from: z.ZodString;
        to: z.ZodString;
        nonceAtomic: z.ZodString;
        valueAtomic: z.ZodString;
        dataHash: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        gasUsedAtomic: z.ZodString;
        effectiveGasPriceAtomic: z.ZodString;
        executionFeeWei: z.ZodString;
        l1DataFeeWei: z.ZodString;
        operatorFeeWei: z.ZodString;
        blobFeeWei: z.ZodString;
        actualTotalFeeWei: z.ZodString;
        feeEvidence: z.ZodObject<{
            receiptHash: z.ZodString;
            ruleHash: z.ZodString;
            arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
            baseOracle: z.ZodNullable<z.ZodObject<{
                oracle: z.ZodString;
                from: z.ZodString;
                callData: z.ZodString;
                rawReturn: z.ZodString;
                blockHash: z.ZodString;
                requireCanonical: z.ZodLiteral<true>;
                version: z.ZodLiteral<"1.6.0">;
                regime: z.ZodLiteral<"jovian">;
                scalarAtomic: z.ZodString;
                constantWei: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        logsHash: z.ZodString;
    }, z.core.$strict>>;
    safeProof: z.ZodNullable<z.ZodObject<{
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        block: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        safeBlock: z.ZodNullable<z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>>;
        rpcOrigin: z.ZodString;
        from: z.ZodString;
        to: z.ZodString;
        nonceAtomic: z.ZodString;
        valueAtomic: z.ZodString;
        dataHash: z.ZodString;
        gasLimitAtomic: z.ZodString;
        maxFeePerGasAtomic: z.ZodString;
        maxPriorityFeePerGasAtomic: z.ZodString;
        gasUsedAtomic: z.ZodString;
        effectiveGasPriceAtomic: z.ZodString;
        executionFeeWei: z.ZodString;
        l1DataFeeWei: z.ZodString;
        operatorFeeWei: z.ZodString;
        blobFeeWei: z.ZodString;
        actualTotalFeeWei: z.ZodString;
        feeEvidence: z.ZodObject<{
            receiptHash: z.ZodString;
            ruleHash: z.ZodString;
            arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
            baseOracle: z.ZodNullable<z.ZodObject<{
                oracle: z.ZodString;
                from: z.ZodString;
                callData: z.ZodString;
                rawReturn: z.ZodString;
                blockHash: z.ZodString;
                requireCanonical: z.ZodLiteral<true>;
                version: z.ZodLiteral<"1.6.0">;
                regime: z.ZodLiteral<"jovian">;
                scalarAtomic: z.ZodString;
                constantWei: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        status: z.ZodEnum<{
            success: "success";
            reverted: "reverted";
        }>;
        logsHash: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const transitionSchema: z.ZodObject<{
    effects: z.ZodArray<z.ZodObject<{
        envelopeHash: z.ZodString;
        role: z.ZodEnum<{
            bridge: "bridge";
            approval: "approval";
        }>;
        phase: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            submitted_pending: "submitted_pending";
            signing_started: "signing_started";
            submitting: "submitting";
            unsealed: "unsealed";
            sealed: "sealed";
            included_success: "included_success";
            included_revert: "included_revert";
            safe_success: "safe_success";
            safe_revert: "safe_revert";
        }>;
        transactionHash: z.ZodNullable<z.ZodString>;
        sealedMaterialHash: z.ZodNullable<z.ZodString>;
        submittedAt: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        includedProof: z.ZodNullable<z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            safeBlock: z.ZodNullable<z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>>;
            rpcOrigin: z.ZodString;
            from: z.ZodString;
            to: z.ZodString;
            nonceAtomic: z.ZodString;
            valueAtomic: z.ZodString;
            dataHash: z.ZodString;
            gasLimitAtomic: z.ZodString;
            maxFeePerGasAtomic: z.ZodString;
            maxPriorityFeePerGasAtomic: z.ZodString;
            gasUsedAtomic: z.ZodString;
            effectiveGasPriceAtomic: z.ZodString;
            executionFeeWei: z.ZodString;
            l1DataFeeWei: z.ZodString;
            operatorFeeWei: z.ZodString;
            blobFeeWei: z.ZodString;
            actualTotalFeeWei: z.ZodString;
            feeEvidence: z.ZodObject<{
                receiptHash: z.ZodString;
                ruleHash: z.ZodString;
                arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                baseOracle: z.ZodNullable<z.ZodObject<{
                    oracle: z.ZodString;
                    from: z.ZodString;
                    callData: z.ZodString;
                    rawReturn: z.ZodString;
                    blockHash: z.ZodString;
                    requireCanonical: z.ZodLiteral<true>;
                    version: z.ZodLiteral<"1.6.0">;
                    regime: z.ZodLiteral<"jovian">;
                    scalarAtomic: z.ZodString;
                    constantWei: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            logsHash: z.ZodString;
        }, z.core.$strict>>;
        safeProof: z.ZodNullable<z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            safeBlock: z.ZodNullable<z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>>;
            rpcOrigin: z.ZodString;
            from: z.ZodString;
            to: z.ZodString;
            nonceAtomic: z.ZodString;
            valueAtomic: z.ZodString;
            dataHash: z.ZodString;
            gasLimitAtomic: z.ZodString;
            maxFeePerGasAtomic: z.ZodString;
            maxPriorityFeePerGasAtomic: z.ZodString;
            gasUsedAtomic: z.ZodString;
            effectiveGasPriceAtomic: z.ZodString;
            executionFeeWei: z.ZodString;
            l1DataFeeWei: z.ZodString;
            operatorFeeWei: z.ZodString;
            blobFeeWei: z.ZodString;
            actualTotalFeeWei: z.ZodString;
            feeEvidence: z.ZodObject<{
                receiptHash: z.ZodString;
                ruleHash: z.ZodString;
                arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                baseOracle: z.ZodNullable<z.ZodObject<{
                    oracle: z.ZodString;
                    from: z.ZodString;
                    callData: z.ZodString;
                    rawReturn: z.ZodString;
                    blockHash: z.ZodString;
                    requireCanonical: z.ZodLiteral<true>;
                    version: z.ZodLiteral<"1.6.0">;
                    regime: z.ZodLiteral<"jovian">;
                    scalarAtomic: z.ZodString;
                    constantWei: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            logsHash: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    at: z.ZodString;
    previousHash: z.ZodString;
    transitionHash: z.ZodString;
    state: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        failed_before_effect: "failed_before_effect";
        failed_confirmed_revert: "failed_confirmed_revert";
        awaiting_approval: "awaiting_approval";
        completed: "completed";
        execution_pending: "execution_pending";
        source_pending: "source_pending";
        destination_pending: "destination_pending";
        failed_after_approval: "failed_after_approval";
    }>;
    approval: z.ZodNullable<z.ZodObject<{
        policy: z.ZodLiteral<"apn.bridge.foreground-approval.v1">;
        fingerprint: z.ZodString;
        approvedAt: z.ZodString;
        expiresAt: z.ZodString;
    }, z.core.$strict>>;
    sourceProof: z.ZodNullable<z.ZodObject<{
        tool: z.ZodEnum<{
            across: "across";
            stargateV2: "stargateV2";
        }>;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        sourceAmountAtomic: z.ZodString;
        bridgeAmountAtomic: z.ZodString;
        feeForwardedAtomic: z.ZodString;
        logsHash: z.ZodString;
        correlation: z.ZodUnion<readonly [z.ZodObject<{
            kind: z.ZodLiteral<"across">;
            depositId: z.ZodString;
            originChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            inputToken: z.ZodString;
            outputToken: z.ZodString;
            inputAmountAtomic: z.ZodString;
            outputAmountAtomic: z.ZodString;
            depositor: z.ZodString;
            recipient: z.ZodString;
            exclusiveRelayer: z.ZodString;
            quoteTimestamp: z.ZodString;
            fillDeadline: z.ZodString;
            exclusivityDeadline: z.ZodString;
            message: z.ZodLiteral<"0x">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"stargateV2">;
            guid: z.ZodString;
            sourceEid: z.ZodNumber;
            destinationEid: z.ZodNumber;
            sender: z.ZodString;
            recipient: z.ZodString;
            amountSentAtomic: z.ZodString;
            amountReceivedAtomic: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>>;
    destinationProof: z.ZodNullable<z.ZodObject<{
        tool: z.ZodEnum<{
            across: "across";
            stargateV2: "stargateV2";
        }>;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        recipient: z.ZodString;
        token: z.ZodString;
        amountAtomic: z.ZodString;
        correlationHash: z.ZodString;
        logsHash: z.ZodString;
        fillType: z.ZodNullable<z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
        relayerCredit: z.ZodNullable<z.ZodString>;
        repaymentChainIdAtomic: z.ZodNullable<z.ZodString>;
        safeBlock: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        rpcOrigin: z.ZodString;
        transactionProofHash: z.ZodString;
    }, z.core.$strict>>;
    providerObservation: z.ZodNullable<z.ZodObject<{
        status: z.ZodEnum<{
            unknown: "unknown";
            pending: "pending";
            not_found: "not_found";
            completed_observed: "completed_observed";
            partial_observed: "partial_observed";
            refund_observed: "refund_observed";
            failed_observed: "failed_observed";
        }>;
        destinationTransactionHash: z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>]>>;
        observedAt: z.ZodString;
        responseHash: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    destinationScan: z.ZodObject<{
        startBlock: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        nextBlockAtomic: z.ZodString;
        previousEndBlock: z.ZodNullable<z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    failure: z.ZodNullable<z.ZodObject<{
        reason: z.ZodString;
        residualAllowance: z.ZodNullable<z.ZodObject<{
            amountAtomic: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            rpcOrigin: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const operationSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"apn.bridge-operation.v1">;
    kind: z.ZodLiteral<"bridge_route">;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    idempotencyHash: z.ZodString;
    requestHash: z.ZodString;
    fingerprint: z.ZodString;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    terminal: z.ZodBoolean;
    effects: z.ZodArray<z.ZodObject<{
        envelope: z.ZodObject<{
            role: z.ZodEnum<{
                bridge: "bridge";
                approval: "approval";
            }>;
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            from: z.ZodString;
            to: z.ZodString;
            valueAtomic: z.ZodString;
            data: z.ZodString;
            economics: z.ZodObject<{
                nonceAtomic: z.ZodString;
                gasLimitAtomic: z.ZodString;
                maxFeePerGasAtomic: z.ZodString;
                maxPriorityFeePerGasAtomic: z.ZodString;
                maximumGasCostAtomic: z.ZodString;
            }, z.core.$strict>;
            feeQuote: z.ZodObject<{
                chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                feeModel: z.ZodOptional<z.ZodLiteral<"arbitrum-inclusive">>;
                blockNumberAtomic: z.ZodString;
                blockHash: z.ZodString;
                observedAt: z.ZodString;
                rpcOrigin: z.ZodString;
                l1DataFeeUpperWei: z.ZodString;
                operatorFeeUpperWei: z.ZodString;
                maximumExecutionFeeWei: z.ZodString;
                totalQuoteWei: z.ZodString;
                totalFeeEnforcedOnchain: z.ZodLiteral<false>;
            }, z.core.$strict>;
            provisionalGas: z.ZodBoolean;
            feeCeiling: z.ZodObject<{
                policy: z.ZodLiteral<"apn.bridge-fee-headroom.v1">;
                headroomBps: z.ZodNumber;
                quotedMaxFeePerGasAtomic: z.ZodString;
                quotedMaxPriorityFeePerGasAtomic: z.ZodString;
            }, z.core.$strict>;
            envelopeHash: z.ZodString;
        }, z.core.$strict>;
        role: z.ZodEnum<{
            bridge: "bridge";
            approval: "approval";
        }>;
        phase: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            submitted_pending: "submitted_pending";
            signing_started: "signing_started";
            submitting: "submitting";
            unsealed: "unsealed";
            sealed: "sealed";
            included_success: "included_success";
            included_revert: "included_revert";
            safe_success: "safe_success";
            safe_revert: "safe_revert";
        }>;
        transactionHash: z.ZodNullable<z.ZodString>;
        sealedMaterialHash: z.ZodNullable<z.ZodString>;
        submittedAt: z.ZodNullable<z.ZodString>;
        submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
        includedProof: z.ZodNullable<z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            safeBlock: z.ZodNullable<z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>>;
            rpcOrigin: z.ZodString;
            from: z.ZodString;
            to: z.ZodString;
            nonceAtomic: z.ZodString;
            valueAtomic: z.ZodString;
            dataHash: z.ZodString;
            gasLimitAtomic: z.ZodString;
            maxFeePerGasAtomic: z.ZodString;
            maxPriorityFeePerGasAtomic: z.ZodString;
            gasUsedAtomic: z.ZodString;
            effectiveGasPriceAtomic: z.ZodString;
            executionFeeWei: z.ZodString;
            l1DataFeeWei: z.ZodString;
            operatorFeeWei: z.ZodString;
            blobFeeWei: z.ZodString;
            actualTotalFeeWei: z.ZodString;
            feeEvidence: z.ZodObject<{
                receiptHash: z.ZodString;
                ruleHash: z.ZodString;
                arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                baseOracle: z.ZodNullable<z.ZodObject<{
                    oracle: z.ZodString;
                    from: z.ZodString;
                    callData: z.ZodString;
                    rawReturn: z.ZodString;
                    blockHash: z.ZodString;
                    requireCanonical: z.ZodLiteral<true>;
                    version: z.ZodLiteral<"1.6.0">;
                    regime: z.ZodLiteral<"jovian">;
                    scalarAtomic: z.ZodString;
                    constantWei: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            logsHash: z.ZodString;
        }, z.core.$strict>>;
        safeProof: z.ZodNullable<z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            safeBlock: z.ZodNullable<z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>>;
            rpcOrigin: z.ZodString;
            from: z.ZodString;
            to: z.ZodString;
            nonceAtomic: z.ZodString;
            valueAtomic: z.ZodString;
            dataHash: z.ZodString;
            gasLimitAtomic: z.ZodString;
            maxFeePerGasAtomic: z.ZodString;
            maxPriorityFeePerGasAtomic: z.ZodString;
            gasUsedAtomic: z.ZodString;
            effectiveGasPriceAtomic: z.ZodString;
            executionFeeWei: z.ZodString;
            l1DataFeeWei: z.ZodString;
            operatorFeeWei: z.ZodString;
            blobFeeWei: z.ZodString;
            actualTotalFeeWei: z.ZodString;
            feeEvidence: z.ZodObject<{
                receiptHash: z.ZodString;
                ruleHash: z.ZodString;
                arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                baseOracle: z.ZodNullable<z.ZodObject<{
                    oracle: z.ZodString;
                    from: z.ZodString;
                    callData: z.ZodString;
                    rawReturn: z.ZodString;
                    blockHash: z.ZodString;
                    requireCanonical: z.ZodLiteral<true>;
                    version: z.ZodLiteral<"1.6.0">;
                    regime: z.ZodLiteral<"jovian">;
                    scalarAtomic: z.ZodString;
                    constantWei: z.ZodString;
                }, z.core.$strict>>;
            }, z.core.$strict>;
            status: z.ZodEnum<{
                success: "success";
                reverted: "reverted";
            }>;
            logsHash: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    intent: z.ZodObject<{
        profile: z.ZodString;
        quoteHash: z.ZodString;
        owner: z.ZodObject<{
            profile: z.ZodString;
            profileHash: z.ZodString;
            address: z.ZodString;
            walletBindingHash: z.ZodString;
            walletCreatedAt: z.ZodString;
        }, z.core.$strict>;
        providerBinding: z.ZodObject<{
            providerId: z.ZodLiteral<"local">;
            accountBindingHash: z.ZodString;
            capabilityHash: z.ZodString;
            revision: z.ZodNumber;
        }, z.core.$strict>;
        materialization: z.ZodObject<{
            routeId: z.ZodString;
            stepId: z.ZodString;
            tool: z.ZodEnum<{
                across: "across";
                stargateV2: "stargateV2";
            }>;
            request: z.ZodObject<{
                fromChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                toChainId: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>, z.ZodLiteral<10>, z.ZodLiteral<137>, z.ZodLiteral<43114>, z.ZodLiteral<130>]>;
                fromToken: z.ZodString;
                toToken: z.ZodString;
                amountAtomic: z.ZodString;
                recipient: z.ZodString;
                minOutputAtomic: z.ZodString;
                maxNativeDebitWei: z.ZodString;
                maxRouteFeeAtomic: z.ZodString;
                slippageBps: z.ZodNumber;
            }, z.core.$strict>;
            sender: z.ZodString;
            approvalAddress: z.ZodString;
            quotedOutputAtomic: z.ZodString;
            minimumOutputAtomic: z.ZodString;
            feeCosts: z.ZodArray<z.ZodObject<{
                name: z.ZodString;
                chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                asset: z.ZodUnion<readonly [z.ZodString, z.ZodLiteral<"native">]>;
                amountAtomic: z.ZodString;
                included: z.ZodBoolean;
            }, z.core.$strict>>;
            includedStepIdentities: z.ZodArray<z.ZodString>;
            transaction: z.ZodObject<{
                chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                from: z.ZodString;
                to: z.ZodString;
                valueAtomic: z.ZodString;
                data: z.ZodString;
                gasLimitAtomic: z.ZodString;
            }, z.core.$strict>;
            requestHash: z.ZodString;
            responseHash: z.ZodString;
            routeHash: z.ZodString;
            stepHash: z.ZodString;
            materializedStepHash: z.ZodString;
            transactionDigest: z.ZodString;
        }, z.core.$strict>;
        decoded: z.ZodUnknown;
        sourceDeployment: z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            peerChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            tool: z.ZodEnum<{
                across: "across";
                stargateV2: "stargateV2";
            }>;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            rpcOrigin: z.ZodString;
            contractHash: z.ZodString;
            codeHash: z.ZodString;
            configurationHash: z.ZodString;
        }, z.core.$strict>;
        destinationDeployment: z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            peerChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            tool: z.ZodEnum<{
                across: "across";
                stargateV2: "stargateV2";
            }>;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            rpcOrigin: z.ZodString;
            contractHash: z.ZodString;
            codeHash: z.ZodString;
            configurationHash: z.ZodString;
        }, z.core.$strict>;
        sourceAccount: z.ZodObject<{
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            rpcOrigin: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            owner: z.ZodString;
            token: z.ZodString;
            spender: z.ZodString;
            balanceAtomic: z.ZodString;
            nativeBalanceWei: z.ZodString;
            allowanceAtomic: z.ZodString;
            latestNonceAtomic: z.ZodString;
            pendingNonceAtomic: z.ZodString;
        }, z.core.$strict>;
        destinationStartBlock: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        sourceRpcOrigin: z.ZodString;
        destinationRpcOrigin: z.ZodString;
        preparedAt: z.ZodString;
        expiresAt: z.ZodString;
        policyHash: z.ZodString;
        implicitProtocolFeeAtomic: z.ZodString;
    }, z.core.$strict>;
    transitions: z.ZodArray<z.ZodObject<{
        effects: z.ZodArray<z.ZodObject<{
            envelopeHash: z.ZodString;
            role: z.ZodEnum<{
                bridge: "bridge";
                approval: "approval";
            }>;
            phase: z.ZodEnum<{
                unknown_finality: "unknown_finality";
                submitted_pending: "submitted_pending";
                signing_started: "signing_started";
                submitting: "submitting";
                unsealed: "unsealed";
                sealed: "sealed";
                included_success: "included_success";
                included_revert: "included_revert";
                safe_success: "safe_success";
                safe_revert: "safe_revert";
            }>;
            transactionHash: z.ZodNullable<z.ZodString>;
            sealedMaterialHash: z.ZodNullable<z.ZodString>;
            submittedAt: z.ZodNullable<z.ZodString>;
            submissionAttempts: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
            includedProof: z.ZodNullable<z.ZodObject<{
                chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                transactionHash: z.ZodString;
                block: z.ZodObject<{
                    numberAtomic: z.ZodString;
                    hash: z.ZodString;
                    timestampAtomic: z.ZodString;
                }, z.core.$strict>;
                safeBlock: z.ZodNullable<z.ZodObject<{
                    numberAtomic: z.ZodString;
                    hash: z.ZodString;
                    timestampAtomic: z.ZodString;
                }, z.core.$strict>>;
                rpcOrigin: z.ZodString;
                from: z.ZodString;
                to: z.ZodString;
                nonceAtomic: z.ZodString;
                valueAtomic: z.ZodString;
                dataHash: z.ZodString;
                gasLimitAtomic: z.ZodString;
                maxFeePerGasAtomic: z.ZodString;
                maxPriorityFeePerGasAtomic: z.ZodString;
                gasUsedAtomic: z.ZodString;
                effectiveGasPriceAtomic: z.ZodString;
                executionFeeWei: z.ZodString;
                l1DataFeeWei: z.ZodString;
                operatorFeeWei: z.ZodString;
                blobFeeWei: z.ZodString;
                actualTotalFeeWei: z.ZodString;
                feeEvidence: z.ZodObject<{
                    receiptHash: z.ZodString;
                    ruleHash: z.ZodString;
                    arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                    baseOracle: z.ZodNullable<z.ZodObject<{
                        oracle: z.ZodString;
                        from: z.ZodString;
                        callData: z.ZodString;
                        rawReturn: z.ZodString;
                        blockHash: z.ZodString;
                        requireCanonical: z.ZodLiteral<true>;
                        version: z.ZodLiteral<"1.6.0">;
                        regime: z.ZodLiteral<"jovian">;
                        scalarAtomic: z.ZodString;
                        constantWei: z.ZodString;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                status: z.ZodEnum<{
                    success: "success";
                    reverted: "reverted";
                }>;
                logsHash: z.ZodString;
            }, z.core.$strict>>;
            safeProof: z.ZodNullable<z.ZodObject<{
                chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                transactionHash: z.ZodString;
                block: z.ZodObject<{
                    numberAtomic: z.ZodString;
                    hash: z.ZodString;
                    timestampAtomic: z.ZodString;
                }, z.core.$strict>;
                safeBlock: z.ZodNullable<z.ZodObject<{
                    numberAtomic: z.ZodString;
                    hash: z.ZodString;
                    timestampAtomic: z.ZodString;
                }, z.core.$strict>>;
                rpcOrigin: z.ZodString;
                from: z.ZodString;
                to: z.ZodString;
                nonceAtomic: z.ZodString;
                valueAtomic: z.ZodString;
                dataHash: z.ZodString;
                gasLimitAtomic: z.ZodString;
                maxFeePerGasAtomic: z.ZodString;
                maxPriorityFeePerGasAtomic: z.ZodString;
                gasUsedAtomic: z.ZodString;
                effectiveGasPriceAtomic: z.ZodString;
                executionFeeWei: z.ZodString;
                l1DataFeeWei: z.ZodString;
                operatorFeeWei: z.ZodString;
                blobFeeWei: z.ZodString;
                actualTotalFeeWei: z.ZodString;
                feeEvidence: z.ZodObject<{
                    receiptHash: z.ZodString;
                    ruleHash: z.ZodString;
                    arbitrumPosterGasAtomic: z.ZodNullable<z.ZodString>;
                    baseOracle: z.ZodNullable<z.ZodObject<{
                        oracle: z.ZodString;
                        from: z.ZodString;
                        callData: z.ZodString;
                        rawReturn: z.ZodString;
                        blockHash: z.ZodString;
                        requireCanonical: z.ZodLiteral<true>;
                        version: z.ZodLiteral<"1.6.0">;
                        regime: z.ZodLiteral<"jovian">;
                        scalarAtomic: z.ZodString;
                        constantWei: z.ZodString;
                    }, z.core.$strict>>;
                }, z.core.$strict>;
                status: z.ZodEnum<{
                    success: "success";
                    reverted: "reverted";
                }>;
                logsHash: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        at: z.ZodString;
        previousHash: z.ZodString;
        transitionHash: z.ZodString;
        state: z.ZodEnum<{
            unknown_finality: "unknown_finality";
            failed_before_effect: "failed_before_effect";
            failed_confirmed_revert: "failed_confirmed_revert";
            awaiting_approval: "awaiting_approval";
            completed: "completed";
            execution_pending: "execution_pending";
            source_pending: "source_pending";
            destination_pending: "destination_pending";
            failed_after_approval: "failed_after_approval";
        }>;
        approval: z.ZodNullable<z.ZodObject<{
            policy: z.ZodLiteral<"apn.bridge.foreground-approval.v1">;
            fingerprint: z.ZodString;
            approvedAt: z.ZodString;
            expiresAt: z.ZodString;
        }, z.core.$strict>>;
        sourceProof: z.ZodNullable<z.ZodObject<{
            tool: z.ZodEnum<{
                across: "across";
                stargateV2: "stargateV2";
            }>;
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            sourceAmountAtomic: z.ZodString;
            bridgeAmountAtomic: z.ZodString;
            feeForwardedAtomic: z.ZodString;
            logsHash: z.ZodString;
            correlation: z.ZodUnion<readonly [z.ZodObject<{
                kind: z.ZodLiteral<"across">;
                depositId: z.ZodString;
                originChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
                inputToken: z.ZodString;
                outputToken: z.ZodString;
                inputAmountAtomic: z.ZodString;
                outputAmountAtomic: z.ZodString;
                depositor: z.ZodString;
                recipient: z.ZodString;
                exclusiveRelayer: z.ZodString;
                quoteTimestamp: z.ZodString;
                fillDeadline: z.ZodString;
                exclusivityDeadline: z.ZodString;
                message: z.ZodLiteral<"0x">;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"stargateV2">;
                guid: z.ZodString;
                sourceEid: z.ZodNumber;
                destinationEid: z.ZodNumber;
                sender: z.ZodString;
                recipient: z.ZodString;
                amountSentAtomic: z.ZodString;
                amountReceivedAtomic: z.ZodString;
            }, z.core.$strict>]>;
        }, z.core.$strict>>;
        destinationProof: z.ZodNullable<z.ZodObject<{
            tool: z.ZodEnum<{
                across: "across";
                stargateV2: "stargateV2";
            }>;
            chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            transactionHash: z.ZodString;
            blockNumberAtomic: z.ZodString;
            blockHash: z.ZodString;
            recipient: z.ZodString;
            token: z.ZodString;
            amountAtomic: z.ZodString;
            correlationHash: z.ZodString;
            logsHash: z.ZodString;
            fillType: z.ZodNullable<z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
            relayerCredit: z.ZodNullable<z.ZodString>;
            repaymentChainIdAtomic: z.ZodNullable<z.ZodString>;
            safeBlock: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            rpcOrigin: z.ZodString;
            transactionProofHash: z.ZodString;
        }, z.core.$strict>>;
        providerObservation: z.ZodNullable<z.ZodObject<{
            status: z.ZodEnum<{
                unknown: "unknown";
                pending: "pending";
                not_found: "not_found";
                completed_observed: "completed_observed";
                partial_observed: "partial_observed";
                refund_observed: "refund_observed";
                failed_observed: "failed_observed";
            }>;
            destinationTransactionHash: z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>]>>;
            observedAt: z.ZodString;
            responseHash: z.ZodNullable<z.ZodString>;
        }, z.core.$strict>>;
        destinationScan: z.ZodObject<{
            startBlock: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            nextBlockAtomic: z.ZodString;
            previousEndBlock: z.ZodNullable<z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        failure: z.ZodNullable<z.ZodObject<{
            reason: z.ZodString;
            residualAllowance: z.ZodNullable<z.ZodObject<{
                amountAtomic: z.ZodString;
                block: z.ZodObject<{
                    numberAtomic: z.ZodString;
                    hash: z.ZodString;
                    timestampAtomic: z.ZodString;
                }, z.core.$strict>;
                rpcOrigin: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    integrityHash: z.ZodString;
    state: z.ZodEnum<{
        unknown_finality: "unknown_finality";
        failed_before_effect: "failed_before_effect";
        failed_confirmed_revert: "failed_confirmed_revert";
        awaiting_approval: "awaiting_approval";
        completed: "completed";
        execution_pending: "execution_pending";
        source_pending: "source_pending";
        destination_pending: "destination_pending";
        failed_after_approval: "failed_after_approval";
    }>;
    approval: z.ZodNullable<z.ZodObject<{
        policy: z.ZodLiteral<"apn.bridge.foreground-approval.v1">;
        fingerprint: z.ZodString;
        approvedAt: z.ZodString;
        expiresAt: z.ZodString;
    }, z.core.$strict>>;
    sourceProof: z.ZodNullable<z.ZodObject<{
        tool: z.ZodEnum<{
            across: "across";
            stargateV2: "stargateV2";
        }>;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        sourceAmountAtomic: z.ZodString;
        bridgeAmountAtomic: z.ZodString;
        feeForwardedAtomic: z.ZodString;
        logsHash: z.ZodString;
        correlation: z.ZodUnion<readonly [z.ZodObject<{
            kind: z.ZodLiteral<"across">;
            depositId: z.ZodString;
            originChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            destinationChainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
            inputToken: z.ZodString;
            outputToken: z.ZodString;
            inputAmountAtomic: z.ZodString;
            outputAmountAtomic: z.ZodString;
            depositor: z.ZodString;
            recipient: z.ZodString;
            exclusiveRelayer: z.ZodString;
            quoteTimestamp: z.ZodString;
            fillDeadline: z.ZodString;
            exclusivityDeadline: z.ZodString;
            message: z.ZodLiteral<"0x">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"stargateV2">;
            guid: z.ZodString;
            sourceEid: z.ZodNumber;
            destinationEid: z.ZodNumber;
            sender: z.ZodString;
            recipient: z.ZodString;
            amountSentAtomic: z.ZodString;
            amountReceivedAtomic: z.ZodString;
        }, z.core.$strict>]>;
    }, z.core.$strict>>;
    destinationProof: z.ZodNullable<z.ZodObject<{
        tool: z.ZodEnum<{
            across: "across";
            stargateV2: "stargateV2";
        }>;
        chainId: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<8453>, z.ZodLiteral<42161>]>;
        transactionHash: z.ZodString;
        blockNumberAtomic: z.ZodString;
        blockHash: z.ZodString;
        recipient: z.ZodString;
        token: z.ZodString;
        amountAtomic: z.ZodString;
        correlationHash: z.ZodString;
        logsHash: z.ZodString;
        fillType: z.ZodNullable<z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
        relayerCredit: z.ZodNullable<z.ZodString>;
        repaymentChainIdAtomic: z.ZodNullable<z.ZodString>;
        safeBlock: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        rpcOrigin: z.ZodString;
        transactionProofHash: z.ZodString;
    }, z.core.$strict>>;
    providerObservation: z.ZodNullable<z.ZodObject<{
        status: z.ZodEnum<{
            unknown: "unknown";
            pending: "pending";
            not_found: "not_found";
            completed_observed: "completed_observed";
            partial_observed: "partial_observed";
            refund_observed: "refund_observed";
            failed_observed: "failed_observed";
        }>;
        destinationTransactionHash: z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString & z.ZodType<string, string, z.core.$ZodTypeInternals<string, string>>]>>;
        observedAt: z.ZodString;
        responseHash: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
    destinationScan: z.ZodObject<{
        startBlock: z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>;
        nextBlockAtomic: z.ZodString;
        previousEndBlock: z.ZodNullable<z.ZodObject<{
            numberAtomic: z.ZodString;
            hash: z.ZodString;
            timestampAtomic: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    failure: z.ZodNullable<z.ZodObject<{
        reason: z.ZodString;
        residualAllowance: z.ZodNullable<z.ZodObject<{
            amountAtomic: z.ZodString;
            block: z.ZodObject<{
                numberAtomic: z.ZodString;
                hash: z.ZodString;
                timestampAtomic: z.ZodString;
            }, z.core.$strict>;
            rpcOrigin: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
