// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/net-worker.ts — the worker every networked applet here
// declares (ui/net-wire.ts NET_WORKER): it performs the UI's requests with
// the host's `http` node and streams each answer back as response records.
// On a 3DS the node rides the Pocket Link to the paired Mac; on a Tab5 it is
// the firmware's own HTTP over Wi-Fi.
//
// At most NODE_REQUESTS run at once; the rest wait in arrival order. Each
// running request is one task. The answers of every task share one queue toward
// the response ring, which retries every 15 ms while the ring is full, so a
// page the UI has not drained yet holds the next records instead of losing
// them.

import { FactKind, io, ResourceStatus, type HttpRequest } from "@pocketjs/framework/io";
import { settle, sleep } from "@pocketjs/framework/worker";
import { Answer, ANSWER_BYTES, decodeRequest, encodeAnswer, encodeEnd, NODE_REQUESTS, requestId, text } from "./net-wire.ts";

const RETRY_MICROS = 15_000;

const responses = io.channel("response");
const unsent: Uint8Array[] = [];
let flushing = false;

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  while (unsent.length > 0) {
    if (responses.publish(unsent[0]!)) unsent.shift();
    else await sleep(RETRY_MICROS);
  }
  flushing = false;
}

/** `payload` in records of at most ANSWER_BYTES; an empty one is one record. */
function send(id: number, kind: number, payload: Uint8Array): void {
  let at = 0;
  do {
    unsent.push(encodeAnswer(id, kind, payload.subarray(at, at + ANSWER_BYTES)));
    at += ANSWER_BYTES;
  } while (at < payload.length);
  void flush();
}

function end(id: number, status: number, failure = ""): void {
  send(id, Answer.end, encodeEnd(status, failure));
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One request: the headers record, the body and the end stream back as they
 *  arrive, and the loop stops at the end fact. Closing the resource ends its
 *  stream and drops the records it holds, so it closes after the loop: a
 *  completion can arrive in the same turn as the last records. A request the
 *  node never started completes without an end fact; its resource closes a
 *  turn after the completion, when the loop has read everything before it.
 *  Every request gets one end, whatever fails. */
async function perform(record: Uint8Array): Promise<void> {
  const id = requestId(record);
  let ended = false;
  const finish = (status: number, failure: string) => {
    if (ended) return;
    ended = true;
    end(id, status, status === ResourceStatus.ok ? "" : failure);
  };
  try {
    let resource: HttpRequest;
    try {
      resource = io.http("http").open(decodeRequest(record).descriptor);
    } catch (error) {
      finish(ResourceStatus.invalid, `invalid_request: ${reason(error)}`);
      return;
    }
    const started = resource.submit();
    if (started < 0) {
      resource.close();
      finish(ResourceStatus.busy, "unavailable: the request could not start");
      return;
    }
    const completion = settle(started);
    let sawEnd = false;
    void completion.then(() => sleep(0)).then(() => {
      if (!sawEnd) resource.close();
    });
    let failure = "";
    for await (const fact of resource.observe()) {
      if (fact.kind === FactKind.headers) send(id, Answer.head, fact.data);
      else if (fact.kind === FactKind.data) send(id, Answer.body, fact.data);
      else if (fact.kind === FactKind.error) failure = text(fact.data);
      else if (fact.kind === FactKind.end) {
        sawEnd = true;
        finish(fact.status, failure);
        break;
      }
    }
    const outcome = await completion;
    resource.close();
    finish(outcome.status, failure);
  } catch (error) {
    finish(ResourceStatus.failed, `other: ${reason(error)}`);
  }
}

const waiting: Uint8Array[] = [];
let running = 0;

function next(): void {
  while (running < NODE_REQUESTS && waiting.length > 0) {
    running++;
    void perform(waiting.shift()!).then(() => {
      running--;
      next();
    });
  }
}

async function main(): Promise<void> {
  for await (const record of io.channel("request").observe()) {
    waiting.push(record);
    next();
  }
}
main();
