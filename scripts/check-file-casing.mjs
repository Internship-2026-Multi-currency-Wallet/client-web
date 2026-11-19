import { execFileSync } from 'node:child_process';

const MODULE_EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const stem = (file) => file.replace(MODULE_EXT, '');

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .split('\0')
  .filter(Boolean);

const dirs = files.flatMap((f) =>
  f
    .split('/')
    .slice(0, -1)
    .map((_, i, parts) => parts.slice(0, i + 1).join('/')),
);
const paths = [...new Set([...files, ...dirs])];

const group = (items, keyOf) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
};

// Extensionless imports can collide on case-insensitive filesystems even when the files have different extensions.
const clashes = new Set(
  [
    ...group(paths, (p) => p.toLowerCase()).filter((same) => same.length > 1),
    ...group(files, (f) => stem(f).toLowerCase()).filter(
      (same) => new Set(same.map(stem)).size > 1,
    ),
  ].map((same) => same.join('  <->  ')),
);

if (clashes.size > 0) {
  console.error(
    'Paths that differ only in letter case (they are one file, folder or module on macOS and Windows):',
  );
  for (const clash of clashes) console.error(`  ${clash}`);
  console.error('Rename one of them.');
  process.exit(1);
}
