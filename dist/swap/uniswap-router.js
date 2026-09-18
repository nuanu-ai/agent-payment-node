import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, getAddress, parseAbi } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { UNISWAP_USDC } from "./uniswap-pin.js";
const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const WRAP_ETH = 0x0b, V3_SWAP_EXACT_IN = 0x00, V2_SWAP_EXACT_IN = 0x08;
const ROUTER_RECIPIENT = "0x0000000000000000000000000000000000000002";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
/** The official Trading API catalog pair: native ETH to USDC only. */
export function decodeUniswapRouterCalldata(data, expected) {
    return decodeUniswapRouterCalldataFor(data, { ...expected, outputToken: UNISWAP_USDC });
}
/** Same strict proof for an explicit pinned output token; the path must end at exactly that token. */
export function decodeUniswapRouterCalldataFor(data, expected) {
    try {
        const decoded = decodeFunctionData({ abi: ROUTER_ABI, data });
        if (decoded.functionName !== "execute")
            fail();
        const [commands, inputs, rawDeadline] = decoded.args;
        if (BigInt(rawDeadline) !== BigInt(expected.deadline) || commands.length !== 6 || inputs.length !== 2)
            fail();
        const bytes = Buffer.from(commands.slice(2), "hex");
        if (bytes.length !== 2 || bytes[0] !== WRAP_ETH || (bytes[1] !== V3_SWAP_EXACT_IN && bytes[1] !== V2_SWAP_EXACT_IN))
            fail();
        const wrapTypes = [{ type: "address" }, { type: "uint256" }];
        const [wrapRecipient, wrapAmount] = decodeAbiParameters(wrapTypes, inputs[0]);
        if (encodeAbiParameters(wrapTypes, [wrapRecipient, wrapAmount]).toLowerCase() !== inputs[0].toLowerCase())
            fail();
        if (getAddress(wrapRecipient) !== ROUTER_RECIPIENT || wrapAmount !== BigInt(expected.inputAmountAtomic))
            fail();
        let recipient, amountIn, amountOutMin, route;
        if (bytes[1] === V3_SWAP_EXACT_IN) {
            const types = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
                { type: "uint256[]" }];
            const values = decodeAbiParameters(types, inputs[1]);
            if (encodeAbiParameters(types, values).toLowerCase() !== inputs[1].toLowerCase())
                fail();
            const path = v3Path(values[3], getAddress(expected.outputToken));
            [recipient, amountIn, amountOutMin] = values;
            if (values[4] !== false || (values[5].length !== 0 && values[5].length !== path.hops.length))
                fail();
            route = { command: "V3_SWAP_EXACT_IN", path, minHopPriceX36: values[5].map(String) };
        }
        else {
            const types = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" },
                { type: "uint256[]" }];
            const values = decodeAbiParameters(types, inputs[1]);
            if (encodeAbiParameters(types, values).toLowerCase() !== inputs[1].toLowerCase())
                fail();
            const path = values[3].map(getAddress);
            [recipient, amountIn, amountOutMin] = values;
            if (values[4] !== false || canonicalJson(path) !== canonicalJson([WETH, getAddress(expected.outputToken)]) ||
                (values[5].length !== 0 && values[5].length !== path.length - 1))
                fail();
            route = { command: "V2_SWAP_EXACT_IN", path, minHopPriceX36: values[5].map(String) };
        }
        if (getAddress(recipient) !== expected.recipient || amountIn !== BigInt(expected.inputAmountAtomic) ||
            amountOutMin < BigInt(expected.minimumOutputAtomic))
            fail();
        return { command: bytes[1] === V3_SWAP_EXACT_IN ? "V3_SWAP_EXACT_IN" : "V2_SWAP_EXACT_IN", recipient: getAddress(recipient),
            inputAmountAtomic: amountIn.toString(), minimumOutputAtomic: amountOutMin.toString(), deadline: Number(rawDeadline),
            routeHash: sha256(canonicalJson(route)) };
    }
    catch (error) {
        if (error instanceof ApnError)
            throw error;
        return fail();
    }
}
function v3Path(path, outputToken) {
    const hex = path.slice(2);
    if (hex.length < 86 || (hex.length - 40) % 46 !== 0)
        fail();
    const tokens = [getAddress(`0x${hex.slice(0, 40)}`)], hops = [];
    let offset = 40;
    while (offset < hex.length) {
        const fee = Number.parseInt(hex.slice(offset, offset + 6), 16);
        if (![100, 500, 3000, 10000].includes(fee))
            fail();
        hops.push(fee);
        tokens.push(getAddress(`0x${hex.slice(offset + 6, offset + 46)}`));
        offset += 46;
    }
    if (tokens[0] !== WETH || tokens.at(-1) !== outputToken || tokens.length > 5)
        fail();
    return { tokens, hops };
}
function fail() { throw new ApnError("APN_PROVIDER_PROTOCOL", "Universal Router calldata is unsupported or does not prove the exact guarded swap."); }
//# sourceMappingURL=uniswap-router.js.map