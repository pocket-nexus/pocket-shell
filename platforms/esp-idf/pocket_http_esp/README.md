# pocket_http_esp

The worker's `io.http` resource (`contracts/spec/worker.ts`, kind 3, capability `net.http`) on `esp_http_client`. The firmware creates one driver and declares it as an `http` node; each opened resource holds one request, and two run at once. A request runs on its own task (12 KB stack, `task_stack_caps`) so the worker's owner task never blocks on DNS, a connect or a read.

The descriptor is the JSON the SDK's `io.http(name).open(...)` encodes, at most 1024 bytes: an `http://` or `https://` URL, a method of `GET HEAD POST PUT PATCH DELETE OPTIONS`, string header fields, a UTF-8 body (none for GET and HEAD), `timeoutMs` 1..120000 (30000) and `maxBytes` 0..262144 (262144). Open refuses any other descriptor. `submit()` starts the request; the stream carries one headers fact `{"status":S,"url":U,"headers":{...}}`, data facts of at most 1024 bytes with their offsets, then the end fact, whose status settles the request. The 3DS provider (`engine/host-services/link_http.c`) produces the same facts.

| Rule | Value |
| --- | --- |
| TLS | mbedTLS with the ESP x509 certificate bundle (`esp_crt_bundle_attach`); `clock_wait` holds an `https://` hop until the wall clock is set |
| Connections | a request task keeps the connection of its last request for 10 s when the whole response arrived and the server holds it open; a `GET`, `HEAD`, `PUT`, `DELETE` or `OPTIONS` to the same scheme, host and port goes out on it, and again on a new connection when the kept one fails before the response head; `POST`, `PATCH` and a URL with userinfo connect anew; open gives a request to the free task that keeps its origin's connection |
| Request headers | hop-by-hop fields, `host`, `content-length` and `expect` dropped; `User-Agent: PocketJS/1` unless the request names one |
| Redirects | followed by the request task, at most 3; 303, and 301/302 after POST, become GET without a body or `content-type`; `authorization` and `cookie` are dropped across origins |
| Headers record | lower-case names, hop-by-hop fields dropped, repeats joined with `, ` (`set-cookie` with a newline); `content-type`, `location`, `etag`, `last-modified`, `cache-control`, `expires`, `date`, `retry-after` first; a field that does not fit the 1024-byte record is left out |
| Body | read in 1024-byte records; a `Content-Length` over `maxBytes`, or more body bytes than it, fails the request |
| Backpressure | when the worker's eight event slots are full the task stops reading the socket and retries every tick |

A request whose host is `companion.pocket` (`LINK_SERVICES_HOST` in pocketjs `contracts/spec/link.ts`, under either scheme and on any port) is not resolved by DNS when the config names a `companion` transport: the request task passes the descriptor as opened to the transport's `start`, forwards the headers, data and end facts its `take` returns, and closes it on a cancel or at the deadline. A transport that cannot start the request answers `code: message`, and the request fails with that error fact. The same two requests and 1024-byte descriptor hold on both paths. On the Tab5, `pocket_system` is the transport, over the Pocket Link (its README, "Companion services"). Without one, `companion.pocket` resolves like any host.

A failure emits an error fact whose bytes are `code: message` (`dns`, `connect`, `tls`, `timeout`, `redirect`, `response_too_large`, `protocol`, `invalid_request`, `unavailable`, `other`) and ends the stream with a status:

| Status | When |
| --- | --- |
| `ok` | the whole response arrived (any HTTP status) |
| `failed` | nothing was sent, or the response head arrived and its body failed |
| `unknown` | the request was sent and no response head arrived: timeout or a closed connection; or a cancel after sending |
| `cancelled` | a cancel or close before the request was sent |

A request task waits for the response head and body in reads of at most 500 ms, so a cancel or the deadline ends a wait within that time; a connect or TLS handshake runs until it completes or the request's deadline passes. Close returns `BUSY` while the task holds the request, and the core retries it every millisecond.

`src/record.c` holds the descriptor parser, URL resolution and the headers record without IDF dependencies; `tools/test-worker-io.sh` runs `tests/http-record.c` against it with AddressSanitizer and UndefinedBehaviorSanitizer.
