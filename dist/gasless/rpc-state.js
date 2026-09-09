import { keccak256, toFunctionSelector } from "viem";
import { addressWord, rpcBool, rpcHex, rpcQuantity, rpcWord } from "./rpc-codec.js";
import { GASLESS_MAX_UINT120, gaslessAddress, gaslessFailure, gaslessUint } from "./validation.js";
const callData = (signature, words = []) => `${toFunctionSelector(signature)}${words.map((word) => word.slice(2)).join("")}`;
const ZERO_WORD = `0x${"0".repeat(64)}`;
export async function verifyProtocolAt(call, deployment, block) {
    const pinned = { blockHash: block.hash, requireCanonical: true };
    const codes = await Promise.all(deployment.code.map(async (row) => {
        const code = rpcHex(await call("eth_getCode", [row.address, pinned]), 256 * 1024);
        if (code === "0x" || keccak256(code) !== row.codeHash) {
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_protocol_identity");
        }
        return code;
    }));
    if (codes.length !== deployment.code.length)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_protocol_identity");
    await Promise.all(deployment.reads.map(async (row) => {
        const raw = row.kind === "storage"
            ? await call("eth_getStorageAt", [row.address, row.data, pinned])
            : await call("eth_call", [{ to: row.address, data: row.data }, pinned]);
        if (rpcHex(raw, 64 * 1024) !== row.expected)
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_protocol_identity");
    }));
}
export async function readAccountAt(call, deployment, ownerInput, block, readPending) {
    const owner = gaslessAddress(ownerInput);
    if (owner !== ownerInput)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_owner_identity");
    const pinned = { blockHash: block.hash, requireCanonical: true }, ownerWord = addressWord(owner);
    const balanceData = callData("balanceOf(address)", [ownerWord]);
    const allowanceData = callData("allowance(address,address)", [ownerWord, addressWord(deployment.paymaster)]);
    const permitNonceData = callData("nonces(address)", [ownerWord]);
    const entryPointNonceData = callData("getNonce(address,uint192)", [ownerWord, ZERO_WORD]);
    const pendingPromise = readPending ? call("eth_getTransactionCount", [owner, "pending"]) : null;
    const [balance, native, allowance, permitNonce, entryPointNonce, eoaNonce, code, pending] = await Promise.all([
        call("eth_call", [{ to: deployment.token, data: balanceData }, pinned]).then(rpcWord),
        call("eth_getBalance", [owner, pinned]).then(rpcQuantity),
        call("eth_call", [{ to: deployment.token, data: allowanceData }, pinned]).then(rpcWord),
        call("eth_call", [{ to: deployment.token, data: permitNonceData }, pinned]).then(rpcWord),
        call("eth_call", [{ to: deployment.entryPoint, data: entryPointNonceData }, pinned]).then(rpcWord),
        call("eth_getTransactionCount", [owner, pinned]).then(rpcQuantity),
        call("eth_getCode", [owner, pinned]).then((value) => rpcHex(value, 24)),
        pendingPromise === null ? Promise.resolve(null) : pendingPromise.then(rpcQuantity),
    ]);
    const expectedDelegation = `0xef0100${deployment.delegate.slice(2).toLowerCase()}`;
    let delegation;
    if (code === "0x")
        delegation = "empty";
    else if (code === expectedDelegation)
        delegation = "expected";
    else
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_delegation_identity");
    return { owner, balanceAtomic: balance.toString(), nativeBalanceWei: native.toString(), allowanceAtomic: allowance.toString(),
        permitNonceAtomic: permitNonce.toString(), entryPointNonceAtomic: entryPointNonce.toString(), eoaNonceAtomic: eoaNonce.toString(),
        pendingEoaNonceAtomic: (pending ?? eoaNonce).toString(), delegation };
}
export async function readFeeConfigurationAt(call, deployment, owner, block) {
    const pinned = { blockHash: block.hash, requireCanonical: true };
    const [paused, denylisted, additionalGasCharge, feeSpread, price] = await Promise.all([
        call("eth_call", [{ to: deployment.paymaster, data: callData("paused()") }, pinned]).then(rpcBool),
        call("eth_call", [{ to: deployment.paymaster, data: callData("isDenylisted(address)", [addressWord(owner)]) }, pinned]).then(rpcBool),
        call("eth_call", [{ to: deployment.paymaster, data: callData("additionalGasCharge()") }, pinned]).then(rpcWord),
        call("eth_call", [{ to: deployment.paymaster, data: callData("feeSpread()") }, pinned]).then(rpcWord),
        call("eth_call", [{ to: deployment.paymaster, data: callData("fetchPrice()") }, pinned]).then(rpcWord),
    ]);
    if (paused)
        gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_paymaster_paused");
    if (denylisted)
        gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_owner_denylisted");
    if (additionalGasCharge >= 1n << 32n || feeSpread >= 1n << 32n) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_fee_configuration");
    }
    gaslessUint(price.toString(), true, "APN_RPC_PROTOCOL");
    return { additionalGasCharge: additionalGasCharge.toString(), feeSpread: feeSpread.toString(), nativeTokenPrice: price.toString() };
}
export function gasPrices(rawBaseFee, rawPriority) {
    const base = rpcQuantity(rawBaseFee), priority = rpcQuantity(rawPriority), maximum = base * 2n + priority;
    if (base > GASLESS_MAX_UINT120 || priority > GASLESS_MAX_UINT120 || maximum > GASLESS_MAX_UINT120) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_gas_price_bound");
    }
    return { baseFeePerGas: base.toString(), maxFeePerGas: maximum.toString(), maxPriorityFeePerGas: priority.toString() };
}
//# sourceMappingURL=rpc-state.js.map