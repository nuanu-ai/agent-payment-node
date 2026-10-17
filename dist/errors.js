export class ApnError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "ApnError";
        this.code = code;
        if (details !== undefined)
            this.details = details;
    }
}
/** Unexpected exceptions keep only their class name (never the message), so a bug can be told from an environment fault. */
export function asApnError(error) {
    if (error instanceof ApnError)
        return error;
    const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(error.name) ? error.name : typeof error;
    return new ApnError("APN_INTERNAL", "The operation failed safely.", { internal_class: name });
}
export function assertInput(condition, message) {
    if (!condition)
        throw new ApnError("APN_INVALID_INPUT", message);
}
//# sourceMappingURL=errors.js.map