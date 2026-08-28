import type { CommandRequest, OutputEnvelope } from "./core.js";
import { type WrappingSecretPort } from "./macos-keychain.js";
import type { NativePort } from "./ports.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import { type ProfilePolicyApprovalPort } from "./policy-approval.js";
import type { TransferApprovalPort } from "./tty-approval.js";
interface ParsedCli {
    readonly request: CommandRequest;
    readonly rpcUrl?: string;
}
export declare function parseArgv(argv: readonly string[]): ParsedCli;
export interface CliRuntimeOptions {
    readonly stateRoot?: string;
    readonly native?: NativePort;
    readonly wrappingSecret?: WrappingSecretPort;
    readonly approval?: TransferApprovalPort;
    readonly policy?: ProfilePolicyPort;
    readonly policyApproval?: ProfilePolicyApprovalPort;
}
export declare function runCli(argv: readonly string[], _environment?: NodeJS.ProcessEnv, options?: CliRuntimeOptions): Promise<OutputEnvelope>;
export declare function effectiveStateRoot(): string;
export {};
