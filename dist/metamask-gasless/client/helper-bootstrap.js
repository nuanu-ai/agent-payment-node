// The pid of the APN command that spawned this helper, read as the very first statement, before any module of the helper
// loads: a command that dies from here on is noticed (helper-entry.ts). Node's own startup before it is not covered.
const parent = process.ppid;
const { installGaslessDependencyBoundary } = await import("./dependency-boundary.js");
installGaslessDependencyBoundary();
const { runHelper } = await import("./helper-entry.js");
await runHelper(parent);
export {};
//# sourceMappingURL=helper-bootstrap.js.map