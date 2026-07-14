import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '.');
const required = [
  'index.html',
  'school-years.html',
  'js/app.js',
  'js/version.js',
];
const expected = '2026-07-14-school-year-ui-bootstrap-r350';
const conflictLine = /^(<<<<<<<(?: .*)?|=======(?: .*)?|>>>>>>>(?: .*)?)$/m;

for (const rel of required) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) throw new Error(`Missing required file: ${rel}`);
  const text = fs.readFileSync(full, 'utf8');
  if (conflictLine.test(text)) throw new Error(`Unresolved merge marker: ${rel}`);
  if (!text.includes(expected)) throw new Error(`r350 marker missing: ${rel}`);
}

execFileSync(process.execPath, ['--check', path.join(root, 'js/app.js')], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', path.join(root, 'js/version.js')], { stdio: 'inherit' });

const schoolYears = fs.readFileSync(path.join(root, 'school-years.html'), 'utf8');
for (const marker of [
  'class="workspace-table"',
  'class="workspace-status"',
  'class="workspace-actions"',
  'white-space:nowrap',
  'word-break:keep-all',
]) {
  if (!schoolYears.includes(marker)) throw new Error(`Workspace no-wrap guard missing: ${marker}`);
}

const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (!index.includes('[HIS bootstrap failed]')) throw new Error('Bootstrap error guard missing');

console.log('RELEASE_GUARD_R350_OK');
