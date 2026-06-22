import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const packageDir = resolve(__dirname, '..');
const generatedPaths = [
    'packages/schema-definitions/schemas/AlertDestinationTemplate.json',
    'packages/schema-definitions/schemas/AlertRule.json',
    'packages/schema-definitions/schemas/NormalizedTicker.json',
    'packages/schema-definitions/schemas/SidecarConfigPayload.json',
    'packages/schema-definitions/schemas/SystemConfig.json',
    'packages/types/src/generated.ts',
];

const before = new Map(
    generatedPaths.map((path) => [path, readFileSync(join(repoRoot, path), 'utf8')]),
);

execFileSync('pnpm', ['run', 'generate:json'], {
    cwd: packageDir,
    stdio: 'inherit',
});
execFileSync('pnpm', ['run', 'generate:ts'], {
    cwd: packageDir,
    stdio: 'inherit',
});

const changed = generatedPaths.filter((path) => readFileSync(join(repoRoot, path), 'utf8') !== before.get(path));
if (changed.length > 0) {
    throw new Error(`Generated schema drift detected:\n${changed.join('\n')}`);
}

const alertRule = readFileSync(join(repoRoot, 'packages/schema-definitions/schemas/AlertRule.json'), 'utf8');
for (const field of ['condition', 'cooldown_secs', 'destination_assignments', 'alert_type_rules']) {
    if (!alertRule.includes(`"${field}"`)) {
        throw new Error(`Generated AlertRule.json is missing ${field}`);
    }
}
