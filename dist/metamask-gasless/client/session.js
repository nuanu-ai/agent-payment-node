import { mmFail } from "../reasons.js";
export async function hydrateSdkState(state) {
    const sdk = await import("@metamask/agent-sdk/base");
    let writes = 0;
    const trap = () => { writes += 1; mmFail("mm_gasless_state_security"); };
    const sessionEnvelope = structuredClone(state.sessionEnvelope), walletEnvelope = structuredClone(state.walletEnvelope);
    const sessionStorage = { read: () => structuredClone(sessionEnvelope), write: trap, delete: trap };
    const walletStorage = { read: () => structuredClone(walletEnvelope), write: trap, delete: trap };
    const locker = { acquire: () => () => undefined, acquireAsync: async () => async () => undefined };
    const logger = { debug: (_message) => undefined, info: (_message) => undefined,
        warn: (_message) => undefined, error: (_message) => undefined, reset: () => undefined,
        enable: (_methods) => undefined };
    const sessionManager = new sdk.SessionManager({ storage: sessionStorage, locker, logger, storageLabel: "bounded session" });
    const session = sessionManager.load();
    const walletManager = new sdk.WalletStateManager(logger, walletStorage, locker, "bounded wallet state");
    const walletState = walletManager.read();
    if (session === null || writes !== 0)
        mmFail("mm_gasless_state_corrupt");
    return { session: session,
        walletState: walletState, writes: () => writes };
}
//# sourceMappingURL=session.js.map