import { parseAbi } from "viem";
export const GASLESS_TOKEN_ABI = parseAbi([
    "function name() view returns (string)",
    "function decimals() view returns (uint8)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function nonces(address owner) view returns (uint256)",
    "function balanceOf(address account) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)",
    "function transfer(address to,uint256 value) returns (bool)",
    "function approve(address spender,uint256 value) returns (bool)",
    "function permit(address owner,address spender,uint256 value,uint256 deadline,bytes signature)",
    "event Transfer(address indexed from,address indexed to,uint256 value)",
    "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
export const GASLESS_PAYMASTER_ABI = parseAbi([
    "function entryPoint() view returns (address)",
    "function token() view returns (address)",
    "function paused() view returns (bool)",
    "function isDenylisted(address _account) view returns (bool)",
    "function additionalGasCharge() view returns (uint32)",
    "function feeSpread() view returns (uint32)",
    "function fetchPrice() view returns (uint256 price)",
    "event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)",
]);
export const GASLESS_ENTRYPOINT_ABI = parseAbi([
    "function getNonce(address sender,uint192 key) view returns (uint256 nonce)",
    "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
    "event PostOpRevertReason(bytes32 indexed userOpHash,address indexed sender,uint256 nonce,bytes revertReason)",
    "event UserOperationPrefundTooLow(bytes32 indexed userOpHash,address indexed sender,uint256 nonce)",
]);
export const GASLESS_ACCOUNT_ABI = parseAbi([
    "function executeBatch((address target,uint256 value,bytes data)[] calls)",
]);
//# sourceMappingURL=abi.js.map