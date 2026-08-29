import type { BoundCommand } from "./command-binder.js";
import type { OutputEnvelope } from "./commands.js";
import { ApnCore } from "./core.js";
import { type WrappingSecretPort } from "./macos-keychain.js";
import type { ClockPort, HttpPort, IdPort, NativePort, RpcPort, WaitPort } from "./ports.js";
import { type ProfilePolicyApprovalPort } from "./policy-approval.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import type { TransferApprovalPort } from "./tty-approval.js";
export interface RuntimeFactoryOptions {
    readonly stateRoot?: string;
    readonly native?: NativePort;
    readonly wrappingSecret?: WrappingSecretPort;
    readonly approval?: TransferApprovalPort;
    readonly policy?: ProfilePolicyPort;
    readonly policyApproval?: ProfilePolicyApprovalPort;
    readonly rpc?: RpcPort;
    readonly http?: HttpPort;
    readonly clock?: ClockPort;
    readonly ids?: IdPort;
    readonly wait?: WaitPort;
}
export declare function createApnCore(bound: BoundCommand, options?: RuntimeFactoryOptions): ApnCore;
export declare function executeBoundCommand(bound: BoundCommand, options?: RuntimeFactoryOptions): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
