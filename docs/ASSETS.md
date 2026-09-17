# Repository assets

Commit the definitions needed to build a shell, the inputs that cannot be
recreated from this checkout, and selected documentation and test fixtures.
Expensive offline icon bakes are retained as reviewed product inputs so normal
builds do not depend on Blender. Build intermediates and individual validation
runs stay ignored.

| Files | Role and retention |
| --- | --- |
| Desktop `gen-icons.ts` | Original pixel grids and vector definitions; retained as source. Its 100 SVG outputs in `src/system-ui/icons/` are ignored and regenerated before builds. |
| Desktop `assets/icons/render.py`, `objects.py`, `pixel-icons.py` and 135 PNG bakes | Original Blender scenes and pixel-grid recipes for applications, filesystem places and device classes across Aqua, XP and Classic 98, with shipping icons at 16/32/64 px. Cycles models, materials, cameras and lights are recreated by the recipe; normal builds copy these offline bakes into the ignored icon directory at 1×/2× density. Theme selection variants are derived into the ignored output directory during normal builds. `scripts/aqua-controls.ts` also generates supersampled Aqua button faces there; no additional baked button inputs are tracked. Editable `.blend` files and full-size renders stay in `.pocket-build/validation/blender-icons/`. |
| Desktop `gen-assets.ts`, W95FA OTF and its OFL notice | Font recipe and original input; retained. The ten 1×/2× `.bin` atlases in `src/system-ui/fonts/` are ignored. Inter comes from the pinned PocketJS submodule. |
| Desktop `assets/macos/AppIcon.icns` | Original SHERU macOS icon, reused unchanged for the Pocket Shell app bundle. Provenance and digest are in the desktop third-party notices. The `.app` itself stays in ignored `dist/`. |
| 3DS `src/wall/*.png` and `images.json` | The three texture inputs the guest uses. The preparation script needs external Omarchy originals and macOS `sips`; deleting the only bundled inputs would break a clean build. |
| iPod `src/fonts/SymbolsNerdFont-subset.otf` and its license | Shipped font input. The complete Nerd Font used to make this subset is not stored here. |
| iPod `src/menu.ts` | Versioned Omarchy menu snapshot. Regeneration reads an external machine or JSONC file; ordinary builds must not depend on a live Omarchy installation. The source version and digest are in its header. |
| 3DS `test/goldens/3ds/*.png` and `AZAHAR-BUILD.txt` | 26 reference frames consumed by `film --check`, plus the emulator version. Regenerating these during a check would remove the comparison baseline. |
| 3DS and iPod `media/`, desktop `docs/*-theme.png` | Selected pictures and scripted animations embedded in the shell READMEs; desktop theme images are also shipped on the site. These are reviewed documentation assets. |
| Desktop `docs/bench/classic-2026-08-23.{md,json}` | Historical baseline cited by the website, including measured data and protocol. It predates the portable renderer. |
| Desktop `docs/bench/aqua-gpu-2026-09-10.{md,json}` | Dated comparison supporting the documented drag benchmark. It measures CPU submission and capture estimates, not physical input latency. |
| Desktop `docs/bench/text-offload-{latency.json,welcome.txt}` | The dated text-service measurement and exact input cited by the text documentation. |
| TypeScript/TSX, C, HTML, CSS and preview JavaScript | Maintained application, daemon, build or site source. Wayland protocol XML is the input to the pointer helper's build and retains its embedded MIT notice. |
| Package/runtime manifests, tsconfigs, CI, Bun lockfile and `.gitmodules` | Build and dependency inputs. There is one root PocketJS gitlink and one workspace lockfile. |
| GPL texts and third-party notices | Distribution terms; generated font atlases keep the source fonts' OFL terms. See [LICENSING.md](../LICENSING.md). |

The SVG and atlas generators reproduced all 110 previously committed outputs
byte-for-byte during this cleanup. Native, web and simulator builds now invoke
them automatically; the standalone wrap test and site build with
`--reuse-preview` also prepare their inputs. Run `bun run desktop assets` to
regenerate explicitly. Each generator replaces its own output directory so
removed source definitions cannot leave stale assets behind.

Seven unused PNGs and the old portable-runtime integration report, its machine
receipt and three device screenshots were removed from the current tree. They
remain in Git history. Their local review copies are under ignored
`.pocket-build/validation/asset-review/removed/`. The iPod's four scripted GIFs
remain documented in its README.

New benchmark runs write to ignored `.pocket/bench/` directories. Promote a
selected, reviewed baseline into `docs/bench/` explicitly with its protocol,
source revisions and a document that uses it. Smoke screenshots, traces,
resolved plans, packages and binaries stay under ignored `dist/`, `.pocket/`
or `.pocket-build/`.

`bun run check:assets` rejects tracked ignored files, broken local Markdown
links, missing tape goldens and media with no documentation, test or declared
source consumer. It runs as part of `bun run check` and in CI.
