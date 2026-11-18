// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/package/bytecode.ts — a variant's bytecode sections.
//
// A host contract that names a QuickJS engine ABI (`bytecode.engine`) gets
// the UI bundle as section 6 and the worker bundle as section 9, each a QJBC
// envelope (runtime/spec/pocket-package.ts) around the object the engine
// serialized. PocketJS tools/quickjs-bytecode.ts builds the compiler from the
// engine source the ABI pins and returns that object; the sections and the
// envelope are assembled here.

import { quickJsEngineAbiByName } from "../../vendor/pocketjs/contracts/spec/quickjs-bytecode.ts";
import { compileQuickJsBytecode, type QuickJsBytecodeOptions } from "../../vendor/pocketjs/tools/quickjs-bytecode.ts";
import {
  encodeBytecodeEnvelope,
  POCKET_SECTION,
  type PocketPackageSection,
  type PocketPackageVariant,
} from "../spec/pocket-package.ts";

export interface WithBytecodeOptions extends QuickJsBytecodeOptions {
  /** The engine ABI's name (a host contract's `bytecode.engine`). */
  readonly engine: string;
  /** Keep the source sections beside the bytecode (the default) or drop them. */
  readonly source?: "keep" | "drop";
}

/** The variant with its UI bundle compiled into section 6 and its worker
 *  bundle, when it has one, into section 9. */
export function withBytecode(variant: PocketPackageVariant, options: WithBytecodeOptions): PocketPackageVariant {
  const abi = quickJsEngineAbiByName(options.engine);
  if (!abi) throw new Error(`quickjs bytecode: no engine ABI is named ${options.engine}`);
  const { source: sourceOption, engine: _engine, ...compileOptions } = options;
  const script = (kind: number, name: string) => {
    const section = variant.sections.find((entry) => entry.kind === kind);
    if (!section) return undefined;
    if (section.bytes.length === 0 || section.bytes[section.bytes.length - 1] !== 0) {
      throw new Error(`quickjs bytecode: the ${name} section is not NUL-terminated`);
    }
    return section.bytes.subarray(0, section.bytes.length - 1);
  };
  const envelope = (javaScript: Uint8Array) =>
    encodeBytecodeEnvelope({ engineAbi: abi.sha256, bytecode: compileQuickJsBytecode(abi, javaScript, compileOptions).bytecode });
  const ui = script(POCKET_SECTION.js, "js");
  if (!ui) throw new Error("quickjs bytecode: the variant has no js section to compile");
  const worker = script(POCKET_SECTION.workerJs, "worker");
  const compiled: PocketPackageSection[] = [
    { kind: POCKET_SECTION.bytecode, bytes: envelope(ui) },
    ...(worker ? [{ kind: POCKET_SECTION.workerBytecode, bytes: envelope(worker) }] : []),
  ];
  const dropped = new Set<number>([POCKET_SECTION.bytecode, POCKET_SECTION.workerBytecode]);
  if (sourceOption === "drop") {
    dropped.add(POCKET_SECTION.js);
    dropped.add(POCKET_SECTION.workerJs);
  }
  return { ...variant, sections: [...variant.sections.filter((section) => !dropped.has(section.kind)), ...compiled] };
}
