// SPDX-License-Identifier: GPL-3.0-or-later
// The fixture applet's worker (`domains.worker` in feed/pocket.app.json):
// each `request` record is a URL. The worker reads it with the host's http
// node and publishes the start of the body, at most one record, on
// `response`.
import { FactKind, io, utf8Text } from "@pocketjs/framework/io";
import { settle, sleep } from "@pocketjs/framework/worker";

const responses = io.channel("response");

async function read(url: string): Promise<void> {
  const resource = io.http("http").open({ url, maxBytes: responses.recordBytes });
  const started = resource.submit();
  if (started < 0) {
    resource.close();
    return;
  }
  // The stream ends when the resource closes. It closes a turn after the
  // request completes, so the loop reads the records of the completion's turn.
  void settle(started).then(() => sleep(0)).then(() => resource.close());
  let published = false;
  for await (const fact of resource.observe()) {
    if (fact.kind !== FactKind.data || published) continue;
    published = responses.publish(fact.data.subarray(0, responses.recordBytes));
  }
}

async function main(): Promise<void> {
  for await (const record of io.channel("request").observe()) void read(utf8Text(record));
}
main();
