import { dispatchDiscovery, renderDiscoveryOutput } from "./command-catalog.js";
import { runCli } from "./cli.js";
import { MCP_LAUNCH_DESCRIPTOR_JSON } from "./mcp-config.js";
import { serveMcpStdio } from "./mcp-server.js";
const argv = process.argv.slice(2);
const discovery = dispatchDiscovery(argv);
if (discovery !== null) {
    process.stdout.write(`${renderDiscoveryOutput(discovery)}\n`);
    process.exitCode = discovery.exitCode;
}
else if (argv.length === 2 && argv[0] === "mcp" && argv[1] === "config") {
    process.stdout.write(`${MCP_LAUNCH_DESCRIPTOR_JSON}\n`);
}
else if (argv.length === 2 && argv[0] === "mcp" && argv[1] === "serve") {
    try {
        await serveMcpStdio();
    }
    catch {
        process.stderr.write("APN MCP server failed safely.\n");
        process.exitCode = 1;
    }
}
else {
    const envelope = await runCli(argv);
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    process.exitCode = envelope.ok ? 0 : 1;
}
//# sourceMappingURL=bin.js.map