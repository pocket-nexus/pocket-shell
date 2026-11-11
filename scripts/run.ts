// SPDX-License-Identifier: GPL-3.0-or-later
// A delegated command's own message is the useful one. Bun's `$` throws a
// ShellError whose stack trace buries it under this script's frames, so
// failures are passed through as an exit code instead.

export async function passThrough<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const code = (error as { exitCode?: number }).exitCode;
    process.exit(typeof code === "number" && code !== 0 ? code : 1);
  }
}
