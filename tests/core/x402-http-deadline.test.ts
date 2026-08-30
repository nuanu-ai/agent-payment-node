import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { resolvePublicAddresses } from "../../src/network-policy.js";
import { HttpsX402Http } from "../../src/x402-http.js";

type TimerHandle = ReturnType<typeof setTimeout>;

interface AdapterInternals {
  nowMs: () => number;
  scheduleDeadline: (callback: () => void, delayMs: number) => TimerHandle;
  cancelDeadline: (timer: TimerHandle) => void;
  resolveAddresses: typeof resolvePublicAddresses;
  request: typeof httpsRequest;
}

class ControlledDeadlines {
  value = 0;
  readonly delays: number[] = [];
  private sequence = 0;
  private readonly timers = new Map<number, { readonly due: number; readonly callback: () => void }>();

  readonly now = (): number => this.value;

  readonly schedule = (callback: () => void, delayMs: number): TimerHandle => {
    const id = ++this.sequence;
    this.delays.push(delayMs);
    this.timers.set(id, { due: this.value + delayMs, callback });
    return id as unknown as TimerHandle;
  };

  readonly cancel = (timer: TimerHandle): void => {
    this.timers.delete(timer as unknown as number);
  };

  elapseWithoutCallbacks(milliseconds: number): void {
    this.value += milliseconds;
  }

  advance(milliseconds: number): void {
    this.value += milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= this.value)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (due === undefined) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

function inject(http: HttpsX402Http, values: Partial<AdapterInternals>): void {
  Object.assign(http as unknown as AdapterInternals, values);
}

test("production seller adapter bounds unresolved DNS with the total monotonic deadline", async () => {
  const deadlines = new ControlledDeadlines();
  const http = new HttpsX402Http();
  let transportCalls = 0;
  let finishDns: ((value: readonly [{ readonly address: "1.1.1.1"; readonly family: 4 }]) => void) | undefined;
  inject(http, {
    nowMs: deadlines.now,
    scheduleDeadline: deadlines.schedule,
    cancelDeadline: deadlines.cancel,
    resolveAddresses: async () => await new Promise((resolve) => { finishDns = resolve; }),
    request: (() => { transportCalls += 1; throw new Error("transport must not start"); }) as typeof httpsRequest,
  });

  const pending = http.get({ url: "https://seller.example/resource", timeoutMs: 100 });
  deadlines.advance(100);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_HTTP_AMBIGUOUS");
    assert.equal(error.message, "Seller request timed out.");
    return true;
  });
  assert.ok(finishDns !== undefined);
  finishDns([{ address: "1.1.1.1", family: 4 }]);
  await Promise.resolve();
  assert.equal(transportCalls, 0);
  assert.deepEqual(deadlines.delays, [100]);
});

test("production seller adapter rejects DNS success after a stalled timer setup without rebasing", async () => {
  const deadlines = new ControlledDeadlines();
  const http = new HttpsX402Http();
  let scheduleCalls = 0;
  let transportCalls = 0;
  inject(http, {
    nowMs: deadlines.now,
    scheduleDeadline: (callback, delayMs) => {
      scheduleCalls += 1;
      if (scheduleCalls === 1) deadlines.elapseWithoutCallbacks(101);
      return deadlines.schedule(callback, delayMs);
    },
    cancelDeadline: deadlines.cancel,
    resolveAddresses: async () => [{ address: "1.1.1.1", family: 4 }],
    request: (() => { transportCalls += 1; throw new Error("transport must not start"); }) as typeof httpsRequest,
  });

  await assert.rejects(http.get({ url: "https://seller.example/resource", timeoutMs: 100 }), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_HTTP_AMBIGUOUS");
    assert.equal(error.message, "Seller request timed out.");
    return true;
  });
  assert.equal(deadlines.value, 101);
  assert.equal(transportCalls, 0);
  assert.deepEqual(deadlines.delays, [100]);
});

