import { ApnError } from "./errors.js";
export function postEffectReadFailure(error) {
    const apn = error instanceof ApnError ? error : null, details = apn?.details;
    const reason = [details?.reason, details?.transportReason].find((value) => typeof value === "string" && /^[A-Za-z_]{3,64}$/u.test(value));
    const status = typeof details?.httpStatus === "number" ? details.httpStatus
        : typeof details?.httpStatus === "string" && /^[1-5][0-9]{2}$/u.test(details.httpStatus) ? Number(details.httpStatus) : null;
    return { code: apn !== null && /^APN_[A-Z0-9_]{1,60}$/u.test(apn.code) ? apn.code : null, reason: reason ?? null,
        httpStatus: status !== null && Number.isSafeInteger(status) && status >= 100 && status <= 599 ? status : null };
}
//# sourceMappingURL=post-effect-read-failure.js.map