# Repository assets

Commit the definitions needed to build a shell, the inputs that cannot be
recreated from this checkout, and selected documentation and test fixtures.
Build intermediates and individual validation runs stay ignored.

| Files | Role and retention |
| --- | --- |
| Desktop `gen-icons.ts` | Original pixel grids and vector definitions; retained as source. Its 100 SVG outputs in `src/system-ui/icons/` are ignored and regenerated before builds. |
| Desktop `gen-assets.ts`, W95FA OTF and its OFL notice | Font recipe and original input; retained. The ten 1×/2× `.bin` atlases in `src/system-ui/fonts/` are ignored. Inter comes from the pinned PocketJS submodule. |
| `ui/art/icons/*.png` | The icon family the launcher and the applets share: the launcher's own icons, every applet's and the dock, at 24, 46 and 64 px with an `@2x` texture beside each. **pocket-nexus/applets renders them** (`tools/icons/icons.py` in Blender, `tools/icons/bake.ts` for the finish; `bun run icons` there) and the PNGs are committed here; this set came with `ui/` from pocket-nexus/applets at `4660dfe`. A build reads the committed PNGs and needs no Blender. Cycles output differs between renders, so a new set is reviewed before it is committed. `ui/icons.tsx` names each file (`APP_ART`, by app id), and the launcher's `shell/art/icons` is a link to this directory. |
| `ui/art/**/*.svg` and `ui/images.json` | The kit's vector pictures (chevrons, checkmarks, the pinstripes, the marks in `art/kit` and `art/spotify`), rasterized by the PocketJS build of an app whose `art` directory links here; `ui/images.json` holds their options. |
| 3DS `shell/art/*.svg` and `shell/images.json` | The launcher's vector pictures (chevrons, checks, glows, the camera), rasterized by the PocketJS build. |
| 3DS `media/hw/*.png`, desktop `docs/*-theme.png` | Console screenshots embedded in the 3DS README and selected desktop pictures; desktop theme images are also shipped on the site. These are reviewed documentation assets. |
| Touch `src/art/*.png`, `src/images.json` and `art/` | Shipped wallpaper and sixteen Blender-baked icon textures, plus their authoring recipes. Normal builds consume the committed PNGs without requiring Blender. Editable scene exports and render sheets stay in ignored `.pocket-build/touch-art/`. |
| M5Stack `apps/tab5-demo/art/*.png`, `images.json`, `art/LICENSE` and `tools/tab5-demo-art.ts` | The Tab5 demo's twenty pictures, M5Stack's under MIT, and the script that converts them from an M5Tab5-UserDemo checkout. The app's sources name every picture and `images.json` stores the sixteen opaque ones as PSM_5650; the firmware build reads the committed PNGs. |
| M5Stack `programs/m5stack-tab5` CMake files, `sdkconfig.defaults`, `partitions.csv`, `idf_component.yml` manifests and `dependencies.lock` | ESP-IDF project inputs. `build/`, `sdkconfig` and `managed_components/` are ignored build output. |
| TypeScript/TSX, C, HTML, CSS and preview JavaScript | Maintained application, daemon, build or site source. Wayland protocol XML is the input to the pointer helper's build and retains its embedded MIT notice. |
| Package/runtime manifests, tsconfigs, CI, Bun lockfile and `.gitmodules` | Build and dependency inputs. There is one root gitlink, PocketJS, and one workspace lockfile. |
| GPL texts and third-party notices | Distribution terms; generated font atlases keep the source fonts' OFL terms. See [LICENSING.md](../LICENSING.md). |

The kit's pictures and the icon family are tracked here, in `ui/art`. An
applet's own pictures are in pocket-nexus/applets.

The SVG and atlas generators reproduced all 110 previously committed outputs
byte-for-byte during this cleanup. The desktop's web and simulator builds
invoke them; the standalone wrap test and site build with `--reuse-preview`
also prepare their inputs. The root checks run none of them: the desktop
shell does not build against the pinned PocketJS
([shells/desktop](../shells/desktop/README.md)). Each generator replaces its
own output directory so removed source definitions cannot leave stale assets
behind.

Seven unused PNGs and the old portable-runtime integration report, its machine
receipt and three device screenshots were removed from the current tree. They
remain in Git history. Their local review copies are under ignored
`.pocket-build/validation/asset-review/removed/`. The archived 3DS and iPod
shells keep their tapes, goldens and media on the branch
`archive/3ds-omarchy-ipod-remote`.

New benchmark runs write to ignored `.pocket/bench/` directories. Promote a
selected, reviewed baseline into `docs/bench/` explicitly with its protocol,
source revisions and a document that uses it. Smoke screenshots, traces,
resolved plans, packages and binaries stay under ignored `dist/`, `.pocket/`
or `.pocket-build/`.

`bun run check:assets` rejects tracked ignored files, broken local Markdown
links, missing source inputs and media with no documentation, test or declared
source consumer. A declared source consumer is an `images.json` key, an app
contract's `icon` or, in an app under `devices/m5stack/apps` and in the kit
(`ui/`), a picture a TypeScript source names in a string literal, which is
how the PocketJS build finds it. An input behind a link counts under the
path the link points to: the launcher's `shell/art/icons/*` are
`ui/art/icons/*`. It runs as part of `bun run check` and in CI.
