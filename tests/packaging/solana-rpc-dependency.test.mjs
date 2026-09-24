import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { Connection } from "@solana/web3.js";

const require = createRequire(import.meta.url);

test("Solana web3 JSON-RPC remains compatible with the Jayson override", async () => {
  assert.equal(require("jayson/package.json").version, "5.0.0");
  const requests = [];
  const connection = new Connection("http://127.0.0.1:8899", {
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      assert.equal(request.method, "getSlot");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ jsonrpc: "2.0", id: request.id, result: 12345 }),
      };
    },
  });

  assert.equal(await connection.getSlot(), 12345);
  assert.equal(requests.length, 1);
});
