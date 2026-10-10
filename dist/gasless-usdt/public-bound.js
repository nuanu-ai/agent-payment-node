import { isPlainRecord } from "../canonical.js";
/** Never expose signature-bearing sponsor bytes or authorization stubs through CLI/MCP. */
export function publicUsdtBound(value) {
    if (!isPlainRecord(value))
        return value;
    if (isPlainRecord(value.operation))
        return { ...value, operation: publicUsdtBound(value.operation) };
    if (value.schemaVersion !== "apn.gasless-usdt-bound-operation.v2" || !isPlainRecord(value.binding))
        return value;
    const b = value.binding;
    const { paymasterData: _bytes, unsignedOperation: _op, sponsorAuth: _auth, paymaster: _payload, ...binding } = b;
    const payload = isPlainRecord(_payload) ? _payload : {};
    const { signature: _signature, ...terms } = payload;
    const auth = isPlainRecord(_auth) ? _auth : {};
    const { signature: _sponsorSignature, ...capture } = auth;
    return { ...value, binding: { ...binding, paymaster: terms,
            sponsorAuth: { ...capture, meaning: "point_in_time_capture_not_current_authorization" } } };
}
//# sourceMappingURL=public-bound.js.map