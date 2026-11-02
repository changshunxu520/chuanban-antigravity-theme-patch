import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {installPackage, uninstallPackage, validateDestination, createPlist} from '../scripts/install.mjs';

/** Build isolated fixture assets; these tests never access launchctl or the real installation. */
function fixture() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ag-installer-test-'));
  const source = path.join(root, 'package');
  fs.mkdirSync(path.join(source, 'assets/runtime'), {recursive:true});
  fs.mkdirSync(path.join(source, 'scripts'));
  for (const name of ['preset.js', 'dictionary.js', 'localization.js', 'guards.js', 'metrics-client.js', 'metrics-server.js', 'theme.css', 'metrics.css', 'audit.js', 'gemini-context.js']) fs.writeFileSync(path.join(source, 'assets/runtime', name), '// fixture\n');
  fs.writeFileSync(path.join(source, 'scripts/controller.mjs'), '// fixture controller\n');
  return {root, source, destination:path.join(root, 'destination with spaces')};
}

test('default install is portable, opt-out 1M, preserves spaces, refuses overwrite', () => {
  const data = fixture();
  try {
    const result = installPackage({destination:data.destination, noService:true}, data.source);
    assert.deepEqual(result.config, {preset:'high-contrast', metrics:true, gemini1m:false});
    assert.ok(fs.existsSync(path.join(data.destination, 'assets/theme.css')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(data.destination, 'install-manifest.json'))).destination, data.destination);
    assert.throws(() => installPackage({destination:data.destination, noService:true}, data.source), /--upgrade/);
  } finally {fs.rmSync(data.root, {recursive:true, force:true});}
});

test('upgrade requires explicit 1M opt-in and retains every old file in a backup', () => {
  const data = fixture();
  try {
    installPackage({destination:data.destination, noService:true}, data.source);
    fs.writeFileSync(path.join(data.destination, 'user-note.txt'), 'keep me');
    const result = installPackage({destination:data.destination, noService:true, upgrade:true, gemini1m:true, noMetrics:true}, data.source);
    assert.equal(result.config.gemini1m, true);
    assert.equal(result.config.metrics, false);
    assert.equal(fs.readFileSync(path.join(result.backup, 'user-note.txt'), 'utf8'), 'keep me');
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.backup, 'config.json'))).gemini1m, false);
    const removed = uninstallPackage(data.destination);
    assert.equal(fs.existsSync(data.destination), false);
    assert.ok(fs.existsSync(path.join(removed.backup, 'assets/metrics-server.js')));
  } finally {fs.rmSync(data.root, {recursive:true, force:true});}
});

test('rejects sensitive targets, existing symlink and dangling symlink ancestors', () => {
  const data = fixture();
  try {
    assert.throws(() => validateDestination(os.homedir()), /dedicated/);
    fs.symlinkSync(data.source, path.join(data.root, 'linked'));
    assert.throws(() => validateDestination(path.join(data.root, 'linked', 'patch')), /Symlinked/);
    fs.symlinkSync(path.join(data.root, 'absent'), path.join(data.root, 'dangling'));
    assert.throws(() => validateDestination(path.join(data.root, 'dangling')), /Symlinked/);
    assert.throws(() => uninstallPackage(data.source), /ownership/);
  } finally {fs.rmSync(data.root, {recursive:true, force:true});}
});

test('plist escapes XML-sensitive characters and uses explicit node path', () => {
  const content = createPlist('/private/tmp/A & B/<patch>', '/private/tmp/node "binary"');
  assert.match(content, /A &amp; B\/&lt;patch&gt;/);
  assert.match(content, /node &quot;binary&quot;/);
  assert.doesNotMatch(content, /\/Users\/xucs/);
});

test('CLI --help and -h explain options and never create the requested destination', () => {
  const data = fixture();
  try {
    const before = fs.readdirSync(data.root).sort();
    const installer = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url));
    for (const flag of ['--help', '-h']) {
      const output = execFileSync(process.execPath, [installer, 'install', '--dest', data.destination, '--no-service', flag], {encoding:'utf8'});
      for (const expected of ['--gemini-1m', '--no-metrics', '--upgrade', 'com.chuanban.antigravity-theme-patch', '--experimental-sqlite', 'Legacy migration', 'install-manifest.json']) assert.ok(output.includes(expected), expected);
      assert.equal(fs.existsSync(data.destination), false);
      assert.deepEqual(fs.readdirSync(data.root).sort(), before);
    }
  } finally {fs.rmSync(data.root, {recursive:true, force:true});}
});
