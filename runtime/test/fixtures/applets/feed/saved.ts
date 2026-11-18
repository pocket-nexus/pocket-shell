// SPDX-License-Identifier: GPL-3.0-or-later
// The headline the fixture applet keeps between runs, in its own storage
// (capability data.fs, `applet.store` in its app contract).
import { existsSync, readFileSync, writeFileSync } from "@pocketjs/framework/fs";

const PATH = "headline.txt";

export function kept(): string {
  return existsSync(PATH) ? readFileSync(PATH, "utf8") : "";
}

export function keep(headline: string): void {
  writeFileSync(PATH, headline);
}
