# pocket_worker_esp

An ESP-IDF 6.2.x FreeRTOS owner for the shared PocketJS worker core and isolated QuickJS-NG 0.14.0 realm. Configure firmware-owned nodes, a generation, source bytes, heap/stack limits, the memory of the QuickJS heap and the task stack (`heap_caps`, `task_stack_caps`; zero selects internal RAM), and an optional CPU share (`quota_micros` per `window_micros`; zero disables it, and there is no execution time limit). The source, node table and drivers must outlive the runner. Set `defer_turns` when UI bootstrap must finish before the first worker turn; `pocket_worker_esp_resume` releases that gate after the bridge is attached and the UI bundle has evaluated. `pocket_worker_esp_core` supports a UI channel bridge; detach the bridge before calling `stop`, including after a worker fault.

`stop` interrupts a turn in progress, joins native users and the timer callback before freeing the core and realm. A timeout preserves all resources and requires another `stop` call. The runner mounts the worker transport and console only. It does not mount UI, files, databases, or network APIs.

The shared sources come from `POCKETJS_ROOT/engine/worker`, defaulting to the pinned submodule. See [configuration, limits and validation](../../../docs/WORKER.md).
