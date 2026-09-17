import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi } from "viem";
import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { UNISWAP_USDC } from "./uniswap-pin.js";

const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const WRAP_ETH = 0x0b, V3_SWAP_EXACT_IN = 0x00, V2_SWAP_EXACT_IN = 0x08;
const ROUTER_RECIPIENT = "0x0000000000000000000000000000000000000002";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export interface UniswapDecodedRoute { readonly command: "V2_SWAP_EXACT_IN" | "V3_SWAP_EXACT_IN"; readonly recipient: string;
  readonly inputAmountAtomic: string; readonly minimumOutputAtomic: string; readonly deadline: number; readonly routeHash: string }

export function decodeUniswapRouterCalldata(data: `0x${string}`, expected: { readonly recipient: string;
  readonly inputAmountAtomic: string; readonly minimumOutputAtomic: string; readonly deadline: number }): UniswapDecodedRoute {
  try {
    const decoded = decodeFunctionData({ abi: ROUTER_ABI, data });
    if (decoded.functionName !== "execute") fail();
    const [commands, inputs, rawDeadline] = decoded.args;
    if (BigInt(rawDeadline) !== BigInt(expected.deadline) || commands.length !== 6 || inputs.length !== 2) fail();
    const bytes = Buffer.from(commands.slice(2), "hex");
    if (bytes.length !== 2 || bytes[0] !== WRAP_ETH || (bytes[1] !== V3_SWAP_EXACT_IN && bytes[1] !== V2_SWAP_EXACT_IN)) fail();
    const [wrapRecipient, wrapAmount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], inputs[0]!);
    if (getAddress(wrapRecipient) !== ROUTER_RECIPIENT || wrapAmount !== BigInt(expected.inputAmountAtomic)) fail();
    let recipient: string, amountIn: bigint, amountOutMin: bigint, route: unknown;
    if (bytes[1] === V3_SWAP_EXACT_IN) {
      const values = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], inputs[1]!);
      [recipient, amountIn, amountOutMin] = values; route = v3Path(values[3]); if (values[4] !== false) fail();
    } else {
      const values = decodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address[]" }, { type: "bool" }], inputs[1]!);
      [recipient, amountIn, amountOutMin] = values; route = values[3].map(getAddress);
      if (values[4] !== false || canonicalJson(route) !== canonicalJson([WETH, UNISWAP_USDC])) fail();
    }
    if (getAddress(recipient) !== expected.recipient || amountIn !== BigInt(expected.inputAmountAtomic) ||
        amountOutMin < BigInt(expected.minimumOutputAtomic)) fail();
    return { command: bytes[1] === V3_SWAP_EXACT_IN ? "V3_SWAP_EXACT_IN" : "V2_SWAP_EXACT_IN", recipient: getAddress(recipient),
      inputAmountAtomic: amountIn.toString(), minimumOutputAtomic: amountOutMin.toString(), deadline: Number(rawDeadline),
      routeHash: sha256(canonicalJson(route)) };
  } catch (error) { if (error instanceof ApnError) throw error; return fail(); }
}

function v3Path(path: `0x${string}`): readonly string[] {
  const hex = path.slice(2); if (hex.length < 86 || (hex.length - 40) % 46 !== 0) fail();
  const tokens: string[] = [getAddress(`0x${hex.slice(0, 40)}`)]; let offset = 40;
  while (offset < hex.length) { const fee = Number.parseInt(hex.slice(offset, offset + 6), 16); if (![100, 500, 3000, 10000].includes(fee)) fail();
    tokens.push(getAddress(`0x${hex.slice(offset + 6, offset + 46)}`)); offset += 46; }
  if (tokens[0] !== WETH || tokens.at(-1) !== UNISWAP_USDC || tokens.length > 5) fail(); return tokens;
}
function fail(): never { throw new ApnError("APN_PROVIDER_PROTOCOL", "Universal Router calldata is unsupported or does not prove the exact guarded swap."); }
