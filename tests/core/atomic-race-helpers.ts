/** Runs `rival` once, right after the next file sync: inside an atomic state write, between its two checks of the target. */
export async function racedAtSync<T>(rival: () => Promise<unknown>, action: () => Promise<T>): Promise<T> {
  const { open } = await import("node:fs/promises");
  const probe = await open(process.execPath, "r"), handle = Object.getPrototypeOf(probe) as { sync(this: unknown): Promise<void> };
  await probe.close();
  const sync = handle.sync;
  let armed = true;
  handle.sync = async function (this: unknown) { await sync.call(this); if (armed) { armed = false; await rival(); } };
  try { return await action(); } finally { handle.sync = sync; }
}
