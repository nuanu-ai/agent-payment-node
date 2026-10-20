import type { ReadNetwork, ReadValidationPredicate, RelaySupportFacts, SentinelFeeFacts, TokenFeesKind } from "./read-diagnostic.js";
import { type MetaMaskGaslessIntent, type MetaMaskGaslessQuote } from "../model.js";
import type { MetaMaskGaslessQuoteInput } from "../ports.js";
export interface FetchExchangeRequest {
    readonly url: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | null;
    readonly signal?: AbortSignal;
    readonly maxBytes: number;
    readonly timeoutMs: number;
    /** Internal final gate used by the production transport immediately before bytes leave the process. */
    readonly beforeSend?: () => void;
}
export interface FetchExchangeResponse {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: string;
}
export interface FetchExchange {
    request(request: FetchExchangeRequest): Promise<FetchExchangeResponse>;
}
type ModeContext = {
    readonly mode: "inspect" | "buildUnsigned";
} | {
    readonly mode: "quote";
    readonly input: MetaMaskGaslessQuoteInput;
    readonly owner: string;
    readonly authToken: string;
} | {
    readonly mode: "submit" | "observe";
    readonly intent: MetaMaskGaslessIntent;
    readonly projectId: string;
    readonly token: string;
    readonly now: () => Date;
};
export declare class HelperNetworkPolicy {
    #private;
    private readonly context;
    private readonly exchange;
    readonly fetch: typeof globalThis.fetch;
    private readonly counts;
    private readonly successes;
    private notFound;
    private expectedSubmitBody;
    private lastClockMs;
    private deadlineFailure;
    private sessionFailure;
    /** Closed facts of the two validated relay inventories for the quoted chain, once both were read. */
    relaySupportFacts(): RelaySupportFacts | undefined;
    /** Transient fixed metadata, never response content or permission. */
    readFailureContext(error: unknown): ReadFailure;
    constructor(context: ModeContext, exchange?: FetchExchange);
    /** Only the exact failed original quote exchange may supply this private one-use capture. */
    takeSponsoredQuote(error: unknown): MetaMaskGaslessQuote | undefined;
    didObserveNotFound(): boolean;
    fixedFailure(): "mm_gasless_expired" | "mm_gasless_clock" | "mm_gasless_session_unavailable" | undefined;
    setExpectedSubmitBody(value: unknown): void;
    primeSubmitClock(value: Date): void;
    assertQuoteInventories(): void;
    assertComplete(): void;
    private handle;
    /** Both bodies already passed `validateResponse`; only the quoted chain's row is read, as the SDK reads it. */
    private recordRelayFacts;
    private assertSubmitDeadline;
    private classify;
}
interface ReadFailure {
    readonly network: ReadNetwork;
    readonly httpStatus: number | null;
    readonly validationFailed: boolean;
    readonly validationPredicate?: ReadValidationPredicate;
    readonly tokenFeesShape?: TokenFeesKind;
    readonly feeFacts?: SentinelFeeFacts;
}
export declare class HttpsFetchExchange implements FetchExchange {
    request(request: FetchExchangeRequest): Promise<FetchExchangeResponse>;
}
export declare function networkContextQuote(input: MetaMaskGaslessQuoteInput, owner: string, authToken: string): ModeContext;
export declare function networkContextRequest(mode: "submit" | "observe", intent: MetaMaskGaslessIntent, projectId: string, token: string, now: () => Date): ModeContext;
export declare function networkContextEmpty(mode: "inspect" | "buildUnsigned"): ModeContext;
export {};
