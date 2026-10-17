import { protocolFailure, rpcArray, rpcRecord, solanaAddress } from "../solana/rpc.js";

/** Resolve compiled instruction indexes for getTransaction encoding:"json" (static, loaded writable, loaded readonly). */
export function solanaJsonAccountKeys(resultValue: unknown): readonly string[] {
  const result = rpcRecord(resultValue);
  const wire = rpcRecord(rpcRecord(result.transaction).message);
  const meta = rpcRecord(result.meta);
  const staticKeys = rpcArray(wire.accountKeys, 256).map(raw => {
    if (typeof raw !== "string") protocolFailure();
    return solanaAddress(raw);
  });
  if (staticKeys.length === 0) protocolFailure();
  const version = result.version;
  if (version !== undefined && version !== "legacy" && version !== 0) protocolFailure();
  const loaded = meta.loadedAddresses;
  let writable: readonly string[] = [], readonly: readonly string[] = [];
  if (loaded !== undefined) {
    const addresses = rpcRecord(loaded);
    writable = rpcArray(addresses.writable, 256).map(raw => {
      if (typeof raw !== "string") protocolFailure();
      return solanaAddress(raw);
    });
    readonly = rpcArray(addresses.readonly, 256).map(raw => {
      if (typeof raw !== "string") protocolFailure();
      return solanaAddress(raw);
    });
  }
  if (version === 0) {
    if (loaded === undefined) protocolFailure();
    let writableCount = 0, readonlyCount = 0;
    for (const item of rpcArray(wire.addressTableLookups, 64)) {
      const lookup = rpcRecord(item);
      if (typeof lookup.accountKey !== "string") protocolFailure();
      solanaAddress(lookup.accountKey);
      const writableIndexes = rpcArray(lookup.writableIndexes, 256);
      const readonlyIndexes = rpcArray(lookup.readonlyIndexes, 256);
      for (const index of [...writableIndexes, ...readonlyIndexes]) {
        if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) > 255) protocolFailure();
      }
      if (new Set([...writableIndexes, ...readonlyIndexes]).size !== writableIndexes.length + readonlyIndexes.length) protocolFailure();
      writableCount += writableIndexes.length;
      readonlyCount += readonlyIndexes.length;
    }
    if (writableCount !== writable.length || readonlyCount !== readonly.length) protocolFailure();
  } else if (writable.length !== 0 || readonly.length !== 0 || wire.addressTableLookups !== undefined) protocolFailure();
  const keys = [...staticKeys, ...writable, ...readonly];
  if (keys.length > 256 || new Set(keys).size !== keys.length) protocolFailure();
  return keys;
}
