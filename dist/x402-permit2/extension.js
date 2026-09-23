import { exactKeys, isPlainRecord } from "../canonical.js";
const FIELDS = ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"];
/** Recognize the version-one server declaration from @x402/extensions, without altering its contents. */
export function isEip2612GasSponsoringDeclaration(value) {
    if (!isPlainRecord(value) || !isPlainRecord(value.info) || !isPlainRecord(value.schema))
        return false;
    const { info, schema } = value;
    if (typeof info.description !== "string" || info.description.length === 0 || info.description.length > 1024 ||
        info.version !== "1" || schema.$schema !== "https://json-schema.org/draft/2020-12/schema" ||
        schema.type !== "object" || !isPlainRecord(schema.properties) || !Array.isArray(schema.required) ||
        schema.required.length !== FIELDS.length || !schema.required.every((field) => typeof field === "string") ||
        !exactKeys(Object.fromEntries(schema.required.map((field) => [field, true])), FIELDS))
        return false;
    const properties = schema.properties;
    return FIELDS.every((field) => {
        const property = properties[field];
        return isPlainRecord(property) && property.type === "string" && typeof property.pattern === "string";
    });
}
//# sourceMappingURL=extension.js.map