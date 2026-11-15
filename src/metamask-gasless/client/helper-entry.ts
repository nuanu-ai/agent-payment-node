import { mmFailure } from "../reasons.js";
import { executeHelperRequest } from "./service.js";
import { MM_HELPER_VERSION } from "./protocol.js";

const maximum = 1024 * 1024;
const stdout = process.stdout.write.bind(process.stdout);
console.log = console.error = console.warn = console.info = console.debug = () => undefined;
process.stderr.write = (() => true) as typeof process.stderr.write;
// The helper never outlives the APN command that spawned it. Once that parent is gone (the command died after the spawn,
// and its operation lock with it), the orphan is re-parented and exits at once, so a send it has not written yet is never
// written. Nobody reads its answer then; the command's own record of a send that started stays unknown, as it already was.
const parent = process.ppid;
setInterval(() => { if (process.ppid !== parent) process.exit(1); }, 100).unref();
let size = 0; const chunks: Buffer[] = [];
try {
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.length; if (size > maximum) throw new Error(); chunks.push(bytes);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  const value: unknown = JSON.parse(text);
  const response = await executeHelperRequest(value);
  const encoded = JSON.stringify(response);
  if (Buffer.byteLength(encoded) > maximum) throw new Error();
  stdout(encoded);
} catch {
  stdout(JSON.stringify({ version: MM_HELPER_VERSION, ok: false, failure: mmFailure("mm_gasless_internal") }));
}
