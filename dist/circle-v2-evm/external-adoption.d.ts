import { type Hex } from "viem";
import type { StateStore } from "../state.js";
import type { BridgeHttps } from "../lifi/https.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
export declare function adoptCircleExternalMint(state: StateStore, repo: CircleRepository, usage: CircleUsage, env: NodeJS.ProcessEnv, now: () => number, https: Pick<BridgeHttps, "request">, id: string, txHash: Hex): Promise<CircleOperationV1>;
