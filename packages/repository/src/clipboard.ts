/**
 * Clipboard reader (Phase 7 — `clipboard_diff` input method).
 *
 * Reads the system clipboard so a developer can copy a diff from anywhere (an
 * IDE, a code-review UI, a chat) and review it with one command. We shell out
 * to the platform's native clipboard tool rather than add a dependency; the
 * reader is injectable so callers/tests can supply their own source.
 */

import { execFile } from 'node:child_process';
import { platform } from 'node:os';

/** Reads and returns the current clipboard text. */
export type ClipboardReader = () => Promise<string>;

interface ClipboardTool {
  readonly cmd: string;
  readonly args: readonly string[];
}

/** Picks the native paste command for the current OS. */
function clipboardTool(): ClipboardTool | undefined {
  switch (platform()) {
    case 'darwin':
      return { cmd: 'pbpaste', args: [] };
    case 'win32':
      // PowerShell is present on all supported Windows versions.
      return { cmd: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] };
    default:
      // Linux/BSD: prefer Wayland's wl-paste, else X11's xclip. We try wl-paste
      // first; the resolver falls back to xclip if it is missing.
      return { cmd: 'wl-paste', args: ['--no-newline'] };
  }
}

function run(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(cmd, [...args], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

/**
 * Default clipboard reader backed by the OS paste tool. On Linux it tries
 * `wl-paste` then `xclip` so both Wayland and X11 work out of the box.
 */
export const systemClipboardReader: ClipboardReader = async () => {
  const tool = clipboardTool();
  if (!tool) throw new Error('no clipboard tool available for this platform');
  try {
    return await run(tool.cmd, tool.args);
  } catch (err) {
    if (platform() !== 'darwin' && platform() !== 'win32') {
      // Wayland tool missing — fall back to X11's xclip.
      return run('xclip', ['-selection', 'clipboard', '-o']);
    }
    throw err;
  }
};
