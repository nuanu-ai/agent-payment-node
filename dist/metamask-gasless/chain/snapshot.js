import { keccak256 } from "viem";
import { mmProtocolPins } from "../single-protocol.js";
import { mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { mmEvidenceFail, mmEvidenceStateAt } from "./diagnostic.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmIso, mmUint } from "../validation.js";
import { addressWord, callData, rpcAddress, rpcHex, rpcWord } from "./abi.js";
/** Read every protocol, proxy, implementation, owner, token and counter value at one EIP-1898 block. */
export async function readMetaMaskChainState(call, deployment, owner, block, delegationHash, feeMode) {
    const pinned = { blockHash: block.hash, requireCanonical: true };
    const protocolEntries = Object.entries(mmProtocolPins(deployment, feeMode));
    const protocolPromise = Promise.all(protocolEntries.map(async ([name, pin]) => {
        const code = rpcHex(await call("eth_getCode", [pin.address, pinned]), 256 * 1024);
        if (code === "0x" || keccak256(code) !== pin.codeHash)
            mmEvidenceFail("mm_gasless_evidence_invalid", "protocol_code_pin", "eth_getCode");
        return [name, keccak256(code)];
    }));
    const proxyCodePromise = call("eth_getCode", [deployment.token, pinned]).then(value => rpcHex(value, 256 * 1024));
    const implementationSlotPromise = call("eth_getStorageAt", [deployment.token, deployment.tokenImplementationSlot, pinned]).then(value => rpcHex(value, 32, 32));
    const decimalsPromise = call("eth_call", [{ to: deployment.token, data: callData("decimals()") }, pinned]).then(rpcWord);
    const balancePromise = call("eth_call", [{ to: deployment.token,
            data: callData("balanceOf(address)", [addressWord(owner)]) }, pinned]).then(rpcWord);
    const ownerCodePromise = call("eth_getCode", [owner, pinned]).then(value => rpcHex(value, 32 * 1024));
    const counterPromise = delegationHash === null ? Promise.resolve(null) : call("eth_call", [{
            to: deployment.protocol.limitedCalls.address,
            data: callData("callCounts(address,bytes32)", [addressWord(deployment.protocol.manager.address), delegationHash]),
        }, pinned]).then(rpcWord);
    const [protocolPairs, proxyCode, implementationSlot, decimals, balance, ownerCode, counter] = await Promise.all([
        protocolPromise, proxyCodePromise, implementationSlotPromise, decimalsPromise, balancePromise, ownerCodePromise, counterPromise,
    ]);
    if (proxyCode === "0x" || keccak256(proxyCode) !== deployment.tokenProxyCodeHash) {
        mmEvidenceFail("mm_gasless_evidence_invalid", "token_proxy_code_pin", "eth_getCode");
    }
    if (decimals !== 6n)
        mmEvidenceFail("mm_gasless_evidence_invalid", "token_decimals", "eth_call");
    const implementationAddress = storageAddress(implementationSlot);
    if (implementationAddress !== deployment.tokenImplementationAddress)
        mmEvidenceFail("mm_gasless_evidence_invalid", "token_implementation_address", "eth_getStorageAt");
    const implementationCode = rpcHex(await call("eth_getCode", [implementationAddress, pinned]), 256 * 1024);
    if (implementationCode === "0x" || keccak256(implementationCode) !== deployment.tokenImplementationCodeHash) {
        mmEvidenceFail("mm_gasless_evidence_invalid", "token_implementation_code_pin", "eth_getCode");
    }
    const expectedDesignation = `0xef0100${deployment.protocol.delegate.address.slice(2)}`;
    let designation;
    if (ownerCode === "0x")
        designation = "empty";
    else if (ownerCode === expectedDesignation)
        designation = "pinned";
    else
        mmEvidenceFail("mm_gasless_evidence_invalid", "owner_designation", "eth_getCode");
    const common = {
        protocolCodeHashes: Object.fromEntries(protocolPairs),
        tokenProxyCodeHash: keccak256(proxyCode), tokenImplementationAddress: implementationAddress,
        tokenImplementationCodeHash: keccak256(implementationCode), tokenDecimals: 6,
        ownerCodeHash: keccak256(ownerCode), designation, usdcBalanceAtomic: balance.toString(),
    };
    return counter === null ? common : { ...common, counterAtomic: counter.toString() };
}
/** Strictly validate a returned prepare snapshot before orchestration trusts its economics. */
export function validateMetaMaskGaslessSnapshot(value, expected) {
    const snapshot = mmExact(value, ["chainId", "endpointHash", "endpointOrigin", "observedAt", "safeBlock",
        "headBlock", "safeState", "headState"], "mm_gasless_evidence_invalid");
    if (snapshot.chainId !== expected.chainId || mmHash(snapshot.endpointHash, "mm_gasless_evidence_invalid") !== expected.endpointHash ||
        snapshot.endpointOrigin !== expected.endpointOrigin)
        mmFail("mm_gasless_rpc_binding");
    mmIso(snapshot.observedAt, "mm_gasless_evidence_invalid");
    const safeBlock = validateBlock(snapshot.safeBlock), headBlock = validateBlock(snapshot.headBlock);
    if (BigInt(safeBlock.numberAtomic) > BigInt(headBlock.numberAtomic) ||
        (safeBlock.numberAtomic === headBlock.numberAtomic &&
            (safeBlock.hash !== headBlock.hash || safeBlock.timestampAtomic !== headBlock.timestampAtomic))) {
        mmEvidenceFail("mm_gasless_evidence_invalid", "snapshot_block_order");
    }
    const gross = mmUint(expected.grossAtomic, true, "mm_gasless_evidence_invalid"), row = mmRegistry(expected.chainId).row;
    const safeState = mmEvidenceStateAt("safe", () => validateState(snapshot.safeState, row, gross, expected.feeMode));
    const headState = mmEvidenceStateAt("latest", () => validateState(snapshot.headState, row, gross, expected.feeMode));
    return { chainId: expected.chainId, endpointHash: expected.endpointHash, endpointOrigin: expected.endpointOrigin,
        observedAt: snapshot.observedAt, safeBlock, headBlock, safeState, headState };
}
function validateBlock(value) {
    const block = mmExact(value, ["numberAtomic", "hash", "timestampAtomic"], "mm_gasless_evidence_invalid");
    return { numberAtomic: mmUint(block.numberAtomic, false, "mm_gasless_evidence_invalid").toString(),
        hash: mmHex(block.hash, 32, "mm_gasless_evidence_invalid"),
        timestampAtomic: mmUint(block.timestampAtomic, false, "mm_gasless_evidence_invalid").toString() };
}
function validateState(value, row, gross, feeMode) {
    const state = mmExact(value, ["protocolCodeHashes", "tokenProxyCodeHash", "tokenImplementationAddress",
        "tokenImplementationCodeHash", "tokenDecimals", "ownerCodeHash", "designation", "usdcBalanceAtomic",
        "counterAtomic"], "mm_gasless_evidence_invalid");
    const pins = mmProtocolPins(row, feeMode);
    const protocol = mmExact(state.protocolCodeHashes, Object.keys(pins), "mm_gasless_evidence_invalid");
    for (const [name, pin] of Object.entries(pins)) {
        if (mmHex(protocol[name], 32, "mm_gasless_evidence_invalid") !== pin.codeHash) {
            mmEvidenceFail("mm_gasless_evidence_invalid", "protocol_code_pin");
        }
    }
    if (mmHex(state.tokenProxyCodeHash, 32, "mm_gasless_evidence_invalid") !== row.tokenProxyCodeHash ||
        mmCanonicalAddress(state.tokenImplementationAddress, "mm_gasless_evidence_invalid") !== row.tokenImplementationAddress ||
        mmHex(state.tokenImplementationCodeHash, 32, "mm_gasless_evidence_invalid") !== row.tokenImplementationCodeHash ||
        state.tokenDecimals !== 6)
        mmEvidenceFail("mm_gasless_evidence_invalid", "snapshot_state_binding");
    if (state.counterAtomic !== "0")
        mmEvidenceFail("mm_gasless_evidence_invalid", "counter", "eth_call");
    if (mmUint(state.usdcBalanceAtomic, false, "mm_gasless_evidence_invalid") < gross)
        mmEvidenceFail("mm_gasless_evidence_invalid", "balance", "eth_call");
    const designation = state.designation;
    if (designation !== "empty" && designation !== "pinned")
        mmFail("mm_gasless_evidence_invalid");
    const expectedOwnerCode = designation === "empty" ? "0x" :
        `0xef0100${row.protocol.delegate.address.slice(2)}`;
    if (mmHex(state.ownerCodeHash, 32, "mm_gasless_evidence_invalid") !== keccak256(expectedOwnerCode)) {
        mmEvidenceFail("mm_gasless_evidence_invalid", "snapshot_owner_code");
    }
    return state;
}
function storageAddress(value) {
    if (!/^0x0{24}[0-9a-f]{40}$/u.test(value))
        mmFail("mm_gasless_evidence_invalid");
    return rpcAddress(`0x${value.slice(-40)}`);
}
//# sourceMappingURL=snapshot.js.map