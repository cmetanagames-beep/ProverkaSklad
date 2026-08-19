// @ts-check
import { execFileSync, spawnSync } from 'node:child_process';

const fix = process.argv.includes('--fix');
const legacyFiles = new Set([
  'src/app.js',
  'src/uploads/driver-delivery-store.js',
  'public/assets/app.js',
  'public/assets/admin.js',
  'public/sw.js',
  'receiving-test/app.js',
  'test/security-regression.test.js',
]);

/** @param {string[]} args */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

let base = 'HEAD';
for (const candidate of ['origin/main', 'main']) {
  if (!git(['rev-parse', '--verify', '--quiet', candidate])) continue;
  const mergeBase = git(['merge-base', candidate, 'HEAD']);
  if (mergeBase) {
    base = mergeBase;
    break;
  }
}

const names = [
  git(['diff', '--name-only', '--diff-filter=ACMR', base]),
  git(['diff', '--name-only', '--diff-filter=ACMR', '--cached']),
  git(['ls-files', '--others', '--exclude-standard']),
];

const files = [...new Set(names.flatMap((value) => value.split(/\r?\n/)))]
  .map((file) => file.trim())
  .filter((file) => /\.(js|mjs|cjs)$/.test(file))
  .filter((file) => !file.startsWith('middle-kit/'));
const qualityFiles = files.filter((file) => !legacyFiles.has(file));

if (!files.length) {
  console.log('Изменённых JavaScript-файлов нет.');
  process.exit(0);
}

console.log(`Проверяем изменённые JavaScript-файлы относительно ${base.slice(0, 8)}:`);
files.forEach((file) => console.log(`  ${file}`));
if (qualityFiles.length !== files.length) {
  console.log('Старые компактные файлы проходят syntax/test без массового форматирования.');
}

if (!qualityFiles.length) process.exit(0);

const commands = [
  ['node_modules/prettier/bin/prettier.cjs', fix ? '--write' : '--check', ...qualityFiles],
  ['node_modules/eslint/bin/eslint.js', ...(fix ? ['--fix'] : []), ...qualityFiles],
];

for (const [script, ...args] of commands) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Линт и форматирование изменённых файлов прошли.');
