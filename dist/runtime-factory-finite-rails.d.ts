import { CircleFundingEvmService } from "./circle-v2-evm/funding-runtime.js";
import { CircleEvmService } from "./circle-v2-evm/runtime.js";
import { GaszipFundingService } from "./lifi/gaszip-direct-service.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
/** Construct finite funding rails while retaining their existing construction boundaries. */
export declare function finiteFundingRuntime(command: string, state: StateStore, wrappingSecret: WrappingSecretPort, options: Pick<RuntimeFactoryOptions, "seiFunding" | "megaFunding" | "circleEvm" | "circleFundingEvm" | "cleanup85Recovery">, environment: NodeJS.ProcessEnv, now: () => number): {
    megaFunding?: GaszipFundingService;
    seiFunding?: GaszipFundingService;
    circleFundingEvm: CircleFundingEvmService;
    circleEvm: CircleEvmService;
};
