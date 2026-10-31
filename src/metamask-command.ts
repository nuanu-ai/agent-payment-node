import { resolveMetaMaskBin } from "./metamask-package.js";

const shellWord = (value: string) => /^[A-Za-z0-9_./@:+=-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/**
 * `mm` written as the pinned client run by APN's own Node, as a shell command prefix: Homebrew links only `apn`, so a
 * bare `mm` is not on the owner's PATH.
 */
export async function metaMaskCommand(): Promise<string> {
  return `${shellWord(process.execPath)} ${shellWord(await resolveMetaMaskBin())}`;
}
