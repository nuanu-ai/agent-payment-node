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
export function asApnError(error) {
    if (error instanceof ApnError)
        return error;
    return new ApnError("APN_INTERNAL", "The operation failed safely.");
}
export function assertInput(condition, message) {
    if (!condition)
        throw new ApnError("APN_INVALID_INPUT", message);
}
//# sourceMappingURL=errors.js.map