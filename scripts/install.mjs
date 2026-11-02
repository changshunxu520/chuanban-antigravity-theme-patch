import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {normalizeConfig} from './options.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'com.chuanban.antigravity-theme-patch';
const ASSETS = ['preset.js', 'dictionary.js', 'localization.js', 'guards.js', 'metrics-client.js', 'metrics-server.js', 'theme.css', 'metrics.css', 'audit.js', 'gemini-context.js'];

const HELP = `Usage: node scripts/install.mjs [install|status|stop|uninstall] [options]

Commands:
  install       Install assets and, on macOS, start the user LaunchAgent (default).
  status        Read installation manifest and config; does not check service health.
  stop          Stop the owned LaunchAgent for this login session.
  uninstall     Stop and move owned installation/plist into a recoverable backup.

Options:
  --dest PATH       Dedicated installation directory (default: ~/.antigravity-patch).
  --preset NAME     high-contrast (default), claude-desktop-purewhite, vintage-deep, default-light.
  --font-scheme A|B|C  A: Anthropic + Sarasa (default); B: Sarasa; C: Claude/PingFang.
  --no-service      Deploy files only; do not install or start a LaunchAgent.
  --no-metrics      Disable the read-only local conversation metrics module.
  --no-localization  Disable interface translation independently.
  --no-fixes        Disable settings-dialog/zoom event guards independently.
  --style-only      One-time CSS only, no service, translation, guards, metrics or 1M.
  --gemini-1m       Explicitly enable Gemini 4's optional 1M request default (off by default).
  --upgrade         Upgrade an installer-owned directory after a complete backup.
  --help, -h        Print help and exit without changing files or services.

Service label: ${LABEL}
Requirements: Node.js >=22.5; macOS for automatic LaunchAgent setup.
Node.js 22.5–22.12: manual controller commands require --experimental-sqlite;
the generated LaunchAgent adds it automatically. Node.js 24 is recommended.
Fonts are installed separately; this command does not download or remove fonts.

Legacy migration: an existing directory without install-manifest.json is not
eligible for --upgrade. Identify and stop its old service, move the entire old
directory aside as a backup, then install. Do not run both old and new services.
After feature changes or uninstall, fully quit and reopen Antigravity to clear
existing runtime hooks. Native Appearance settings and fonts remain unchanged.
`;

/** Require the built-in WebSocket and SQLite runtime used by the controller. */
export function checkRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 5) throw new Error('Node.js >= 22.5 is required.');
}

/** Reject symlinked ancestors and directories whose replacement would affect unrelated data. */
export function validateDestination(destination) {
  const resolved = path.resolve(destination);
  const forbidden = new Set([path.parse(resolved).root, os.homedir(), '/Applications', '/Library', path.join(os.homedir(), 'Library')]);
  if (forbidden.has(resolved) || resolved === PACKAGE_ROOT || PACKAGE_ROOT.startsWith(resolved + path.sep)) {
    throw new Error('Choose a dedicated patch directory.');
  }
  for (let current = resolved; ; current = path.dirname(current)) {
    let entry;
    try {entry = fs.lstatSync(current);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    if (entry?.isSymbolicLink()) throw new Error(`Symlinked destination is not supported: ${current}`);
    if (current === path.dirname(current)) break;
  }
  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) throw new Error('Destination must be a directory.');
  return resolved;
}

