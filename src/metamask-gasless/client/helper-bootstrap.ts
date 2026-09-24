import { installGaslessDependencyBoundary } from "./dependency-boundary.js";

installGaslessDependencyBoundary();
await import("./helper-entry.js");
