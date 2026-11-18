# pocket-shell CLI

`cli/pocket-shell.ts` compiles an application into a `.pocket` package. It
reads the app contract (`pocket.app.json`,
[docs/APP-CONTRACT.md](../docs/APP-CONTRACT.md)), resolves it against a host
contract into a build plan, runs PocketJS's compiler on the plan and encodes
the package ([docs/POCKET-PACKAGE.md](../docs/POCKET-PACKAGE.md)). **It runs on
Bun**, after `bun run setup` has initialized `vendor/pocketjs`.

```sh
bun cli/pocket-shell.ts check   --manifest pocket.app.json --target 3ds-dev
bun cli/pocket-shell.ts compile --manifest pocket.app.json --host-config pocket.host.config.ts --output dist/app.pocket
bun run pocket-shell compile …   # the root script, from the repository root
```

## check and compile

`check` runs the first five steps and prints the plan's hash. `compile` runs
all of them and writes one package with one variant.

| Step | Code |
| --- | --- |
| Select the host contract from `--target`, `POCKET_TARGET` or a host config | PocketJS `tools/profile-resolver.ts` |
| Read the app contract, validate it against the schema, load the `app.theme` module and the `icon` | `runtime/manifest/load.ts` |
| Resolve the build plan for the host contract | `runtime/manifest/resolve.ts` |
| Compare the framework runtime the application resolves with the one the compiler bundles | PocketJS `framework/compiler/runtime-packages.ts` |
| Type-check `app.entry` and the worker entry | PocketJS `framework/compiler/app-check.ts` |
| Write `<plan-dir>/<host id>/plan.json` | `cli/pocket-shell.ts` |
| Compile the plan into `<output>.js`, `<output>.pak` and, with `domains.worker`, `<output>.worker.js` | PocketJS `tools/build.ts --plan=<plan.json> --project-root=<dir> --outdir=<dir>` |
| Check an applet's sources and bundle sizes | `runtime/package/applet-check.ts` |
| Assemble the variant's sections | `runtime/package/pocket-pack.ts` |
| Compile sections 6 and 9 when the host contract names `bytecode.engine` | `runtime/package/bytecode.ts`, PocketJS `tools/quickjs-bytecode.ts` |
| Encode the `.pocket` file | `runtime/spec/pocket-package.ts` |

**The plan file is the interface to PocketJS's compiler.** The compiler
verifies the plan's checksum and host contract hash, then reads the entry,
framework, theme, features, raster density, tick rate and worker declaration
from it.

| Option | Default | Value |
| --- | --- | --- |
| `--manifest FILE` | `pocket.app.json` | The app contract, relative to the current directory. |
| `--target ID\|FILE` | `POCKET_TARGET`, then the one host contract of the host config | A PocketJS host id (`3ds-dev`, `psp`) or the path of a `pocket.host.json`. With `--host-config`, the id of one of its host contracts. |
| `--host-config FILE` | Without `--target`, the nearest `pocket.host.config.ts` above the manifest | The host config whose host contract the application compiles against. A host config with several host contracts needs `--target`. |
| `--project-root DIR` | The manifest's directory | The directory `app.entry` and the worker entry are relative to, and the compiler's working directory. |
| `--outdir DIR` | `dist` | Compiler outputs, relative to the project root. |
| `--plan-dir DIR` | `.pocket` | The parent of `<host id>/plan.json`, relative to the project root. |
| `--output FILE` | `<outdir>/<app.output>.pocket` | The package, relative to the project root. |
| `--depfile FILE` | none | A Make depfile for the package, relative to the project root: the app contract, theme and icon, the host config and host contract, the type-checked modules, the compiler's inputs and the modules of this CLI. |
| `--compiler-receipt FILE` | none | An existing file added to the depfile's inputs. |

An option takes its value as `--name value` or `--name=value`. `check` reads
the first four options.

**Exit code 0 means the command completed; 1 means it stopped**, with the
reason on standard error after `pocket-shell: `. A contract the host contract
refuses prints one line per diagnostic, `<code> <JSON pointer>: <message>`;
[docs/APP-CONTRACT.md](../docs/APP-CONTRACT.md#checking-an-app-contract)
lists the codes.

`--aot` and `--out DIR` are refused: AOT sources come from PocketJS's CLI,
`bun vendor/pocketjs/tools/pocket.ts compile --aot --out DIR`.

## Forwarded commands

Every command other than `check` and `compile` runs
`vendor/pocketjs/tools/pocket.ts` with the same arguments, working directory,
environment and standard streams, and this CLI exits with that process's exit
code. PocketJS's commands at the pinned commit are `host export`, `host
fetch`, `build`, `pack`, `target`, `sdk`, `doctor`, `catalog`, `project` and
`status`.

```sh
bun cli/pocket-shell.ts host export --config pocket.host.config.ts --out build/profile --depfile build/profile/pocket-profile.d
bun cli/pocket-shell.ts catalog --json
```

## Callers

- `bun run tab5` and `bun run psp` (`shells/3ds/scripts/tab5.ts`, `psp.ts`)
  compile each app with `compile --host-config`.
- The Tab5 firmware's CMake helpers (PocketJS
  `platforms/esp-idf/pocket_runtime/project_include.cmake`) call
  `devices/m5stack/tools/pocket`, which runs this CLI: `compile … --depfile`
  for the launcher and each bundled app, and `host export` for the profile
  header. `bun run m5stack app build <pocket.app.json>` runs `compile` too.
- `bun run 3ds` does not start this CLI: `devices/3ds/build.ts` resolves the
  plan with `runtime/manifest`, runs PocketJS's compiler and encodes the
  package with the same modules.

## Package tools

```sh
bun runtime/package/pocket-pack.ts inspect app.pocket                    # variants, sections and sizes
bun runtime/package/pocket-pack.ts verify app.pocket                     # footer hash; each variant resolves from the embedded app contract to its embedded plan
bun runtime/package/pocket-pack.ts thin app.pocket --target 3ds-dev -o one.pocket
bun runtime/package/applet-check.ts pocket.app.json --project-root=<dir> # the applet rules outside a build
bun runtime/schema/generate.ts --check                                   # runtime/schema/pocket-2.json equals the schema in runtime/spec/pocket-manifest.ts
```
