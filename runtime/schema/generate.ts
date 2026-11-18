#!/usr/bin/env bun
// SPDX-License-Identifier: GPL-3.0-or-later
// The published JSON schema of the app contract: runtime/schema/pocket-2.json,
// generated from the schema object in runtime/spec/pocket-manifest.ts.
//   bun runtime/schema/generate.ts           # write
//   bun runtime/schema/generate.ts --check   # fail when the committed schema is stale
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePocketManifestV2Schema } from "../spec/pocket-manifest.ts";

const root = resolve(import.meta.dir, "../..");
export const SCHEMAS: ReadonlyMap<string, () => string> = new Map([
  ["runtime/schema/pocket-2.json", generatePocketManifestV2Schema],
]);

if (import.meta.main) {
  const check = process.argv.includes("--check");
  for (const [path, generate] of SCHEMAS) {
    const file = resolve(root, path), text = generate();
    if (check) {
      if (!existsSync(file) || readFileSync(file, "utf8") !== text) throw new Error(`stale schema: ${path}; run bun runtime/schema/generate.ts`);
    } else if (!existsSync(file) || readFileSync(file, "utf8") !== text) writeFileSync(file, text);
  }
}
