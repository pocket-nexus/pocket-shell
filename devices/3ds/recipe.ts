// SPDX-License-Identifier: GPL-3.0-or-later
// The native recipe PocketJS's build executor runs for this host config
// (`pocket build --config devices/3ds/pocket.host.config.ts --pocket <package>`):
// the package the executor admitted goes to build.ts, which links it into a
// .3dsx as the recovery guest.
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { compilerOnly, type RuntimeBuild } from "../../vendor/pocketjs/framework/src/host-config.ts";
import { requireApplication, requireProgramProfile } from "../../vendor/pocketjs/tools/build/programs/application.ts";
import { repository, nativeSources, buildHosts, handheldLock, nativeArguments } from "../../vendor/pocketjs/tools/build/programs/handheld-common.ts";
import { build3ds } from "./build.ts";
import { THREE_DS_PROFILE } from "./tools/profile.ts";
const profile = THREE_DS_PROFILE;
const product = import.meta.dir;
const services = resolve(product, "../services");
export const build: RuntimeBuild = {
  sourceInputs: [
    // PocketJS: the crates of the archive's graph, the renderer and the guest.
    ...nativeSources("engine/spec", "engine/drivers", "engine/core", "engine/package", "engine/runtime", "programs/sdk/archive", "engine/physics", "engine/modules/media", "engine/render", "devices/3ds/pocket-3ds-pica", "engine/guest-quickjs", "programs/native/runtime", "devices/gles/pocket-gles", "devices/gles/pocket-gles1", "devices/gles/pocket-gles2"),
    resolve(repository, "platforms/3ds"), resolve(repository, "engine/modules/offload/include"),
    resolve(repository, "programs/native/quickjs"),
    // This repository: the product, its archive and the host services.
    ...["src", "include", "Makefile", "app.rsf", "core/src", "core/Cargo.toml", "core/Cargo.lock"].map(path => resolve(product, path)),
    ...readdirSync(services).filter(name => /\.[ch]$/.test(name)).map(name => resolve(services, name)),
    resolve(services, "quirc"),
  ],
  hosts: buildHosts, input: "package", steps: compilerOnly(), artifact: "{outdir}/{output}.3dsx",
  async run(context) {
    requireProgramProfile(context, profile);
    const app = requireApplication(context);
    await handheldLock("3ds", () => build3ds([`--plan=${app.planPath}`, `--outdir=${app.directory}`,
      `--package-outdir=${context.outdir}`, "--skip-build", ...nativeArguments(context)], context));
  },
};
