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
/**
 * Pinned to IStargate.sol and StargateBase.sol at
 * stargate-protocol/stargate-v2@ce598b8d16472cd76ee47d30b8a40bc5c1b667bb.
 */
export const STARGATE_SEND_ABI = [
    {
        type: "function", name: "sendToken", stateMutability: "payable", inputs: [
            { name: "_sendParam", type: "tuple", components: [
                    { name: "dstEid", type: "uint32" }, { name: "to", type: "bytes32" },
                    { name: "amountLD", type: "uint256" }, { name: "minAmountLD", type: "uint256" },
                    { name: "extraOptions", type: "bytes" }, { name: "composeMsg", type: "bytes" }, { name: "oftCmd", type: "bytes" },
                ] },
            { name: "_fee", type: "tuple", components: [
                    { name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" },
                ] },
            { name: "_refundAddress", type: "address" },
        ], outputs: [
            { name: "msgReceipt", type: "tuple", components: [
                    { name: "guid", type: "bytes32" }, { name: "nonce", type: "uint64" }, { name: "fee", type: "tuple", components: [
                            { name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" },
                        ] },
                ] },
            { name: "oftReceipt", type: "tuple", components: [
                    { name: "amountSentLD", type: "uint256" }, { name: "amountReceivedLD", type: "uint256" },
                ] },
            { name: "ticket", type: "tuple", components: [
                    { name: "ticketId", type: "uint72" }, { name: "passengerBytes", type: "bytes" },
                ] },
        ],
    },
    { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
    { type: "function", name: "localEid", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
    { type: "function", name: "sharedDecimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "function", name: "status", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "function", name: "paths", stateMutability: "view", inputs: [{ name: "eid", type: "uint32" }], outputs: [{ type: "uint64" }] },
    { type: "function", name: "stargateType", stateMutability: "pure", inputs: [], outputs: [{ type: "uint8" }] },
    { type: "event", name: "OFTSent", inputs: [
            { name: "guid", type: "bytes32", indexed: true }, { name: "dstEid", type: "uint32", indexed: false },
            { name: "fromAddress", type: "address", indexed: true }, { name: "amountSentLD", type: "uint256", indexed: false },
            { name: "amountReceivedLD", type: "uint256", indexed: false },
        ] },
    { type: "event", name: "OFTReceived", inputs: [
            { name: "guid", type: "bytes32", indexed: true }, { name: "srcEid", type: "uint32", indexed: false },
            { name: "toAddress", type: "address", indexed: true }, { name: "amountReceivedLD", type: "uint256", indexed: false },
        ] },
];
/** Minimal ERC-20 surface used by the token lane. */
export const STARGATE_ERC20_ABI = [
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "account" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }] },
];
/** Executor DstConfig getter pinned to LayerZero-v2 Executor.sol. */
export const LAYERZERO_EXECUTOR_ABI = [{
        type: "function", name: "dstConfig", stateMutability: "view", inputs: [{ type: "uint32", name: "dstEid" }], outputs: [
            { type: "uint64", name: "lzReceiveBaseGas" }, { type: "uint16", name: "multiplierBps" },
            { type: "uint128", name: "floorMarginUSD" }, { type: "uint128", name: "nativeCap" },
            { type: "uint64", name: "lzComposeBaseGas" },
        ],
    }, {
        type: "event", name: "NativeDropApplied", inputs: [
            { name: "origin", type: "tuple", indexed: false, components: [
                    { name: "srcEid", type: "uint32" }, { name: "sender", type: "bytes32" }, { name: "nonce", type: "uint64" },
                ] },
            { name: "dstEid", type: "uint32", indexed: false },
            { name: "oapp", type: "address", indexed: false },
            { name: "params", type: "tuple[]", indexed: false, components: [
                    { name: "receiver", type: "address" }, { name: "amount", type: "uint256" },
                ] },
            { name: "success", type: "bool[]", indexed: false },
        ],
    }];
//# sourceMappingURL=abi.js.map