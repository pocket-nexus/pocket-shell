# Browser rendering and text

Pocket Shell Desktop's System UI and installed demo bundles use SolidJS.
The root `vendor/pocketjs` submodule pins the runtime. Runtime imports stay
under `@pocketjs/framework/*`. Commands below start at the repository root.

## Ownership

| Work | Owner |
|---|---|
| AppInstances, input, focus and hidden-app suspension | browser System host |
| Guest JavaScript and Rust software drawing | one iframe/WASM UI per package |
| Child surface clipping and painter order | WASM compositor |
| Text wrapping, shaping and glyph rasterization | independent `io.offload` Worker |
| Theme palettes, font slots, icons and metrics | System UI theme definitions |
| Embedded computer display and application services | embedding product |

The browser uploads each child's raster to the System UI compositor at its
surface handle. Surface handles stay separate from guest texture resources.
Text work runs in a Worker; the iframe scheduler advances the UI.

`engine/text` owns text execution. Atlas layout uses the Rust core and
package font metrics. OpenType shaping and coverage use COSMIC Text, Harfrust
and Swash, with a font database populated from package/provider font bytes.

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

The transport never executes capability handlers in `submit` or `take`.
Browsers use a Worker and bounded credits. PSP uses a lower-priority host0 mailbox thread with fixed
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
bun run desktop build:web
```

For a device with the paired LAN `io.offload` transport:

```sh
bun run desktop companion:text --address DEVICE_IP --key-file /path/to/pairing-key \
  --pak shells/desktop/dist/web/dist/pocket-desktop-system-ui.pak
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
bun tools/pocket.ts build --target psp --manifest apps/text-offload/pocket.app.json --project-root . -- --release
bun tools/text-provider.ts --usb /path/to/host0-root \
  --app dev.pocket-nexus.text-offload --pak dist/text-offload-main.pak
```

USB pairing is the explicit local tether/share grant, scoped by app ID. The
provider publishes an epoch/heartbeat; request/reply records additionally carry
a device boot ID and sequence. Old files and replies are rejected across
restarts. There is no network listener or font engine on the PSP. Do not expose
that trusted host0 root as a public share.

## Validation

```sh
bun run desktop check          # types, System UI, simulator, text and USB tests
bun run desktop test:rust      # shared text engine and WASM compositor
bun run desktop test:web       # Chrome journey and dist/web-smoke.png
```

The browser preview keeps its logical/backing canvas at 800×600 and presents
it at 400×300 CSS pixels: two backing pixels per displayed pixel. Pointer
coordinates map through the canvas rectangle to logical coordinates. The
browser smoke test verifies the dimensions and opens a child app through
that scaled input path. Embedded products validate their own input, display
and text-service integration on their target hardware.
