import { ApnError } from "../../errors.js";
import { swapRouteDigest, swapRouteOf } from "../route-admission.js";
import { BNB_UNISWAP_TOKEN_LANE } from "../uniswap-bnb/token-lane.js";
import { BNB_UNISWAP_TOKEN_ROUTE_SCHEMA } from "../uniswap-bnb/token-route.js";
import { UNISWAP_V3_QUOTER_V2 } from "./pins.js";
import { ETHEREUM_TOKEN_NONCE_SPACE } from "./token-nonce.js";
import { tokenChain } from "./token-rpc.js";
import { createUniswapTokenRoute, encodeUniswapTokenApproval, UNISWAP_TOKEN_MECHANISM_PIN, UNISWAP_TOKEN_ROUTE_SCHEMA, UNISWAP_V3_SWAP_ROUTER, verifyUniswapTokenRoutePins } from "./token-route.js";
import { ethereumTokenScreen } from "./token-screen.js";
export const ETHEREUM_UNISWAP_TOKEN_LANE = Object.freeze({
    chain: "eip155:1", chainId: 1, chainLabel: "Ethereum chain 1", networkName: "Ethereum", nativeSymbol: "ETH",
    commandPrefix: "apn swap ethereum uniswap-token", requestFamily: "swap.uniswap-token", archiveEnvironment: "APN_ETHEREUM_ARCHIVE_RPC_URL",
    quoter: UNISWAP_V3_QUOTER_V2, mechanismPin: UNISWAP_TOKEN_MECHANISM_PIN, routeSchema: UNISWAP_TOKEN_ROUTE_SCHEMA, refusesZeroGasPrice: false,
    nonceSpace: ETHEREUM_TOKEN_NONCE_SPACE, chainDecoder: tokenChain, createRoute: createUniswapTokenRoute, encodeApproval: encodeUniswapTokenApproval,
    verifyPins: verifyUniswapTokenRoutePins,
    inventory: () => ({ chain: "eip155:1", router: UNISWAP_V3_SWAP_ROUTER, pair: "USDC/USDT", fee: 100,
        mechanism: UNISWAP_TOKEN_MECHANISM_PIN, route: swapRouteOf(UNISWAP_TOKEN_MECHANISM_PIN), routeDigest: swapRouteDigest(UNISWAP_TOKEN_MECHANISM_PIN),
        approval: "exact_input_only", transactionValue: "0" }),
    outputAsset: (route) => ({ kind: "token", identifier: route.outputToken }),
    screen: ethereumTokenScreen,
});
/** The lane of a validated route, by its schema. */
export function tokenLaneOf(route) {
    if (route.schemaVersion === UNISWAP_TOKEN_ROUTE_SCHEMA)
        return ETHEREUM_UNISWAP_TOKEN_LANE;
    if (route.schemaVersion === BNB_UNISWAP_TOKEN_ROUTE_SCHEMA)
        return BNB_UNISWAP_TOKEN_LANE;
    throw new ApnError("APN_STATE_CORRUPT", "Uniswap token route names no lane.");
}
/** The lane of a token-input command (`swap.uniswap-token.*` or `swap.uniswap-bnb-token.*`). */
export function tokenLaneOfCommand(command) {
    if (command.startsWith("swap.uniswap-token."))
        return ETHEREUM_UNISWAP_TOKEN_LANE;
    if (command.startsWith("swap.uniswap-bnb-token."))
        return BNB_UNISWAP_TOKEN_LANE;
    throw new ApnError("APN_INVALID_INPUT", "The command names no Uniswap token-input lane.");
}
/** The family commands of a token swap's lane, for `apn operation` next actions. */
export function tokenLaneCommands(lane) {
    return { resume: `${lane.commandPrefix} execute --operation <operation-id>`, exit: `${lane.commandPrefix} cleanup --operation <operation-id>` };
}
//# sourceMappingURL=token-lane.js.map