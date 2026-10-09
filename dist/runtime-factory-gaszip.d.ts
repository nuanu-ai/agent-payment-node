import { SeiFundingService } from "./lifi/sei-gaszip-service.js";
import { MegaFundingService } from "./lifi/mega-gaszip-service.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type { RuntimeFactoryOptions } from "./runtime-factory-options.js";
/** Construct each finite funding rail only for its command or explicit dependency. */
export declare function gasZipFundingRuntime(command: string, state: StateStore, wrappingSecret: WrappingSecretPort, options: Pick<RuntimeFactoryOptions, "seiFunding" | "megaFunding">, environment: NodeJS.ProcessEnv): {
    megaFunding?: MegaFundingService;
    seiFunding?: SeiFundingService;
};
