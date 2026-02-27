/**
 * PID File Manager for J.A.R.V.I.S. Daemon
 *
 * Manages the daemon PID file at ~/.jarvis/jarvis.pid
 * for start/stop/status lifecycle commands.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';

const JARVIS_DIR = join(homedir(), '.jarvis');
const LOG_DIR = join(JARVIS_DIR, 'logs');
const PID_PATH = join(JARVIS_DIR, 'jarvis.pid');
const LOG_PATH = join(LOG_DIR, 'jarvis.log');

/**
 * Write the current daemon PID to the PID file.
 */
export function writePid(pid: number): void {
  if (!existsSync(JARVIS_DIR)) {
    mkdirSync(JARVIS_DIR, { recursive: true });
  }
  writeFileSync(PID_PATH, String(pid), 'utf-8');
}

/**
 * Read the PID from the PID file. Returns null if no PID file exists.
 */
export function readPid(): number | null {
  if (!existsSync(PID_PATH)) return null;
  try {
    const content = readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Clear (delete) the PID file.
 */
export function clearPid(): void {
  try {
    if (existsSync(PID_PATH)) {
      unlinkSync(PID_PATH);
    }
  } catch {
    // Ignore errors (file may already be gone)
  }
}

/**
 * Check if a daemon process is currently running.
 * Returns the PID if running, null otherwise.
 * Also cleans up stale PID files.
 */
export function isRunning(): number | null {
  const pid = readPid();
  if (pid === null) return null;

  try {
    // signal 0 doesn't kill the process — just checks if it exists
    process.kill(pid, 0);
    return pid;
  } catch {
    // Process doesn't exist — stale PID file
    clearPid();
    return null;
  }
}

/**
 * Get the PID file path (for display purposes).
 */
export function getPidPath(): string {
  return PID_PATH;
}

/**
 * Get the log file path. Creates the log directory if needed.
 */
export function getLogPath(): string {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  return LOG_PATH;
}

/**
 * Get the log directory path.
 */
export function getLogDir(): string {
  return LOG_DIR;
}
