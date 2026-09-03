export interface HttpGetRequest {
  readonly url: string;
  readonly paymentSignature?: string;
  readonly timeoutMs?: number;
}

export interface SafeTransportProvenance {
  readonly protocol: "https";
  readonly tlsAuthorized: true;
  readonly redirectCount: 0;
}

export interface HttpObservation {
  readonly status: number;
  readonly rawHeaderPairs: readonly (readonly [string, string])[];
  readonly bodyBytes: Uint8Array;
  readonly finalUrl: string;
  readonly observedOrigin: string;
  readonly dnsAddresses: readonly string[];
  readonly selectedAddress: string;
  readonly startedAt: string;
  readonly observedAt: string;
  readonly safeTransportProvenance: SafeTransportProvenance;
}

export interface HttpPort {
  get(request: HttpGetRequest): Promise<HttpObservation>;
}

export interface InspectReadiness {
  readonly cap: "unverified";
  readonly walletBalance: "unverified";
  readonly tokenDomain: "unverified";
  readonly payment: "unverified";
}

interface InspectCandidateBase {
  readonly index: string;
  readonly scheme: "exact";
  readonly network: "eip155:8453";
  readonly asset: string;
  readonly amountAtomic: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: string;
  readonly offerHash: string;
  readonly readiness: InspectReadiness;
}

export interface Eip3009InspectCandidate extends InspectCandidateBase {
  readonly tokenName: string;
  readonly tokenVersion: string;
  readonly assetTransferMethod: "eip3009";
  readonly paymentFlow: "transferWithAuthorization";
}

export interface Erc7710InspectCandidate extends InspectCandidateBase {
  readonly assetTransferMethod: "erc7710";
  readonly paymentFlow: "delegatedErc20Transfer";
  readonly facilitatorAddresses: readonly string[];
}

export type InspectCandidate = Eip3009InspectCandidate | Erc7710InspectCandidate;

export interface InspectResult {
  readonly kind: "x402_inspection";
  readonly x402Version: "2";
  readonly resource: {
    readonly origin: string;
    readonly path: string;
    readonly urlHash: string;
  };
  readonly candidates: readonly InspectCandidate[];
}
