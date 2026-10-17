import { CircleFundingEvmService } from "./circle-v2-evm/funding-runtime.js";
import { CircleEvmService } from "./circle-v2-evm/runtime.js";
import { GaszipFundingService } from "./lifi/gaszip-direct-service.js";
import { GASZIP_DIRECT_ROUTES } from "./lifi/gaszip-direct-route.js";
/** Construct finite funding rails while retaining their existing construction boundaries. */
export function finiteFundingRuntime(command, state, wrappingSecret, options, environment, now) {
    return {
        circleFundingEvm: options.circleFundingEvm ?? new CircleFundingEvmService(state, wrappingSecret, environment, now),
        circleEvm: options.circleEvm ?? new CircleEvmService(state, wrappingSecret, environment, now),
        ...(command.startsWith("sei.funding.") || options.seiFunding !== undefined
            ? { seiFunding: options.seiFunding ?? new GaszipFundingService(GASZIP_DIRECT_ROUTES.sei, state, wrappingSecret, environment) } : {}),
        ...(command.startsWith("mega.funding.") || options.megaFunding !== undefined
            ? { megaFunding: options.megaFunding ?? new GaszipFundingService(GASZIP_DIRECT_ROUTES.mega, state, wrappingSecret, environment) } : {}),
    };
}
//# sourceMappingURL=runtime-factory-finite-rails.js.map