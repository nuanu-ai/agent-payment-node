import type { Address } from "../model.js";
import type { GaslessAsset, GaslessChainId, GaslessDeployment, GaslessIntent } from "./model.js";
export declare const GASLESS_DEPLOYMENTS: readonly GaslessDeployment[];
export declare function gaslessDeployment(chainId: GaslessChainId): GaslessDeployment;
/** The admitted asset a chain/token pair names. No token outside its chain's row is ever addressable. */
export declare function gaslessAsset(chainId: GaslessChainId, token: Address): GaslessAsset;
/**
 * Re-validates a stored intent's asset identity against the registry row it names: the permit domain, the sponsoring
 * paymaster and the chain must all still be the row's, so a durable record can never widen what it was admitted under.
 */
export declare function gaslessIntentAsset(intent: Pick<GaslessIntent, "request" | "token" | "tokenDomain" | "paymaster">): GaslessAsset;
export declare function gaslessProtocolHash(row: GaslessDeployment): string;
