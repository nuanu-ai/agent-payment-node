import type { GaslessChainId, GaslessDeployment } from "./model.js";
export declare const GASLESS_DEPLOYMENTS: readonly GaslessDeployment[];
export declare function gaslessDeployment(chainId: GaslessChainId): GaslessDeployment;
export declare function gaslessProtocolHash(row: GaslessDeployment): string;
