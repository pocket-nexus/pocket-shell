# pocket_mqtt_esp

The worker's `io.mqtt` resource (`contracts/spec/worker.ts`, kind 4, capability `net.mqtt`) on esp-mqtt, the `espressif/mqtt` 1.1.0 managed component (ESP-IDF 6 moved esp-mqtt out of the IDF tree). The firmware creates one driver and declares it as an `mqtt` node; each opened resource is one MQTT 3.1.1 or 5.0 session with one broker over `mqtt://`, `mqtts://`, `ws://` or `wss://`. The byte layouts are those of PocketJS `contracts/spec/mqtt.ts`; `src/record.c` parses them without IDF dependencies.

## Sessions and tasks

The driver has three session slots. Each slot has a control task (8 KiB stack, `task_stack_caps`) and, while a session runs, an esp-mqtt client task (`client_stack`, 8 KiB by default). The worker's owner task never calls esp-mqtt: open parses the descriptor, start queues a request, write copies bytes, and the control task makes every esp-mqtt call. esp-mqtt holds its API lock through a connect attempt and through the event handler, so a call can block for the connect timeout; it blocks the control task only.

Open parses the descriptor and connects at once, or, when the descriptor announces TLS material (CA, client certificate, client key; at most 16 KiB each), after `write()` delivered those bytes. PEM is passed NUL-terminated, anything else as DER. Without a CA a secure session verifies the broker against the ESP certificate bundle. A secure session waits through `clock_wait` before its first connect, since mbedTLS checks certificate dates.

Close detaches the session from the worker core at once and returns `OK`: every later call into the core (facts, completions, the end) checks the slot's attachment under the driver mutex, and requests are copied at start, so no core storage is read after close. The control task then sends DISCONNECT, stops the client and frees the slot. A slot stays taken until its client stopped, which a connect attempt in progress delays up to the session's timeout.

The control task schedules reconnects: esp-mqtt's own reconnect is off and its task looks for a stop every 200 ms while it waits. A disconnection reconnects after `reconnectMs`, except when `reconnectMs` is 0 or the broker refused the CONNECT with a code a retry cannot change; then the session ends with an `end` fact (status `failed`) after its error fact. Transient refusals are 3.1.1 code 3 (server unavailable) and MQTT 5 0x88, 0x89, 0x97 and 0x9f.

## Facts

| Fact | When | Data |
| --- | --- | --- |
| `headers` | each CONNACK | the CONNACK record: session present, protocol, the broker's MQTT 5 limits, response information and user properties |
| `data` | an incoming PUBLISH | the message record, in facts of at most 1024 bytes; the offset counts record bytes |
| `gap` | a dropped message | the count in the request field |
| `error` | a failed connect or a dropped connection | `code: message` |
| `end` | the session stops reconnecting | status `failed` |

Error codes are `unavailable` (no address on the network, or not connected), `invalid_request`, `busy` (outbox full), `dns`, `connect`, `tls` (with the mbedTLS code and verify flags), `timeout`, `refused` (with the return or reason code), `closed` (the broker closed the connection or sent DISCONNECT) and `protocol`.

The event handler runs on the esp-mqtt task. While the worker's eight event slots are full it waits, which stops the client's socket reads and lets TCP hold the broker. It drops a message, and emits a gap, when its payload exceeds `maxMessageBytes`, when its topic and properties exceed 4096 bytes, or when the worker took no fact for 2 s (100 ms for the first fact of a message after a drop the worker has not observed). Under MQTT 5 the session announces a maximum packet size of `maxMessageBytes` + 4112 bytes unless the descriptor sets one; esp-mqtt would announce its 4096-byte input buffer, and the broker withholds larger messages without the session seeing them.

## Requests

| Opcode | Request | Completion |
| --- | --- | --- |
| 1 | PUBLISH | QoS 0: `ok` once written; QoS 1 and 2: `ok` with the PUBACK or PUBCOMP reason code, `failed` for a reason code of 0x80 and above, `unknown` when the message expired in the outbox |
| 2 | SUBSCRIBE, at most 8 filters | `ok` with a SUBACK code per filter |
| 3 | UNSUBSCRIBE, at most 8 filters | `ok` with a code per filter (0 under 3.1.1); esp-mqtt sends one UNSUBSCRIBE per filter |
| 4 | the DISCONNECT sent at close | `ok` once stored |

A failed completion carries `code: message` text. QoS 0 publishes, subscribes and unsubscribes fail with `unavailable` while the session is disconnected; QoS 1 and 2 publishes wait in esp-mqtt's outbox (512 KiB limit) and expire after `CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS` (30 s). A sent packet cannot be recalled: a cancel settles the request as `unknown` and the acknowledgement releases it. Requests run in the order of their request ids. A staged publish takes the payload written with `write()` since the previous staged publish (at most 256 KiB, grown on demand in `memory_caps`); an empty write clears it, and writes are refused while a staged publish holds it.

ESP-IDF limits: the subscription identifier is 16 bits (1..65535); esp-mqtt leaves a session expiry of 0 out of DISCONNECT, so the driver refuses that request; the MQTT 5 options of a SUBSCRIBE apply to every filter of the request.

## Configuration

The program's `sdkconfig.defaults` must set `CONFIG_MQTT_PROTOCOL_5` and `CONFIG_MQTT_REPORT_DELETED_MESSAGES` (an expired QoS 1 or 2 message settles its publish); the component does not compile without them. `programs/m5stack-tab5` also puts esp-mqtt's buffers, task stacks and outbox in PSRAM and its tasks on core 1.

Storage per slot in `memory_caps`: the parsed descriptor (about 5 KiB), eight request copies (1 KiB each), a 4 KiB message-head buffer, two 1 KiB record buffers, the staging buffer and the TLS material. esp-mqtt allocates its input and output buffers (4096 bytes each) per running client.

`tools/test-worker-io.sh` encodes requests with the PocketJS SDK (`tests/mqtt-vectors.ts`) and parses them with `src/record.c` in `tests/mqtt-record.c`, under AddressSanitizer and UndefinedBehaviorSanitizer.