test("production seller adapter uses only post-DNS budget and stops a drip body at the total deadline", async () => {
  const deadlines = new ControlledDeadlines();
  const http = new HttpsX402Http();
  let requestDestroyed = 0;
  let responseDestroyed = 0;
  const requestOnce = ((_endpoint: URL, options: { readonly method?: string }, callback: (response: IncomingMessage) => void) => {
    assert.equal(options.method, "GET");
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      rawHeaders: string[];
      rawTrailers: string[];
      socket: { authorized: boolean; remoteAddress: string };
      destroy: () => void;
    };
    response.statusCode = 200;
    response.rawHeaders = ["content-type", "application/json"];
    response.rawTrailers = [];
    response.socket = { authorized: true, remoteAddress: "1.1.1.1" };
    response.destroy = () => { responseDestroyed += 1; };
    request.destroy = () => { requestDestroyed += 1; };
    request.end = () => {
      callback(response as unknown as IncomingMessage);
      response.emit("data", Buffer.from("{"));
      deadlines.advance(30);
      response.emit("data", Buffer.from("}"));
      deadlines.advance(30);
      response.emit("end");
    };
    return request;
  }) as unknown as typeof httpsRequest;
  inject(http, {
    nowMs: deadlines.now,
    scheduleDeadline: deadlines.schedule,
    cancelDeadline: deadlines.cancel,
    resolveAddresses: async () => {
      deadlines.advance(40);
      return [{ address: "1.1.1.1", family: 4 }];
    },
    request: requestOnce,
  });

  await assert.rejects(http.get({ url: "https://seller.example/resource", timeoutMs: 100 }), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_HTTP_AMBIGUOUS");
    assert.equal(error.message, "Seller request timed out.");
    return true;
  });
  assert.deepEqual(deadlines.delays, [100, 60]);
  assert.equal(deadlines.value, 100);
  assert.equal(requestDestroyed, 1);
  assert.equal(responseDestroyed, 1);
});

test("production seller adapter never rebases a stale transport duration past the original deadline", async () => {
  const deadlines = new ControlledDeadlines();
  const http = new HttpsX402Http();
  let requestCalls = 0;
  let requestDestroyed = 0;
  let responseDestroyed = 0;
  const requestOnce = ((_endpoint: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
    requestCalls += 1;
    deadlines.elapseWithoutCallbacks(61);
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    const response = new EventEmitter() as EventEmitter & {
      statusCode: number;
      rawHeaders: string[];
      rawTrailers: string[];
      socket: { authorized: boolean; remoteAddress: string };
      destroy: () => void;
    };
    response.statusCode = 200;
    response.rawHeaders = ["content-type", "application/json"];
    response.rawTrailers = [];
    response.socket = { authorized: true, remoteAddress: "1.1.1.1" };
    response.destroy = () => { responseDestroyed += 1; };
    request.destroy = () => { requestDestroyed += 1; };
    request.end = () => {
      callback(response as unknown as IncomingMessage);
      response.emit("data", Buffer.from("{}"));
      response.emit("end");
    };
    return request;
  }) as unknown as typeof httpsRequest;
  inject(http, {
    nowMs: deadlines.now,
    scheduleDeadline: deadlines.schedule,
    cancelDeadline: deadlines.cancel,
    resolveAddresses: async () => {
      deadlines.advance(40);
      return [{ address: "1.1.1.1", family: 4 }];
    },
    request: requestOnce,
  });

  await assert.rejects(http.get({ url: "https://seller.example/resource", timeoutMs: 100 }), (error: unknown) => {
    assert.ok(error instanceof ApnError);
    assert.equal(error.code, "APN_HTTP_AMBIGUOUS");
    assert.equal(error.message, "Seller request timed out.");
    return true;
  });
  assert.deepEqual(deadlines.delays, [100, 60]);
  assert.equal(deadlines.value, 101);
  assert.equal(requestCalls, 1);
  assert.equal(requestDestroyed, 1);
  assert.equal(responseDestroyed, 1);
});
