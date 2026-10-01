# Portable renderer and text experiment

Pocket Shell Desktop's System UI and installed demo bundles use SolidJS. The
framework implementation is pinned by the root `vendor/pocketjs` submodule
at merged commit `b5e2a274`. Runtime imports stay under
`@pocketjs/framework/*`. Paths and commands below start at the repository root.

## Ownership

| Work | Owner |
|---|---|
| Native window, input, clipboard, final GPU presentation | winit / wgpu adapter |
| Native QuickJS guests, Solid updates, flex layout, drawing, composition | native runtime worker |
| Browser guests and Rust software drawing | existing isolated iframe/WASM instances |
| Text wrapping, shaping and glyph rasterization | independent `io.offload` worker |
| PSP text execution | paired companion only; no text engine linked into PSP |
| Theme palettes, font slots, icons, metrics | System UI theme definitions |

`pocket-ui-wgpu` executes the core DrawList on native GPU targets, including
`SURFACE_QUAD` composition. WASM executes the same contract through
`engine/core/src/compositor.rs`. Both preserve child surface painter order and
scissor state outside the guest texture namespace. Native child textures are
cached by instance generation and DrawList/resource revision; a bounded pool
hands GPU frames to the window thread without CPU pixel copies. `AppSupervisor` retains independent realms, failure isolation,
focus routing and hidden-app suspension. Native layout/raster work never enters
the window event callback. Browser text work uses a Worker; the browser's general
UI rendering still uses the existing iframe scheduler.

`engine/crates/pocket-text` owns text execution. Atlas layout uses the same
Rust core and package font metrics as rendering. OpenType shaping and coverage
use COSMIC Text, Harfrust and Swash, with an empty font database populated only
from explicit package/provider font bytes. No CoreText, Fontconfig, installed
font directories, or OS text measurements are used. Winit and wgpu may
use OS APIs for native window presentation.

## Capability contract

Applications declare **both** `io.offload` and `text.layout.offload`. Resolution
rejects a text declaration without its transport dependency. Capability
admission means the host implements the service path; a positive offload
session and a provider grant are required for actual execution.

`@pocketjs/framework/text-layout` exposes `createTextLayout`,
`textLayoutAvailable` and the protocol budgets. `createTextLayout` uploads in
bounded chunks and receives pages through the existing framework service pump.
Callbacks enter only at frame boundaries. Small snapshots use `text.replace`; subsequent edits use a UTF-16 replacement
range against an acknowledged provider revision. Both return the first layout
page in the same worker job. Updating a document cancels old
client delivery; provider document revisions reject stale writes. Reconnection
reopens and uploads the latest requested revision. Closing a document releases
its provider allocation.

The transport never executes capability handlers in `submit` or `take`. Native
hosts use bounded channels and a dedicated worker; browsers use a Worker and
bounded credits. PSP uses a lower-priority host0 mailbox thread with fixed
buffers; that thread touches neither QuickJS, Ui, GE nor the global allocator.
Without the companion, its session is zero and no work is submitted. The UI
reports the pairing requirement instead of doing synchronous layout locally.

| Budget | Limit |
|---|---:|
| Wire record | 4096 UTF-8 bytes |
| Payload / response | 2500 UTF-16 units (Rust responses also bounded by UTF-8 bytes) |
| In-flight requests | 8 |
| Framework submissions per frame | 2 (PSP adapter accepts 1) |
| Deliveries per frame | 1 |
| Document upload chunk | 512 UTF-16 units, surrogate-safe boundaries |
| Inline replacement / edit | Up to 2048 UTF-16 units within the wire budget |
| Document size | 65536 UTF-16 units |
| Provider documents | 8 per instance / connection |
| Visual rows | 4096 |
| Result page | 32 rows |
| OpenType request | 512 UTF-16 units |
| Coverage tile | at most 448 × 16, packed 2-bit coverage |

Methods are `text.capabilities`, `text.replace`, `text.edit`, `text.open`, `text.append`, `text.layout`,
`text.close`, `text.shape`, and `text.raster`. Coordinates returned to guests
are UTF-16 source offsets. Text methods accept no filesystem paths or URLs.
Unknown methods, missing fonts, incomplete uploads, stale revisions and budget
violations return errors. `text.shape` returns paged cluster geometry, while
`text.raster` returns coverage compatible with `offload.uploadCoverage` on hosts
that implement that optional upload operation.

