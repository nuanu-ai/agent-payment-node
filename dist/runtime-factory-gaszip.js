import { SeiFundingService } from "./lifi/sei-gaszip-service.js";
import { MegaFundingService } from "./lifi/mega-gaszip-service.js";
/** Construct each finite funding rail only for its command or explicit dependency. */
export function gasZipFundingRuntime(command, state, wrappingSecret, options, environment) {
    return {
        ...(command.startsWith("sei.funding.") || options.seiFunding !== undefined
            ? { seiFunding: options.seiFunding ?? new SeiFundingService(state, wrappingSecret, environment) } : {}),
        ...(command.startsWith("mega.funding.") || options.megaFunding !== undefined
            ? { megaFunding: options.megaFunding ?? new MegaFundingService(state, wrappingSecret, environment) } : {}),
    };
}
//# sourceMappingURL=runtime-factory-gaszip.js.map