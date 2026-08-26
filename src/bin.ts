import { runCli } from "./cli.js";

const envelope = await runCli(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(envelope)}\n`);
process.exitCode = envelope.ok ? 0 : 1;
