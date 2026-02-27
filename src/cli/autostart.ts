/**
 * Autostart Setup for J.A.R.V.I.S.
 *
 * Installs/uninstalls daemon autostart on system boot:
 * - Linux: systemd user service
 * - macOS: launchd plist
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { c, printOk, printErr, printWarn } from './helpers.ts';

function getBunPath(): string {
  try {
    return Bun.which('bun') ?? 'bun';
  } catch {
    return 'bun';
  }
}

function getJarvisPath(): string {
  // When installed globally, import.meta.dir points to the package
  return join(import.meta.dir, '../../bin/jarvis.ts');
}

// ── systemd (Linux) ──────────────────────────────────────────────────

const SYSTEMD_DIR = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_SERVICE = join(SYSTEMD_DIR, 'jarvis.service');

function generateSystemdUnit(): string {
  const bunPath = getBunPath();
  const jarvisPath = getJarvisPath();

  return `[Unit]
Description=J.A.R.V.I.S. Daemon
After=network.target

[Service]
Type=simple
ExecStart=${bunPath} ${jarvisPath} start --foreground
Restart=on-failure
RestartSec=5
Environment=HOME=${homedir()}

[Install]
WantedBy=default.target
`;
}

async function installSystemd(): Promise<boolean> {
  try {
    if (!existsSync(SYSTEMD_DIR)) {
      mkdirSync(SYSTEMD_DIR, { recursive: true });
    }

    writeFileSync(SYSTEMD_SERVICE, generateSystemdUnit(), 'utf-8');

    // Reload systemd and enable
    const reload = Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);
    if (reload.exitCode !== 0) {
      printErr('Failed to reload systemd. You may need to run: systemctl --user daemon-reload');
      return false;
    }

    const enable = Bun.spawnSync(['systemctl', '--user', 'enable', 'jarvis.service']);
    if (enable.exitCode !== 0) {
      printErr('Failed to enable service. You may need to run: systemctl --user enable jarvis.service');
      return false;
    }

    // Enable lingering so the service runs even when not logged in
    const lingering = Bun.spawnSync(['loginctl', 'enable-linger', process.env.USER ?? '']);
    if (lingering.exitCode !== 0) {
      printWarn('Could not enable lingering. Service may stop when you log out.');
    }

    printOk(`Installed systemd service: ${SYSTEMD_SERVICE}`);
    printOk('Service will start on boot. To start now: systemctl --user start jarvis');
    return true;
  } catch (err) {
    printErr(`Failed to install systemd service: ${err}`);
    return false;
  }
}

async function uninstallSystemd(): Promise<boolean> {
  try {
    Bun.spawnSync(['systemctl', '--user', 'stop', 'jarvis.service']);
    Bun.spawnSync(['systemctl', '--user', 'disable', 'jarvis.service']);

    if (existsSync(SYSTEMD_SERVICE)) {
      unlinkSync(SYSTEMD_SERVICE);
    }

    Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);
    printOk('Uninstalled systemd service.');
    return true;
  } catch (err) {
    printErr(`Failed to uninstall systemd service: ${err}`);
    return false;
  }
}

function isSystemdInstalled(): boolean {
  return existsSync(SYSTEMD_SERVICE);
}

// ── launchd (macOS) ──────────────────────────────────────────────────

const LAUNCHD_DIR = join(homedir(), 'Library', 'LaunchAgents');
const LAUNCHD_PLIST = join(LAUNCHD_DIR, 'ai.jarvis.daemon.plist');

function generateLaunchdPlist(): string {
  const bunPath = getBunPath();
  const jarvisPath = getJarvisPath();
  const logDir = join(homedir(), '.jarvis', 'logs');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>ai.jarvis.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>${jarvisPath}</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/jarvis.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/jarvis-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${homedir()}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${join(homedir(), '.bun', 'bin')}</string>
  </dict>
</dict>
</plist>
`;
}

async function installLaunchd(): Promise<boolean> {
  try {
    if (!existsSync(LAUNCHD_DIR)) {
      mkdirSync(LAUNCHD_DIR, { recursive: true });
    }

    // Ensure log directory exists
    const logDir = join(homedir(), '.jarvis', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    writeFileSync(LAUNCHD_PLIST, generateLaunchdPlist(), 'utf-8');

    // Load the plist
    const load = Bun.spawnSync(['launchctl', 'load', LAUNCHD_PLIST]);
    if (load.exitCode !== 0) {
      printWarn('Could not load plist immediately. It will start on next login.');
    }

    printOk(`Installed launchd plist: ${LAUNCHD_PLIST}`);
    printOk('Service will start on login.');
    return true;
  } catch (err) {
    printErr(`Failed to install launchd plist: ${err}`);
    return false;
  }
}

async function uninstallLaunchd(): Promise<boolean> {
  try {
    if (existsSync(LAUNCHD_PLIST)) {
      Bun.spawnSync(['launchctl', 'unload', LAUNCHD_PLIST]);
      unlinkSync(LAUNCHD_PLIST);
    }

    printOk('Uninstalled launchd plist.');
    return true;
  } catch (err) {
    printErr(`Failed to uninstall launchd plist: ${err}`);
    return false;
  }
}

function isLaunchdInstalled(): boolean {
  return existsSync(LAUNCHD_PLIST);
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Install autostart for the current platform.
 */
export async function installAutostart(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return installLaunchd();
  }
  return installSystemd();
}

/**
 * Uninstall autostart for the current platform.
 */
export async function uninstallAutostart(): Promise<boolean> {
  if (process.platform === 'darwin') {
    return uninstallLaunchd();
  }
  return uninstallSystemd();
}

/**
 * Check if autostart is installed for the current platform.
 */
export function isAutostartInstalled(): boolean {
  if (process.platform === 'darwin') {
    return isLaunchdInstalled();
  }
  return isSystemdInstalled();
}

/**
 * Get the name of the autostart mechanism for the current platform.
 */
export function getAutostartName(): string {
  if (process.platform === 'darwin') {
    return 'launchd (Login Item)';
  }
  return 'systemd (User Service)';
}
