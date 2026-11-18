// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/package/applet-check.ts — the source and bundle rules of a Pocket
// Applet (docs/APPLETS.md lists them; runtime/spec/applet.ts holds the lists).
//
//   bun runtime/package/applet-check.ts <pocket.app.json> [--project-root=<dir>] [--js=<bundle> --pak=<pak>]
//
// It walks the import graph from the entry (comments and types removed by
// Bun's transpiler), checks every module the applet ships, and checks the
// built guest and pak against the size budgets. `pocket-shell compile`
// (cli/pocket-shell.ts) runs it for a plan that carries `applet`, after
// PocketJS tools/build.ts wrote the bundle.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  APPLET_BUDGET,
  APPLET_GATED_MODULES,
  APPLET_MODULES,
  APPLET_PACKAGES,
  APPLET_RUNTIME_GATED_MODULES,
  APPLET_RUNTIME_MODULES,
  APPLET_SYSTEM_LINK_EXPORTS,
  RUNTIME_GUEST_MODULES,
  appletManifestDiagnostics,
  capabilityMatches,
  type AppletDeclaration,
  type ContractDiagnostic,
} from "../spec/applet.ts";
import type { PocketManifestV2 } from "../spec/pocket-manifest.ts";
import { validatePocketManifest } from "../manifest/validate.ts";
import { readPocketManifest } from "../manifest/load.ts";

export interface AppletSourceInput {
  /** The directory manifest entries are relative to. */
  projectRoot: string;
  /** The applet's entry, relative to projectRoot. */
  entry: string;
  applet: AppletDeclaration;
  /** Capability ids the manifest declares (required or enhanced). */
  capabilities: readonly string[];
}

const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "preserve" } } }),
};
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const extension of EXTENSIONS) {
    const path = base + extension;
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return null;
}

/** Whether `module` is on `allowed`, or on `gated` with a capability of
 *  `capabilities` that opens it. */
function moduleAllowed(
  module: string,
  allowed: readonly string[],
  gated: Readonly<Record<string, readonly string[]>>,
  capabilities: readonly string[],
): boolean {
  const gate = gated[module];
  return allowed.includes(module) || (gate !== undefined && capabilities.some((id) => gate.some((pattern) => capabilityMatches(id, pattern))));
}

/** Why the applet may not import `@pocket-shell/runtime/<module>`, or null
 *  when it may. */
function runtimeModuleRefusal(module: string, capabilities: readonly string[]): string | null {
  if (moduleAllowed(module, APPLET_RUNTIME_MODULES, APPLET_RUNTIME_GATED_MODULES, capabilities)) return null;
  const gate = APPLET_RUNTIME_GATED_MODULES[module];
  return gate ? `needs the ${gate.join(" or ")} capability` : "is not available to applets";
}

/** The diagnostic for a bare import of `specifier` in the module at `at`, or
 *  null when the applet may import it. */
function bareImportDiagnostic(specifier: string, at: string, capabilities: readonly string[]): ContractDiagnostic | null {
  const framework = specifier.match(/^@pocketjs\/framework(?:\/(.+))?$/);
  if (framework) {
    const module = framework[1] ?? "solid";
    // PocketJS published the Runtime's guest modules under its own name
    // until it removed them; they are Pocket Shell's now.
    if ((RUNTIME_GUEST_MODULES as readonly string[]).includes(module)) {
      const refusal = runtimeModuleRefusal(module, capabilities);
      return {
        code: "applet.module",
        path: at,
        message: `${specifier} moved to @pocket-shell/runtime/${module}${refusal ? `, which ${refusal}` : ""}`,
      };
    }
    if (moduleAllowed(module, APPLET_MODULES, APPLET_GATED_MODULES, capabilities)) return null;
    const gate = APPLET_GATED_MODULES[module];
    return {
      code: "applet.module",
      path: at,
      message: gate ? `${specifier} needs the ${gate.join(" or ")} capability` : `${specifier} is not available to applets`,
    };
  }
  const runtime = specifier.match(/^@pocket-shell\/runtime\/(.+)$/);
  if (runtime) {
    const refusal = runtimeModuleRefusal(runtime[1]!, capabilities);
    return refusal ? { code: "applet.module", path: at, message: `${specifier} ${refusal}` } : null;
  }
  if ((APPLET_PACKAGES as readonly string[]).includes(specifier)) return null;
  return { code: "applet.package", path: at, message: `${specifier}: an applet imports PocketJS, the Pocket Shell runtime and Solid only` };
}

