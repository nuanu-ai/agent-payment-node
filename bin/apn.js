#!/usr/bin/env node
import { installRuntimeDependencyBoundary } from "../dist/runtime-dependency-boundary.js";

installRuntimeDependencyBoundary();
await import("../dist/bin.js");
