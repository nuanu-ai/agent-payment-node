# MCP setup

[Documentation index](README.md) · [Product overview](../README.md)

APN has a local stdio MCP server. It has no hosted remote endpoint: remote MCP is outside this repository
(see [proof boundary](custody-and-recovery.md#proof-boundary)).

## Connect a client

Run the commands below. They are the ones listed in the [command reference](command-reference.md).

```sh
apn mcp config
apn mcp serve
```

`apn mcp config` prints the launch descriptor for the server. `apn mcp serve` runs the stdio server; your MCP client
starts it as a local process. Put the descriptor into your client's own MCP server settings.

APN requires Node 24 (`>=24 <27`). On another Node.js, `apn mcp serve` prints one `APN_NODE_UNSUPPORTED` line on stderr,
writes nothing to stdout and exits 1. See [Install](getting-started.md#install).

## What the agent can and cannot do

The tools are projected from the same catalog as the CLI and run the same code. The agent never approves a payment:
approval, execution, abandon, wallet connect and allowlist activation need a human in a foreground terminal. For these,
the `apn_foreground_handoff` tool checks the arguments like the CLI does and returns the exact command for the human to
run. It reads and writes nothing.

The full rules, including the families that are CLI only, are in the section
[MCP never approves](how-it-works.md) of [How APN works](how-it-works.md).
