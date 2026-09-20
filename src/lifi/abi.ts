import { getAddress, parseAbi } from "viem";
import type { Address, Hex } from "../model.js";

export const ACROSS_SELECTOR = "0x1794958f" as Hex;
export const STARGATE_SELECTOR = "0xa6010a66" as Hex;
export const FEE_FORWARDER_SELECTOR = "0x332d746b" as Hex;
export const FEE_FORWARDER_NATIVE_SELECTOR = "0x0e8ae67f" as Hex;

export const FEE_FORWARDER = "0xCE40449B773a3E6E5e769ADb4e567179d4828cbd" as Address;
export const FEE_RECIPIENT = "0xC06ebbefD94032B85424D51906e2A335EFAe264B" as Address;
export const LAYER_ZERO_ENDPOINT = getAddress("0x1a44076050125825900e736c501f859c50fe728c");

const BRIDGE_DATA = "(bytes32 transactionId,string bridge,string integrator,address referrer,address sendingAssetId,address receiver,uint256 minAmount,uint256 destinationChainId,bool hasSourceSwaps,bool hasDestinationCall)";
const SWAP_DATA = "(address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[]";

export const acrossBridgeAbi = parseAbi([
  `function swapAndStartBridgeTokensViaAcrossV4(${BRIDGE_DATA} bridgeData,${SWAP_DATA} swapData,(bytes32 receiverAddress,bytes32 refundAddress,bytes32 sendingAssetId,bytes32 receivingAssetId,uint256 outputAmount,uint128 outputAmountMultiplier,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message) acrossData) payable`,
]);

export const stargateBridgeAbi = parseAbi([
  `function swapAndStartBridgeTokensViaStargate(${BRIDGE_DATA} bridgeData,${SWAP_DATA} swapData,(uint16 assetId,(uint32 dstEid,bytes32 to,uint256 amountLD,uint256 minAmountLD,bytes extraOptions,bytes composeMsg,bytes oftCmd) sendParams,(uint256 nativeFee,uint256 lzTokenFee) fee,address refundAddress) stargateData) payable`,
]);

export const feeForwarderAbi = parseAbi([
  "function forwardERC20Fees(address token,(address recipient,uint256 amount)[] distributions)",
  "function forwardNativeFees((address recipient,uint256 amount)[] distributions) payable",
]);

export const bridgeEventsAbi = parseAbi([
  `event LiFiTransferStarted(${BRIDGE_DATA} bridgeData)`,
  "event FeesForwarded(address indexed token,(address recipient,uint256 amount)[] distributions)",
  "event FundsDeposited(bytes32 inputToken,bytes32 outputToken,uint256 inputAmount,uint256 outputAmount,uint256 indexed destinationChainId,uint256 indexed depositId,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes32 indexed depositor,bytes32 recipient,bytes32 exclusiveRelayer,bytes message)",
  "event FilledRelay(bytes32 inputToken,bytes32 outputToken,uint256 inputAmount,uint256 outputAmount,uint256 repaymentChainId,uint256 indexed originChainId,uint256 indexed depositId,uint32 fillDeadline,uint32 exclusivityDeadline,bytes32 exclusiveRelayer,bytes32 indexed relayer,bytes32 depositor,bytes32 recipient,bytes32 messageHash,(bytes32 updatedRecipient,bytes32 updatedMessageHash,uint256 updatedOutputAmount,uint8 fillType) relayExecutionInfo)",
  "event OFTSent(bytes32 indexed guid,uint32 dstEid,address indexed fromAddress,uint256 amountSentLD,uint256 amountReceivedLD)",
  "event OFTReceived(bytes32 indexed guid,uint32 srcEid,address indexed toAddress,uint256 amountReceivedLD)",
  "event UnreceivedTokenCached(bytes32 guid,uint8 index,uint32 srcEid,address receiver,uint256 amountLD,bytes composeMsg)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Deposit(address indexed dst,uint256 wad)",
  "event Withdrawal(address indexed src,uint256 wad)",
]);

export const EVENT_TOPICS = {
  lifiTransferStarted: "0xcba69f43792f9f399347222505213b55af8e0b0b54b893085c2e27ecbe1644f1",
  feesForwarded: "0x3a7029951ba36c1af37954df919ce2f9a95c3f5c2c2e872d5e7fd47c61a6df26",
  fundsDeposited: "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3",
  filledRelay: "0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208",
  oftSent: "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a",
  oftReceived: "0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c",
  unreceivedTokenCached: "0x007c17198cd078035dc663f9a0961f84cb6265411d0b4c793f96d432f6af4b55",
  transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
  wrappedDeposit: "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
  wrappedWithdrawal: "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65",
} as const satisfies Readonly<Record<string, Hex>>;

export const deploymentAbi = parseAbi([
  "function facetAddress(bytes4 selector) view returns (address)",
  "function isContractSelectorWhitelisted(address target,bytes4 selector) view returns (bool)",
  "function owner() view returns (address)",
  "function decimals() view returns (uint8)",
  "function implementation() view returns (address)",
  "function SPOKEPOOL() view returns (address)",
  "function WRAPPED_NATIVE() view returns (bytes32)",
  "function depositQuoteTimeBuffer() view returns (uint32)",
  "function fillDeadlineBuffer() view returns (uint32)",
  "function tokenMessaging() view returns (address)",
  "function stargateImpls(uint16 assetId) view returns (address)",
  "function assetIds(address router) view returns (uint16)",
  "function peers(uint32 eid) view returns (bytes32)",
  "function token() view returns (address)",
  "function localEid() view returns (uint32)",
  "function endpoint() view returns (address)",
  "function sharedDecimals() view returns (uint8)",
  "function getAddressConfig() view returns (address feeLib,address planner,address treasurer,address tokenMessaging,address creditMessaging,address lzToken)",
  "function basisPointsRate() view returns (uint256)",
  "function maximumFee() view returns (uint256)",
  "function deprecated() view returns (bool)",
  "function internalCallers(address caller) view returns (bool)",
  "function coreAddress() view returns (address)",
  "function weth() view returns (address)",
  "function whitelist(address caller) view returns (bool)",
  "function EXECUTOR() view returns (address)",
]);
