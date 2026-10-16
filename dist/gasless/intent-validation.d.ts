import type { GaslessIntent } from "./model.js";
/**
 * Load-time validation of a saved intent (rule R2): only the record's own fields and hashes and the schema it was
 * written with. Registry pins, asset rows and offer constants can change in a later release; they are compared at
 * action time by `assertGaslessIntentCurrent`, so such a change can refuse a new effect but never break status,
 * resume or abandon of a saved operation, nor another family that lists every operation.
 */
export declare function validateGaslessIntent(value: unknown): GaslessIntent;
/**
 * Before any new effect the saved intent must still be what this release admits. A changed protocol pin, asset row or
 * policy mechanism refuses with `gasless_protocol_upgraded`, a changed offer rule with `gasless_offer_outdated`; both
 * mean: prepare a new transfer. Only saved facts are checked here, so neither can clear by waiting.
 */
export declare function assertGaslessIntentCurrent(i: GaslessIntent): void;
