import { CircleEvmService } from "./circle-v2-evm/runtime.js";
import { SeiFundingService } from "./lifi/sei-gaszip-service.js";
import { MegaFundingService } from "./lifi/mega-gaszip-service.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
/** Construct finite funding rails while retaining their existing construction boundaries. */
export declare function finiteFundingRuntime(command: string, state: StateStore, wrappingSecret: WrappingSecretPort, options: Pick<RuntimeFactoryOptions, "seiFunding" | "megaFunding" | "circleEvm">, environment: NodeJS.ProcessEnv, now: () => number): {
    megaFunding?: MegaFundingService;
    seiFunding?: SeiFundingService;
    circleEvm: CircleEvmService;
};
