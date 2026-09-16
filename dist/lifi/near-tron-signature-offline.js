/** Offline EIP-712 proof for a saved NEAR Intents quote. Never used for admission or execution. */
import { decodeFunctionData, getAddress, hashTypedData, parseAbi, recoverTypedDataAddress } from "viem";
import { inspectNearBaseTronQuoteOffline } from "./near-tron-offline.js";
import { BRIDGE_DIAMOND, bridgeFailure, bridgeRecord, bridgeUint } from "./validation.js";
// lifinance/contracts@6a670100f9d011e39fbf2fe973493de0a50cf970,
// src/Facets/NEARIntentsFacet.sol: _verifySignature and _domainSeparator.
const ABI = parseAbi(["function swapAndStartBridgeTokensViaNEARIntents((bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall),(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[],(bytes32 nonEVMReceiver,address depositAddress,bytes32 quoteId,uint256 deadline,uint256 minAmountOut,address refundRecipient,bytes signature)) payable"]);
const TYPES = { NEARIntentsPayload: [
        { name: "transactionId", type: "bytes32" },
        { name: "minAmount", type: "uint256" },
        { name: "receiver", type: "bytes32" },
        { name: "depositAddress", type: "address" },
        { name: "destinationChainId", type: "uint256" },
        { name: "sendingAssetId", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "quoteId", type: "bytes32" },
        { name: "minAmountOut", type: "uint256" },
    ] };
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `near_tron_signature_${reason}`); }
/** Proves that the saved calldata signature recovers a caller-supplied signer for this exact domain and payload. */
export async function verifyNearBaseTronSignatureOffline(value, binding, context) {
    const inspection = inspectNearBaseTronQuoteOffline(value, binding);
    const expected = getAddress(context.backendSigner);
    const diamond = getAddress(context.diamond);
    if (expected === "0x0000000000000000000000000000000000000000" || diamond !== BRIDGE_DIAMOND || context.chainId !== 8453)
        fail("context");
    const now = bridgeUint(context.nowUnixSeconds, false);
    const tx = bridgeRecord(bridgeRecord(value).transactionRequest);
    const decoded = decodeFunctionData({ abi: ABI, data: tx.data });
    const [bridge, , near] = decoded.args;
    if (now > near.deadline)
        fail("expired");
    // Solady's ECDSA.recover takes the 65-byte signature's v as 27/28;
    // viem also accepts 0/1, which would falsely pass this offline proof.
    if (near.signature.slice(-2).toLowerCase() !== "1b" && near.signature.slice(-2).toLowerCase() !== "1c")
        fail("recovery_byte");
    const typed = {
        domain: { name: "LI.FI NEAR Intents Facet", version: "1", chainId: context.chainId, verifyingContract: diamond },
        types: TYPES,
        primaryType: "NEARIntentsPayload",
        message: {
            transactionId: bridge.transactionId,
            minAmount: bridge.minAmount,
            receiver: near.nonEVMReceiver, // bridge.receiver is the facet's NON_EVM_ADDRESS
            depositAddress: near.depositAddress,
            destinationChainId: bridge.destinationChainId,
            sendingAssetId: bridge.sendingAssetId,
            deadline: near.deadline,
            quoteId: near.quoteId,
            minAmountOut: near.minAmountOut,
        },
    };
    const digest = hashTypedData(typed);
    let recovered;
    try {
        recovered = getAddress(await recoverTypedDataAddress({ ...typed, signature: near.signature }));
    }
    catch {
        return fail("recovery");
    }
    if (recovered !== expected)
        fail("backend_signer");
    return { kind: "offline_near_tron_signature_proof", executionAdmitted: false, bridgeCompletion: false,
        recoveredSigner: recovered, expectedBackendSigner: expected, digest, diamond, chainId: 8453,
        quoteId: inspection.quoteId, deadline: inspection.deadline };
}
//# sourceMappingURL=near-tron-signature-offline.js.map