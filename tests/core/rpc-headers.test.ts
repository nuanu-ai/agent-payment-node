import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { test } from "node:test";
import { PRODUCT_VERSION } from "../../src/constants.js";
import { postJson } from "../../src/rpc.js";

test("JSON-RPC POST sends honest JSON headers and accepts a batch response", async (context) => {
  const methods = ["eth_chainId", "eth_blockNumber"];
  const batch = methods.map((method, index) => ({ jsonrpc: "2.0", id: String(index + 1), method, params: [] }));
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST");
      assert.equal(request.headers["content-type"], "application/json");
      assert.equal(request.headers.accept, "application/json");
      assert.equal(request.headers["user-agent"], `APN/${PRODUCT_VERSION}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      assert.equal(request.headers["content-length"], String(body.length));
      assert.deepEqual(JSON.parse(body.toString("utf8")), batch);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(batch.map(({ id }, index) => ({ jsonrpc: "2.0", id, result: index === 0 ? "0x82" : "0x1" }))));
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const raw = await postJson(
    new URL(`http://127.0.0.1:${address.port}/`),
    JSON.stringify(batch),
    [{ address: "127.0.0.1", family: 4 }],
    2_000,
    "batch",
    false,
    httpRequest as typeof import("node:https").request,
  );
  assert.deepEqual(JSON.parse(raw), [
    { jsonrpc: "2.0", id: "1", result: "0x82" },
    { jsonrpc: "2.0", id: "2", result: "0x1" },
  ]);
});
