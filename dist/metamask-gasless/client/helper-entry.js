import { mmFailure } from "../reasons.js";
import { executeHelperRequest } from "./service.js";
import { MM_HELPER_VERSION } from "./protocol.js";
const maximum = 1024 * 1024;
const stdout = process.stdout.write.bind(process.stdout);
console.log = console.error = console.warn = console.info = console.debug = () => undefined;
process.stderr.write = (() => true);
let size = 0;
const chunks = [];
try {
    for await (const chunk of process.stdin) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maximum)
            throw new Error();
        chunks.push(bytes);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
    const value = JSON.parse(text);
    const response = await executeHelperRequest(value);
    const encoded = JSON.stringify(response);
    if (Buffer.byteLength(encoded) > maximum)
        throw new Error();
    stdout(encoded);
}
catch {
    stdout(JSON.stringify({ version: MM_HELPER_VERSION, ok: false, failure: mmFailure("mm_gasless_internal") }));
}
//# sourceMappingURL=helper-entry.js.map