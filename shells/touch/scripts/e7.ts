// SPDX-License-Identifier: GPL-3.0-or-later
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { ROOT, VENDOR } from './paths.ts';
import { symbianPackageIdentity } from '../../../vendor/pocketjs/tools/symbian-package.ts';
import { resolveSymbianE7BuildPlan } from '../../../vendor/pocketjs/tools/symbian-profile.ts';
import { pocketStackCacheRoot, withArtifactLock } from '../../../vendor/pocketjs/tools/psp-toolchain.ts';

const manifest = resolve(ROOT, 'pocket.json');
const plan = resolveSymbianE7BuildPlan(await Bun.file(manifest).json());
const identity = symbianPackageIdentity(plan);
const output = resolve(ROOT, '../../.pocket-build/symbian/touch');
const [command = 'help', ...args] = process.argv.slice(2);
async function run(cmd: string[], cwd = VENDOR) {
  const child = Bun.spawn(cmd, { cwd, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit' });
  if (await child.exited) throw new Error(`E7 command failed: ${cmd[0]}`);
}
async function device(action: 'deploy' | 'install' | 'status') {
  const environment = resolve(output, 'usb-python');
  const python = resolve(environment, 'bin/python');
  if (!existsSync(python)) await run(['python3', '-m', 'venv', environment]);
  const probe = Bun.spawn([python, '-c', 'import usb.core'], { stdout: 'ignore', stderr: 'ignore' });
  if (await probe.exited) await run([python, '-m', 'pip', 'install', '--disable-pip-version-check', 'pyusb==1.3.1']);
  await withArtifactLock(resolve(pocketStackCacheRoot(), 'symbian/.locks/coda-usb-device.lock'), () =>
    run([python, '-B', resolve(ROOT, 'scripts/e7-device.py'), action,
      '--uid', identity.uid, '--executable', identity.executable + '.exe',
      '--sis', action === 'deploy' ? resolve(output, identity.sisFile) : identity.sisFile]),
    { timeoutMs: 90_000, staleMs: 2 * 60_000 });
}
const actions: Record<string, string[]> = {
  setup: ['setup', '--yes'],
  doctor: ['doctor', '--device', '--coda-usb'],
  build: ['build', 'app', '--manifest', manifest, '--project-root', ROOT, '--outdir', output, '--navigation', resolve(ROOT, 'native-apps.json'), '--frame-rate', '60', '--sis-version', '0.3.12'],
  launch: ['coda', 'usb', 'launch', identity.executable + '.exe'],
};
if (command === 'deploy' || command === 'install' || command === 'status') {
  await device(command);
} else if (command === 'guest') {
  const guestOutput = resolve(output, 'guest');
  const planPath = resolve(output, 'guest-plan.json');
  mkdirSync(output, { recursive: true });
  await Bun.write(planPath, JSON.stringify(plan, null, 2) + '\n');
  const build = Bun.spawn(['bun', 'tools/build.ts', `--plan=${planPath}`, `--project-root=${ROOT}`, `--outdir=${guestOutput}`], {
    cwd: VENDOR, stdout: 'inherit', stderr: 'inherit', stdin: 'inherit',
  });
  if (await build.exited) throw new Error('E7 guest build failed');
  for (const extension of ['js', 'pak']) await Bun.write(resolve(VENDOR, `dist/pocketshell-touch-e7.${extension}`), Bun.file(resolve(guestOutput, `${plan.app.output}.${extension}`)));
} else if (!actions[command]) {
  console.log('bun run touch:e7 setup|doctor|guest|build|deploy|install|launch|status');
  console.log('Deploy copies, reads back, installs over CODA and verifies the package. Launch starts the installed app.');
  if (command !== 'help') process.exit(1);
} else {
  if (command === 'doctor') await run(['python3', '-c', 'import sys; assert sys.version_info >= (3, 9), "Python 3.9+ is required"']);
  await run(['bun', resolve(VENDOR, 'tools/symbian.ts'), ...actions[command], ...args]);
}
