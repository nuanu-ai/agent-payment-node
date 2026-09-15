import { keccak256, toHex } from "viem";
import { sha256 } from "../canonical.js";
/**
 * Avalanche C-Chain native USDC relayed by PayAI's public x402 v2 facilitator.
 * Every identity here is pinned; nothing is discovered from the facilitator or a seller.
 */
const FACILITATOR_URL = "https://facilitator.payai.network";
export const AVALANCHE_FACILITATOR = {
    chainId: 43114,
    network: "eip155:43114",
    rpcEnv: "APN_AVALANCHE_RPC_URL",
    finalityTag: "finalized",
    token: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    tokenDomain: { name: "USD Coin", version: "2" },
    domainSeparator: "0xbbea200329a938bc3438984a49cb0732e66d66d7bd59c127abacc1710e77f7b3",
    decimals: 6,
    facilitatorUrl: FACILITATOR_URL,
    facilitatorOrigin: new URL(FACILITATOR_URL).origin,
    facilitatorEndpointHash: sha256(FACILITATOR_URL),
    approvedSigners: ["0xc6699d2aada6c36dfea5c248dd70f9cb0235cb63"],
    maxTimeoutSeconds: 60,
    validitySeconds: 120,
    transferTopic: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    authorizationUsedTopic: keccak256(toHex("AuthorizationUsed(address,bytes32)")),
    authorizationStateSelector: keccak256(toHex("authorizationState(address,bytes32)")).slice(0, 10),
};
//# sourceMappingURL=registry.js.map