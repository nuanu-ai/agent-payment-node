import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function testRuntime<Runtime>(fallback: Runtime, moduleName: string): Promise<Runtime> {
  const root = process.env.APN_TEST_PACKAGE_ROOT;
  return root === undefined ? fallback : await import(pathToFileURL(resolve(root, "dist", moduleName)).href) as Runtime;
}
