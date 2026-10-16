import { getAddress, keccak256 } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { evmRpcHex, evmRpcQuantity } from "../evm-rpc-codec.js";
import { MULTICALL3_ADDRESS } from "../portfolio/registry.js";
import { BNB_COMPOSITE, bnbPoolReadData, verifyBnbPoolConfiguration } from "./bnb-composite.js";
import { basePinnedFeeReadPlan, bridgeDeploymentReadPlan } from "./rpc-deployment.js";
import { legacyBridgeActualFees } from "./rpc-fees.js";
import { assertMatchingHeader, eip7702Delegation } from "./rpc-support.js";
import { BRIDGE_ZERO_ADDRESS, bridgeFailure, bridgeHex } from "./validation.js";
/**
 * The frozen historical proofs of `operation repair-deployment`: the full code-hash deployment proof at one block and the
 * Base fee re-proof through the pinned oracle, both on the owner's archive endpoint. Live bridges never call these; they
 * stay only so the two recognized migrations can still reproduce the exact identities their audits hash.
 */
export async function legacyDeploymentProof(chainId, origin, batchCall, tool, peerChainId, token, at, exactHashPin) {
    const { contract, feeContract, verificationCodeRows, readRows, directRows, aggregateGroups, items } = bridgeDeploymentReadPlan(chainId, peerChainId, tool, token, at, exactHashPin);
    const code = [], configuration = [];
    const values = await batchCall(items, "archive_deployment");
    let offset = 0;
    if (values[offset++] !== BigInt(chainId))
        throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
    for (const row of verificationCodeRows) {
        const bytes = values[offset++];
        if (bytes === "0x" || eip7702Delegation(bytes) || keccak256(bytes) !== row.codeHash)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_code_changed");
        if (row.address !== getAddress(MULTICALL3_ADDRESS))
            code.push({ address: row.address, codeHash: keccak256(bytes) });
    }
    const observedByRead = new Map();
    for (const row of directRows)
        observedByRead.set(hashObject(row), values[offset++]);
    for (const rows of aggregateGroups) {
        const aggregate = values[offset++];
        for (let index = 0; index < rows.length; index += 1)
            observedByRead.set(hashObject(rows[index]), aggregate[index]);
    }
    for (const row of readRows) {
        const observed = observedByRead.get(hashObject(row));
        if (observed === undefined)
            bridgeFailure("APN_RPC_PROTOCOL", "bridge_multicall_response");
        if (observed !== row.expected)
            bridgeFailure("APN_PROVIDER_PROTOCOL", "bridge_deployment_configuration_changed");
        configuration.push({ ...row, expected: observed });
    }
    if (chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
        const registrationRaw = values[offset++], tokensRaw = values[offset++];
        const pool = verifyBnbPoolConfiguration(bridgeHex(registrationRaw, 256, undefined, "APN_RPC_PROTOCOL"), bridgeHex(tokensRaw, 2048, undefined, "APN_RPC_PROTOCOL"));
        configuration.push({ kind: "pool", address: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens,
            expected: `0x${Buffer.from(canonicalJson(pool)).toString("hex")}` });
    }
    const recheck = values[offset];
    if (evmRpcQuantity(recheck.number).toString() !== at.numberAtomic || evmRpcHex(recheck.hash, 32) !== at.hash)
        bridgeFailure("APN_RPC_PROTOCOL", "bridge_block_reorg");
    return { chainId, peerChainId, tool, block: at, rpcOrigin: origin,
        contractHash: hashObject({ protocol: contract, feeContract }), codeHash: hashObject(code), configurationHash: hashObject(configuration) };
}
/** The legacy Base fee proof: pinned oracle code, versions and the operator fee at the inclusion block, on the archive role. */
export function legacyBaseFees(chainId, call, batchCall) {
    return async (receipt, block, safe) => await legacyBridgeActualFees(chainId, receipt, block, call, chainId !== 8453 ? undefined : async (gas, pinned) => {
        const { codeRows, directRows, aggregateRows, items } = basePinnedFeeReadPlan(gas, pinned, safe);
        const values = await batchCall(items, "archive_deployment");
        let offset = 0;
        if (values[offset++] !== BigInt(chainId))
            throw new ApnError("APN_CHAIN_MISMATCH", "RPC chain does not match the explicitly selected EVM network.");
        for (const row of codeRows) {
            const bytes = values[offset++];
            if (bytes === "0x" || eip7702Delegation(bytes) || keccak256(bytes) !== row.codeHash)
                bridgeFailure("APN_RPC_PROTOCOL", "Base_fee_code_identity");
        }
        for (const row of directRows)
            if (values[offset++] !== row.expected)
                bridgeFailure("APN_RPC_PROTOCOL", "Base_fee_configuration_identity");
        const aggregate = values[offset++];
        for (let index = 0; index < aggregateRows.length; index += 1) {
            if (aggregate[index] !== aggregateRows[index].expected)
                bridgeFailure("APN_RPC_PROTOCOL", "Base_fee_configuration_identity");
        }
        const rawReturn = values[offset++], rawScalar = values[offset++], rawConstant = values[offset++];
        assertMatchingHeader(values[offset++], pinned);
        assertMatchingHeader(values[offset], safe);
        return { rawReturn, rawScalar, rawConstant };
    });
}
//# sourceMappingURL=rpc-legacy-proof.js.map