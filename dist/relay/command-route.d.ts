import type { BoundCommand } from "../command-binder.js";
import type { CommandRequest, OutputEnvelope } from "../commands.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
type Options = Readonly<Record<string, string>>;
/** Binds `relay prepare` to the internal prepare request of its route; route-only options are required or refused. */
export declare function bindRelayPrepare(o: Options): CommandRequest;
/** Runs `relay execute` or `relay observe` as the internal command of the saved route and names the next step. */
export declare function executeRelayRoute(bound: BoundCommand, stateRoot: string, run: (internal: BoundCommand) => Promise<OutputEnvelope>): Promise<OutputEnvelope>;
export declare function resolveRelayRoute(bound: BoundCommand, stateRoot: string): Promise<{
    readonly resolved: BoundCommand;
    readonly op: RelayUnsignedOperation;
}>;
export {};
