import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const licenseName = /^(licen[sc]e|copying|notice|copyright)([._-]|$)/i;
const fallback = { 'alloc-stdlib': 'alloc-stdlib.txt', selectors: 'MPL-2.0.txt', 'webview2-com': 'webview2-com.txt', 'webview2-com-sys': 'webview2-com.txt', 'webview2-com-macros': 'webview2-com-macros.txt' };
let count = 0;
let text = '# Third-party notices\n\nGenerated from the locked dependencies. Includes build/test dependencies present in Cargo metadata; this is a conservative notice collection, not a runtime SBOM. Components are unmodified.\n\nMPL-2.0 source is available from each exact crates.io source link below. Converter executables are downloaded separately by the user and are not included in the public StoryLens archive.\n';
function add(name, version, license, dir, source, extra) {
  let files = fs.readdirSync(dir).filter(f => licenseName.test(f) && fs.statSync(path.join(dir, f)).isFile()).map(f => path.join(dir, f));
  if (!files.length && extra) files = [extra];
  assert(files.length, `Missing license text: ${name}@${version}`);
  text += `\n## ${name} ${version}\n\nLicense: ${license}\nSource: ${source}\n`;
  for (const file of files) text += `\n### ${path.basename(file)}\n\n${fs.readFileSync(file, 'utf8').replace(/[ \t]+$/gm, '').trimEnd()}\n`;
  count++;
}
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
for (const [dir, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!dir || pkg.dev) continue;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  add(manifest.name, pkg.version, pkg.license || manifest.license, dir, `https://www.npmjs.com/package/${manifest.name}/v/${pkg.version}`);
}
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--offline', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
for (const pkg of metadata.packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
  if (pkg.name === 'storylens') continue;
  add(pkg.name, pkg.version, pkg.license, path.dirname(pkg.manifest_path), `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`, fallback[pkg.name] && path.join('licenses/third-party', fallback[pkg.name]));
}
assert(count > 250);
assert(!/C:\\Users\\|D:\\mihal\\/.test(text), 'Local path in public notices');
fs.writeFileSync('THIRD_PARTY_NOTICES.txt', text.trimEnd() + '\n');
console.log(`Collected license texts for ${count} dependency packages.`);
