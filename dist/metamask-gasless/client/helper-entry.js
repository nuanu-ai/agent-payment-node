import { mmFailure } from "../reasons.js";
import { executeHelperRequest } from "./service.js";
import { MM_HELPER_VERSION } from "./protocol.js";
const maximum = 1024 * 1024;
/**
 * The helper process: one request on stdin, one answer on stdout. It never outlives the APN command that spawned it,
 * whose pid `parent` the bootstrap read first. Once that command is gone (it died after the spawn, and its operation
 * lock with it), the orphan is re-parented: every 100 ms the helper checks, and exits when its parent changed, and right
 * before a send is written the network policy checks again and refuses with nothing written. Nobody reads its answer
 * then; the command's own record of a send that started stays unknown, as it already was. A send whose request was
 * already written may still reach MetaMask; the send's deadline bounds every write either way.
 */
export async function runHelper(parent) {
    const stdout = process.stdout.write.bind(process.stdout);
    console.log = console.error = console.warn = console.info = console.debug = () => undefined;
    process.stderr.write = (() => true);
    const parentAlive = () => process.ppid === parent;
    setInterval(() => { if (!parentAlive())
        process.exit(1); }, 100).unref();
    if (!parentAlive())
        process.exit(1);
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
        const response = await executeHelperRequest(value, { parentAlive });
        const encoded = JSON.stringify(response);
        if (Buffer.byteLength(encoded) > maximum)
            throw new Error();
        stdout(encoded);
    }
    catch {
        stdout(JSON.stringify({ version: MM_HELPER_VERSION, ok: false, failure: mmFailure("mm_gasless_internal") }));
    }
}
//# sourceMappingURL=helper-entry.js.map