/** The modules an applet ships, from its entry, with their code. */
function moduleGraph(input: AppletSourceInput, out: ContractDiagnostic[]): Map<string, string> {
  const root = resolve(input.projectRoot);
  const modules = new Map<string, string>();
  const queue = [resolve(root, input.entry)];
  const show = (path: string) => relative(root, path);
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (modules.has(path)) continue;
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      out.push({ code: "applet.missingModule", path: show(path), message: "module not found" });
      continue;
    }
    const transpiler = path.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    const code = transpiler.transformSync(source);
    modules.set(path, code);
    for (const entry of transpiler.scanImports(source)) {
      const specifier = entry.path;
      // The transpiler adds a JSX runtime import the source never names;
      // the PocketJS build compiles JSX to Solid.
      if (!source.includes(`"${specifier}"`) && !source.includes(`'${specifier}'`)) continue;
      if (entry.kind === "dynamic-import") {
        out.push({ code: "applet.dynamicImport", path: show(path), message: `dynamic import of ${specifier}: an applet's code is its bundle` });
        continue;
      }
      if (specifier.startsWith(".")) {
        const target = resolveModule(path, specifier);
        if (!target) {
          out.push({ code: "applet.missingModule", path: show(path), message: `cannot resolve ${specifier}` });
        } else if (relative(root, target).startsWith("..") || isAbsolute(relative(root, target))) {
          out.push({ code: "applet.outsideProject", path: show(path), message: `${specifier} is outside the project root` });
        } else {
          queue.push(target);
        }
        continue;
      }
      const diagnostic = bareImportDiagnostic(specifier, show(path), input.capabilities);
      if (diagnostic) out.push(diagnostic);
    }
  }
  return modules;
}

/** The source rules. */
export function checkAppletSources(input: AppletSourceInput): ContractDiagnostic[] {
  const out: ContractDiagnostic[] = [];
  const root = resolve(input.projectRoot);
  const modules = moduleGraph(input, out);
  let surface = false;
  for (const [path, code] of modules) {
    const at = relative(root, path);
    if (/\beval\s*\(/.test(code)) out.push({ code: "applet.eval", path: at, message: "eval: an applet evaluates no code" });
    if (/\bnew\s+Function\s*\(|(?<![.\w$])Function\s*\(/.test(code)) {
      out.push({ code: "applet.eval", path: at, message: "Function constructor: an applet evaluates no code" });
    }
    for (const match of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@pocket-shell\/runtime\/link["']/g)) {
      for (const name of match[1]!.split(",").map((part) => part.trim().split(/\s+as\s+/)[0]!)) {
        if ((APPLET_SYSTEM_LINK_EXPORTS as readonly string[]).includes(name)) {
          out.push({ code: "applet.system", path: at, message: `${name} acts for the launcher, not an applet` });
        }
      }
    }
    if (/\b(?:AuxiliarySurface|AppletSurface)\b/.test(code)) surface = true;
  }
  if (!surface) {
    out.push({ code: "applet.surface", path: input.entry, message: "an applet draws its UI inside AppletSurface (or AuxiliarySurface)" });
  }
  return out;
}

/** The bundle rules: the size budgets. */
export function checkAppletBundle(sizes: { jsBytes: number; pakBytes?: number }): ContractDiagnostic[] {
  const out: ContractDiagnostic[] = [];
  if (sizes.jsBytes > APPLET_BUDGET.jsBytes) {
    out.push({ code: "applet.budget", path: "bundle", message: `the guest bundle is ${sizes.jsBytes} bytes; the budget is ${APPLET_BUDGET.jsBytes}` });
  }
  if (sizes.pakBytes !== undefined && sizes.pakBytes > APPLET_BUDGET.pakBytes) {
    out.push({ code: "applet.budget", path: "pak", message: `the pak is ${sizes.pakBytes} bytes; the budget is ${APPLET_BUDGET.pakBytes}` });
  }
  return out;
}

/** Every rule for a manifest file: schema, manifest rules, sources and,
 *  when given, the built bundle. A manifest without `applet` passes. */
export function checkApplet(options: { manifestPath: string; projectRoot?: string; js?: string; pak?: string }): ContractDiagnostic[] {
  const raw: unknown = readPocketManifest(options.manifestPath).manifest;
  const validated = validatePocketManifest(raw);
  if (!validated.ok) return [...validated.diagnostics];
  const manifest: PocketManifestV2 = validated.value;
  if (!manifest.applet) return [];
  const out = appletManifestDiagnostics(manifest);
  const capabilities = [...manifest.engine.capabilities.requires, ...(manifest.engine.capabilities.enhances ?? [])];
  out.push(...checkAppletSources({
    projectRoot: options.projectRoot ?? dirname(options.manifestPath),
    entry: manifest.app.entry,
    applet: manifest.applet,
    capabilities,
  }));
  if (options.js) {
    out.push(...checkAppletBundle({
      jsBytes: statSync(options.js).size,
      ...(options.pak && existsSync(options.pak) ? { pakBytes: statSync(options.pak).size } : {}),
    }));
  }
  return out;
}

export function formatAppletDiagnostics(name: string, diagnostics: readonly ContractDiagnostic[]): string {
  return diagnostics.map((d) => `${name}: ${d.code} at ${d.path}: ${d.message}`).join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const manifestPath = args.find((arg) => !arg.startsWith("--"));
  const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (!manifestPath) {
    console.error("usage: bun runtime/package/applet-check.ts <pocket.app.json> [--project-root=<dir>] [--js=<bundle> --pak=<pak>]");
    process.exit(2);
  }
  const diagnostics = checkApplet({
    manifestPath: resolve(manifestPath),
    ...(flag("project-root") ? { projectRoot: resolve(flag("project-root")!) } : {}),
    ...(flag("js") ? { js: resolve(flag("js")!) } : {}),
    ...(flag("pak") ? { pak: resolve(flag("pak")!) } : {}),
  });
  if (diagnostics.length > 0) {
    console.error(formatAppletDiagnostics(manifestPath, diagnostics));
    process.exit(1);
  }
  console.log(`${manifestPath}: applet rules pass`);
}
