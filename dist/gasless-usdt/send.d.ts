import type { Hex } from "../model.js";
import { type UsdtBoundOperation } from "./bound-operation.js";
import { UsdtExecutionJournal, type UsdtExecutionRecord } from "./execution-journal.js";
import { type SignedUsdtUserOperation, type UsdtSigningIdentity } from "./local-signing.js";
import type { UsdtPreparePort } from "./policy-prepare.js";
import type { UsdtUserOperation } from "./userop.js";
export interface UsdtSendSigner {
    sign(bound: UsdtBoundOperation, identity: UsdtSigningIdentity): Promise<SignedUsdtUserOperation>;
}
export interface UsdtSendTransport {
    send(op: UsdtUserOperation): Promise<Hex>;
}
/** One effect attempt. A persisted submitting marker prevents any later call from sending again. */
export declare class GuardedUsdtSendService {
    private readonly journal;
    private readonly signer;
    private readonly transport;
    private readonly port;
    constructor(journal: UsdtExecutionJournal, signer: UsdtSendSigner, transport: UsdtSendTransport, port: UsdtPreparePort);
    send(value: UsdtBoundOperation, identity: UsdtSigningIdentity): Promise<UsdtExecutionRecord>;
}