/** Escape filesystem paths before embedding them into a LaunchAgent plist. */
export function createPlist(destination, nodePath = process.execPath) {
  const escape = value => value.replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[character]));
  const strings = values => values.map(value => `<string>${escape(value)}</string>`).join('');
  const [major, minor] = process.versions.node.split('.').map(Number);
  const sqliteFlags = major === 22 && minor < 13 ? ['--experimental-sqlite'] : [];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${strings([nodePath, ...sqliteFlags, path.join(destination, 'controller.mjs'), 'watch'])}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${escape(path.join(destination, 'daemon.log'))}</string><key>StandardErrorPath</key><string>${escape(path.join(destination, 'daemon-error.log'))}</string></dict></plist>\n`;
}

/** Read our ownership marker; never uninstall an arbitrary user directory. */
function readManifest(destination) {
  const filename = path.join(destination, 'install-manifest.json');
  if (!fs.existsSync(filename)) return null;
  const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (manifest.label !== LABEL || manifest.destination !== destination) throw new Error('Installation ownership marker does not match.');
  const expectedPlist = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  if (typeof manifest.service !== 'boolean' || manifest.service && manifest.plistPath !== expectedPlist) throw new Error('Unexpected service path in ownership marker.');
  return manifest;
}

/** Stop only this installer-owned job, treating a non-running job as already stopped. */
function stopService(manifest) {
  if (!manifest?.service) return;
  const target = `gui/${process.getuid()}/${LABEL}`;
  try { execFileSync('launchctl', ['print', target], {stdio:'ignore'}); }
  catch { return; }
  execFileSync('launchctl', ['bootout', target], {stdio:'pipe'});
}

/** Install portable assets with a complete, recoverable directory backup on upgrades. */
export function installPackage(options = {}, packageRoot = PACKAGE_ROOT) {
  checkRuntime();
  const destination = validateDestination(options.destination || path.join(os.homedir(), '.antigravity-patch'));
  const config = normalizeConfig({preset:options.preset || 'high-contrast',fontScheme:options.fontScheme || 'A',metrics:!options.noMetrics,gemini1m:options.gemini1m === true,localize:!options.noLocalization,fixes:!options.noFixes,styleOnly:options.styleOnly === true});
  const service = !options.noService && !config.styleOnly;
  if (service && process.platform !== 'darwin') throw new Error('Automatic LaunchAgent installation requires macOS. Use --no-service for manual deployment.');
  const existed = fs.existsSync(destination);
  if (existed && !options.upgrade) throw new Error('Destination exists. Review it and pass --upgrade to preserve it as a full backup.');
  const oldManifest = existed ? readManifest(destination) : null;
  if (existed && !oldManifest) throw new Error('Existing directory is not managed by this installer. Stop its old service and move it aside as a backup before migration.');
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  if (fs.existsSync(plistPath) && fs.lstatSync(plistPath).isSymbolicLink()) throw new Error('Refusing to replace a symlinked LaunchAgent.');
  if (service && fs.existsSync(plistPath) && (!oldManifest?.service || oldManifest.plistPath !== plistPath)) {
    throw new Error('An existing LaunchAgent with this label is not owned by this installation.');
  }
  // Validate every input before touching an existing installation.
  for (const filename of ASSETS) if (!fs.statSync(path.join(packageRoot, 'assets/runtime', filename)).isFile()) throw new Error(`Missing asset: ${filename}`);
  for (const filename of ['controller.mjs','options.mjs']) if (!fs.statSync(path.join(packageRoot,'scripts',filename)).isFile()) throw new Error(`Missing script: ${filename}`);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.antigravity-stage-'));
  let backup = null;
  try {
    fs.mkdirSync(path.join(staging, 'assets'), {mode:0o700});
    for (const filename of ASSETS) fs.copyFileSync(path.join(packageRoot, 'assets/runtime', filename), path.join(staging, 'assets', filename));
    fs.copyFileSync(path.join(packageRoot, 'scripts/controller.mjs'), path.join(staging, 'controller.mjs'));
    fs.copyFileSync(path.join(packageRoot, 'scripts/options.mjs'), path.join(staging, 'options.mjs'));
    fs.writeFileSync(path.join(staging, 'config.json'), JSON.stringify(config, null, 2) + '\n', {mode:0o600});
    fs.writeFileSync(path.join(staging, 'install-manifest.json'), JSON.stringify({label:LABEL, destination, service, plistPath:service ? plistPath : null, installedAt:new Date().toISOString()}, null, 2) + '\n', {mode:0o600});
    if (existed) {
      stopService(oldManifest);
      backup = `${destination}.backup-${Date.now()}`;
      fs.renameSync(destination, backup);
      // Preserve the service definition as well as all previous assets/configuration.
      if (oldManifest?.service && fs.existsSync(plistPath)) fs.copyFileSync(plistPath, path.join(backup, 'LaunchAgent.backup.plist'));
    }
    fs.renameSync(staging, destination);
    if (service) {
      fs.mkdirSync(path.dirname(plistPath), {recursive:true});
      fs.writeFileSync(plistPath, createPlist(destination), {mode:0o644});
      execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], {stdio:'pipe'});
    } else if (oldManifest?.service && fs.existsSync(plistPath)) {
      fs.renameSync(plistPath, path.join(backup, 'LaunchAgent.disabled.plist'));
    }
    return {destination, backup, service, config, note:config.styleOnly ? 'Style-only files deployed without a service. Run node <destination>/controller.mjs apply once; restore removes these styles. Fonts are separate.' : 'Fonts are not installed automatically. Restart Antigravity after installing fonts. Choose Light in its Appearance settings to use the light palette; default-light leaves native styling untouched.'};
  } catch (error) {
    // A failed bootstrap leaves inspectable files and the old backup, never deletes user data.
    error.message += `\nPrepared files: ${fs.existsSync(staging) ? staging : destination}; backup: ${backup || 'none'}`;
    throw error;
  }
}

/** Stop and move our installation aside instead of deleting assets or fonts. */
export function uninstallPackage(destination) {
  destination = validateDestination(destination);
  const manifest = readManifest(destination);
  if (!manifest) throw new Error('No installer ownership marker; refusing to move this directory.');
  stopService(manifest);
  const backup = `${destination}.uninstalled-${Date.now()}`;
  if (manifest.service && fs.existsSync(manifest.plistPath)) fs.renameSync(manifest.plistPath, path.join(destination, 'LaunchAgent.disabled.plist'));
  fs.renameSync(destination, backup);
  return {backup, note:'Fully quit and reopen Antigravity to remove runtime listeners. Native Appearance settings and installed fonts are unchanged.'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argumentsList = process.argv.slice(2);
    // Help is handled before parsing or touching any installation/service state.
    if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
      console.log(HELP);
    } else {
    const command = argumentsList[0] && !argumentsList[0].startsWith('--') ? argumentsList.shift() : 'install';
    const options = {};
    for (let index = 0; index < argumentsList.length; index++) {
      const argument = argumentsList[index];
      if (argument === '--dest' || argument === '--preset' || argument === '--font-scheme') {
        const value = argumentsList[++index];
        if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
        options[argument === '--dest' ? 'destination' : argument === '--preset' ? 'preset' : 'fontScheme'] = value;
      } else if (argument === '--no-service') options.noService = true;
      else if (argument === '--no-metrics') options.noMetrics = true;
      else if (argument === '--no-localization') options.noLocalization = true;
      else if (argument === '--no-fixes') options.noFixes = true;
      else if (argument === '--style-only') options.styleOnly = true;
      else if (argument === '--gemini-1m') options.gemini1m = true;
      else if (argument === '--upgrade') options.upgrade = true;
      else throw new Error(`Unknown argument: ${argument}`);
    }
    const destination = options.destination || path.join(os.homedir(), '.antigravity-patch');
    let result;
    if (command === 'install') result = installPackage(options);
    else if (command === 'uninstall') result = uninstallPackage(destination);
    else if (command === 'status') result = {manifest:readManifest(validateDestination(destination)), config:fs.existsSync(path.join(destination, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(destination, 'config.json'), 'utf8')) : null};
    else if (command === 'stop') {const manifest = readManifest(validateDestination(destination)); if (!manifest) throw new Error('No installer ownership marker.'); stopService(manifest); result = {stopped:true, note:'The service may start again next login. Use uninstall to disable it permanently; fully quit Antigravity to remove current runtime hooks.'};}
    else throw new Error('Commands: install, status, stop, uninstall');
    console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
