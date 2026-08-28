import { dispatchDiscovery, renderDiscoveryOutput } from "./command-catalog.js";
import { runCli } from "./cli.js";
const argv = process.argv.slice(2);
const discovery = dispatchDiscovery(argv);
if (discovery !== null) {
    process.stdout.write(`${renderDiscoveryOutput(discovery)}\n`);
    process.exitCode = discovery.exitCode;
}
else {
    const envelope = await runCli(argv);
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    process.exitCode = envelope.ok ? 0 : 1;
}
//# sourceMappingURL=bin.js.map