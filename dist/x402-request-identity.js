import { canonicalJson, domainHash, hashObject } from "./canonical.js";
import { x402HttpRequestBinding } from "./x402-http-request.js";
import { releasedX402Pair } from "./x402-network.js";
/** Request and fingerprint identities of a standard x402 operation (moved from x402-state-model.ts, unchanged). */
export function x402RequestHash(input) {
    const chainId = input.chainId ?? 8453;
    return hashObject({
        ...x402HttpRequestBinding(input.httpRequest),
        method: "x402.fetch.prepare",
        ...(chainId === 8453 ? {} : { network: `eip155:${chainId}` }),
        // Released USDC requests keep their original hash; any other token is part of the request identity.
        ...(input.token === undefined || releasedX402Pair(chainId, input.token) ? {} : { token: input.token.toLowerCase() }),
        profile: input.profile,
        canonicalUrl: input.canonicalUrl,
        capAtomic: input.capAtomic,
    });
}
export function x402Fingerprint(input) {
    return domainHash("apn.x402.request.v1", canonicalJson({
        kind: input.kind,
        profile: input.profile,
        operationId: input.operationId,
        method: input.resource.httpRequest?.method ?? "GET",
        ...x402HttpRequestBinding(input.resource.httpRequest),
        canonicalFullUrl: input.resource.canonicalUrl,
        chainId: input.chainId,
        network: input.network,
        token: input.token,
        capAtomic: input.capAtomic,
        selectedOfferHash: input.selectedOffer.offerHash,
        wallet: input.wallet,
        ...(input.providerSigner === undefined ? {} : { providerSigner: input.providerSigner }),
        ...(input.delegatedMaterial === undefined ? {} : { delegatedMaterial: input.delegatedMaterial }),
        acceptedResolvedDefaults: input.selectedOffer.resolved,
        paymentIdentifier: input.paymentIdentifier === undefined
            ? { advertised: false }
            : { advertised: true, declarationHash: input.paymentIdentifier.declarationHash, value: input.paymentIdentifier.value },
    }));
}
//# sourceMappingURL=x402-request-identity.js.map