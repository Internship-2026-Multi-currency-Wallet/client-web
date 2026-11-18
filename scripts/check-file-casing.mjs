// Fails when two tracked files would clash on a case-insensitive disk (macOS, Windows).
import { execFileSync } from 'node:child_process';

const MODULE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const stem = (file) => file.replace(MODULE_EXT, '');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\0')
  .filter(Boolean);

const group = (keyOf) => {
  const groups = new Map();
  for (const file of files) {
    const key = keyOf(file);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  return [...groups.values()];
};

// The same path in different case, or the same module name (`./Foo` -> Foo.tsx or foo.ts) in different case.
const clashes = new Set(
  [
    ...group((f) => f.toLowerCase()).filter((paths) => paths.length > 1),
    ...group((f) => stem(f).toLowerCase()).filter((paths) => new Set(paths.map(stem)).size > 1),
  ].map((paths) => paths.join('  <->  ')),
);

if (clashes.size > 0) {
  console.error(
    'Files that differ only in letter case (they are one file or one module on macOS and Windows):',
  );
  for (const clash of clashes) console.error(`  ${clash}`);
  console.error('Rename one of them.');
  process.exit(1);
}
