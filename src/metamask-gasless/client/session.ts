import type { PrivateState } from "./private-state.js";
import { mmFail } from "../reasons.js";

export interface HydratedSdkState {
  readonly session: Record<string, unknown>;
  readonly walletState: Record<string, unknown>;
  readonly writes: () => number;
}

export async function hydrateSdkState(state: PrivateState): Promise<HydratedSdkState> {
  const sdk = await import("@metamask/agent-sdk/base");
  let writes = 0;
  const trap = () => { writes += 1; mmFail("mm_gasless_state_security"); };
  const sessionEnvelope = structuredClone(state.sessionEnvelope), walletEnvelope = structuredClone(state.walletEnvelope);
  const sessionStorage = { read: () => structuredClone(sessionEnvelope), write: trap, delete: trap };
  const walletStorage = { read: () => structuredClone(walletEnvelope), write: trap, delete: trap };
  const locker = { acquire: () => () => undefined, acquireAsync: async () => async () => undefined };
  const logger = { debug: (_message: string) => undefined, info: (_message: string) => undefined,
    warn: (_message: string) => undefined, error: (_message: string) => undefined, reset: () => undefined,
    enable: (_methods: unknown) => undefined };
  const sessionManager = new sdk.SessionManager({ storage: sessionStorage as never, locker, logger, storageLabel: "bounded session" });
  const session = sessionManager.load();
  const walletManager = new sdk.WalletStateManager(logger, walletStorage as never, locker, "bounded wallet state");
  const walletState = walletManager.read();
  if (session === null || writes !== 0) mmFail("mm_gasless_state_corrupt");
  return { session: session as unknown as Record<string, unknown>,
    walletState: walletState as unknown as Record<string, unknown>, writes: () => writes };
}
