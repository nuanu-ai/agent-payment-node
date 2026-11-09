/**
 * Server mode: APN runs as cloud infrastructure with no person at a terminal. Every consent that the open-source build
 * asks a human to type is granted by the owner policy that the operator configured once; the policy, caps, frozen-fact
 * re-checks and send markers still run unchanged. It is on only when the operator sets `APN_SERVER_MODE=1`.
 */
export declare const SERVER_MODE_ENV = "APN_SERVER_MODE";
export declare function isServerMode(): boolean;
/**
 * The record of one policy-granted consent: one JSON line on stderr (journald or the container log keeps it). It carries
 * the same lines the terminal would have shown, never a secret: consent screens hold only public facts.
 */
export declare function recordServerConsent(lines: readonly string[]): void;
