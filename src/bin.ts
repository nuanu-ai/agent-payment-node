import { dispatchDiscovery, renderDiscoveryOutput } from "./command-catalog.js";
import { runCli } from "./cli.js";
import { MCP_LAUNCH_DESCRIPTOR_JSON } from "./mcp-config.js";
import { serveMcpStdio } from "./mcp-server.js";
import { serveHttp } from "./http-server.js";
import { closedBlockerNotes } from "./output.js";

const argv = process.argv.slice(2);
const discovery = dispatchDiscovery(argv);
if (discovery !== null) {
  process.stdout.write(`${renderDiscoveryOutput(discovery)}\n`);
  process.exitCode = discovery.exitCode;
} else if (argv.length === 2 && argv[0] === "mcp" && argv[1] === "config") {
  process.stdout.write(`${MCP_LAUNCH_DESCRIPTOR_JSON}\n`);
} else if (argv.length === 2 && argv[0] === "mcp" && argv[1] === "serve") {
  try {
    await serveMcpStdio();
  } catch {
    process.stderr.write("APN MCP server failed safely.\n");
    process.exitCode = 1;
  }
} else if (argv.length === 2 && argv[0] === "serve" && argv[1] === "http") {
  try {
    await serveHttp();
  } catch (error) {
    process.stderr.write(`APN HTTP server failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  }
} else {
  const envelope = await runCli(argv);
  // A person at the terminal also reads, on stderr, which earlier operations were closed; stdout stays the one JSON envelope.
  if (process.stderr.isTTY === true) for (const note of closedBlockerNotes(envelope)) process.stderr.write(`${note}\n`);
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
  process.exitCode = envelope.ok ? 0 : 1;
}
