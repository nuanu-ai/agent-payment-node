import { parseAbiParameters } from "viem";
export const STARGATE_SEND_PARAM = parseAbiParameters("(uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd)");
export const STARGATE_QUOTE_OFT_OUTPUT = parseAbiParameters("(uint256 minAmountLD,uint256 maxAmountLD) limit,(int256 feeAmountLD,string description)[] oftFeeDetails,(uint256 amountSentLD,uint256 amountReceivedLD) receipt");
export const STARGATE_QUOTE_SEND_OUTPUT = parseAbiParameters("(uint256 nativeFee,uint256 lzTokenFee) fee");
export const STARGATE_QUOTE_ABI = [
    {
        type: "function", name: "quoteOFT", stateMutability: "view", inputs: [
            { name: "_sendParam", type: "tuple", components: [
                    { name: "dstEid", type: "uint32" }, { name: "to", type: "bytes32" },
                    { name: "amountLD", type: "uint256" }, { name: "minAmountLD", type: "uint256" },
                    { name: "extraOptions", type: "bytes" }, { name: "composeMsg", type: "bytes" }, { name: "oftCmd", type: "bytes" },
                ] },
        ], outputs: [
            { name: "limit", type: "tuple", components: [{ name: "minAmountLD", type: "uint256" }, { name: "maxAmountLD", type: "uint256" }] },
            { name: "oftFeeDetails", type: "tuple[]", components: [{ name: "feeAmountLD", type: "int256" }, { name: "description", type: "string" }] },
            { name: "receipt", type: "tuple", components: [{ name: "amountSentLD", type: "uint256" }, { name: "amountReceivedLD", type: "uint256" }] },
        ],
    },
    {
        type: "function", name: "quoteSend", stateMutability: "view", inputs: [
            { name: "_sendParam", type: "tuple", components: [
                    { name: "dstEid", type: "uint32" }, { name: "to", type: "bytes32" },
                    { name: "amountLD", type: "uint256" }, { name: "minAmountLD", type: "uint256" },
                    { name: "extraOptions", type: "bytes" }, { name: "composeMsg", type: "bytes" }, { name: "oftCmd", type: "bytes" },
                ] },
            { name: "_payInLzToken", type: "bool" },
        ], outputs: [{ name: "fee", type: "tuple", components: [{ name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" }] }],
    },
];
//# sourceMappingURL=abi.js.map