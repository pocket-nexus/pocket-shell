// SPDX-License-Identifier: GPL-3.0-or-later
// The UI's side of the fixture applet's worker (lib/feed-worker.ts): a URL
// goes out as one `request` record, and each `response` record is the text
// the worker read from it. The UI realm has no network of its own.
import { worker } from "@pocketjs/framework/worker/channels";

const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0x7f);

export interface Feed {
  /** Ask the worker for `url`; false while the ring is full. */
  ask(url: string): boolean;
  /** The texts that arrived for this frame. */
  take(): string[];
}

export function openFeed(): Feed {
  const requests = worker.channel("request");
  const responses = worker.channel("response");
  return {
    ask: (url) => requests.publish(ascii(url)),
    take: () => responses.observe().map((view) => String.fromCharCode(...view.copy())),
  };
}
