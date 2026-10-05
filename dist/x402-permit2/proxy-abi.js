import { parseAbi } from "viem";
/** Handler ABI attested against the original pinned executable prefix, official commit ad2658ac57bbf24d33192cb0f5dac5cf423f00a8.
 * Original compiler metadata identity remains unproved. This ABI never substitutes the registry's full runtime pin. */
export const PERMIT2_DIRECT_PROXY_ABI = parseAbi([
    "struct TokenPermissions { address token; uint256 amount; }",
    "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
    "struct Witness { address to; uint256 validAfter; }",
    "struct EIP2612Permit { uint256 value; uint256 deadline; bytes32 r; bytes32 s; uint8 v; }",
    "function settle(PermitTransferFrom permit, address owner, Witness witness, bytes signature)",
    "function settleWithPermit(EIP2612Permit permit2612, PermitTransferFrom permit, address owner, Witness witness, bytes signature)",
    "event Settled()",
    "event SettledWithPermit()",
]);
//# sourceMappingURL=proxy-abi.js.map