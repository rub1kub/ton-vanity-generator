import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const project = join(root, 'tests/rotation-contract');
const fixtures = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/tg-rotation.test.ts'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ROTATION_FIXTURE_DIR: join(project, 'fixtures') },
});
if (fixtures.status !== 0) process.exit(fixtures.status ?? 1);
const result = spawnSync(process.env.ACTON_BIN || 'acton', ['test', 'rotation.test.tolk'], { cwd: project, stdio: 'inherit' });
if (result.error) console.error('Acton 1.2.0 is required. Set ACTON_BIN to its executable path.');
process.exit(result.status ?? 1);
