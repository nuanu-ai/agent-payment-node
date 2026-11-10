#!/usr/bin/env node
// The Node.js guard is the only static import: an unsupported Node prints one line before any runtime module links.
import { unsupportedNodeMessage } from "../dist/node-version-guard.js";

const unsupported = unsupportedNodeMessage(process.versions.node);
if (unsupported !== null) {
  process.stderr.write(`${unsupported}\n`);
  process.exitCode = 1;
} else {
  const { installRuntimeDependencyBoundary } = await import("../dist/runtime-dependency-boundary.js");
  installRuntimeDependencyBoundary();
  await import("../dist/bin.js");
}