## Desktop behavior

Notepad's renderer retains the last accepted source/layout snapshot during
reflow; caret and hit geometry are used only when they match the live revision,
width and theme font. New keystrokes continue to edit the document. In-flight
snapshots finish before the next is scheduled so continuous typing cannot
starve presentation. Only visible text rows enter the UI tree.

Classic, XP and Aqua retain their baked fonts and appearance. OpenType shaping
is exposed as a framework experiment; Notepad does not yet switch automatically
to arbitrary Unicode font fallback. Missing glyphs in a baked theme retain that
atlas's existing missing-glyph behavior. This is not a complete rich document
editor, Unicode text editor, or production replacement for every device font
pipeline.

## Run a companion

Build the portable engine and a package first:

```sh
bun vendor/pocketjs/tools/text-wasm.ts
bun run desktop build
```

For a device with the paired LAN `io.offload` transport:

```sh
bun run desktop companion:text --address DEVICE_IP --key-file /path/to/pairing-key \
  --pak shells/desktop/dist/pocket-desktop-system-ui.pak
```

The pairing key is the existing 256-bit device key. It is not logged. Only
explicit provider-side fonts are granted; add `--font /path/to/font.ttf` to
expose OpenType shaping for that font family.

For PSP, use the framework's small standalone `apps/text-offload` demo and
its resolved PSP plan. Build through the normal PocketJS manifest flow, then
start the USB companion with the **same PSPLINK host0 root** used by the device:

```sh
cd vendor/pocketjs
bun tools/text-wasm.ts
bun tools/pocket.ts build --target psp --manifest apps/text-offload/pocket.json --project-root . -- --release
bun tools/text-provider.ts --usb /path/to/host0-root \
  --app dev.pocket-nexus.text-offload --pak dist/text-offload-main.pak
```

USB pairing is the explicit local tether/share grant, scoped by app ID. The
provider publishes an epoch/heartbeat; request/reply records additionally carry
a device boot ID and sequence. Old files and replies are rejected across
restarts. There is no network listener or font engine on the PSP. Do not expose
that trusted host0 root as a public share.

## Validation commands and historical scope

```sh
bun run desktop check          # types, System UI rules, async simulator journeys, text/USB tests
bun run desktop test:rust      # native text, native worker, compositor and AppSupervisor tests
bun run desktop build          # macOS release host and all installed packages
bun run desktop test:web       # real Chrome journey and dist/web-smoke.png
```

The imported renderer work at `b5e2a274` recorded: macOS release build and native first paint; native scripted
typing and autosave round-trip; Solid simulator
editing/selection/undo, theme changes and surface focus; browser initialization
and Hero raster composition; Rust/WASM text parity at multiple widths;
OpenType shaping with package font bytes; bounded and stale-revision rejection;
reconnect; a real companion Worker through the USB packet adapter; PSP release
build with the text-offload capability enabled.

Linux build/package/launch is checked in CI. PSP physical pairing, input latency and frame-rate
acceptance are still hardware checks. The checked-in August benchmark predates
this renderer. The three theme screenshots were regenerated with `bun run desktop
capture` using the actual Rust WASM text engine between simulator frames;
`dist/web-smoke.png` is the current automated browser receipt.

## Measured latency and preview density

Native QuickJS -> offload worker -> frame-boundary delivery, using the welcome
text at 60 Hz, improved from 8 frames / about 136 ms to 2 frames / about 35–39 ms
for an edit. Worker computation was only about 0.1–0.2 ms before the change.
The avoidable cost came from sequential whole-document upload requests. This
measurement excludes OS input delivery and final window rendering; bulk initial
uploads and multi-page results still have additional frame latency.

The 2026-09-08 measurements and exact input are retained in [the dated measurements](bench/text-offload-latency.json)
and [their exact input](bench/text-offload-welcome.txt). Reproduce the optimized path after a
native product build:

```sh
bun vendor/pocketjs/tools/text-latency.ts --pak shells/desktop/dist/pocket-desktop-system-ui.pak \
  --slot 19 --document shells/desktop/docs/bench/text-offload-welcome.txt
```

The browser preview keeps its logical/backing canvas at 800×600 and presents
it at 400×300 CSS pixels: two backing pixels per displayed pixel. Pointer
coordinates continue to map through the canvas rectangle to logical coordinates.
The browser smoke test verifies the dimensions and opens a child app through
that scaled input path.
