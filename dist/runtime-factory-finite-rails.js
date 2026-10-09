import { Cleanup85NativeCancellation, verifyCleanup85CancellationAccounting } from "./circle-cleanup85-native-cancellation.js";
import { CircleEvmService } from "./circle-v2-evm/runtime.js";
import { SeiFundingService } from "./lifi/sei-gaszip-service.js";
import { MegaFundingService } from "./lifi/mega-gaszip-service.js";
/** Construct finite funding rails while retaining their existing construction boundaries. */
export function finiteFundingRuntime(command, state, wrappingSecret, options, environment, now) {
    return {
        circleEvm: options.circleEvm ?? new CircleEvmService(state, wrappingSecret, environment, now, {}, undefined, options.cleanup85Recovery ?? {
            cancellation: new Cleanup85NativeCancellation(state, wrappingSecret, environment, {
                now, sourceArchiveRpcUrl: "https://arbitrum-one-public.nodies.app", nativeRpcUrl: "https://arb1.arbitrum.io/rpc",
            }),
            verifyCancellationAccounting: verifyCleanup85CancellationAccounting,
        }),
        ...(command.startsWith("sei.funding.") || options.seiFunding !== undefined
            ? { seiFunding: options.seiFunding ?? new SeiFundingService(state, wrappingSecret, environment) } : {}),
        ...(command.startsWith("mega.funding.") || options.megaFunding !== undefined
            ? { megaFunding: options.megaFunding ?? new MegaFundingService(state, wrappingSecret, environment) } : {}),
    };
}
//# sourceMappingURL=runtime-factory-finite-rails.js.map