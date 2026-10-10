import type { StateStore } from "../state.js";
import type { BridgeHttps } from "../lifi/https.js";
import { type CircleOperationV1 } from "./operation-model.js";
import { CircleRepository } from "./repository.js";
import type { CircleUsage } from "./usage.js";
/** Existing observe/adopt entry points only. This path cannot consent, load a key or dispatch. */
export declare function observeHistoricalPaidCircle(state: StateStore, repo: CircleRepository, usage: CircleUsage, env: Readonly<Record<string, string | undefined>>, now: () => number, https: Pick<BridgeHttps, "request">, id: string, transactionHash?: string): Promise<CircleOperationV1>;
