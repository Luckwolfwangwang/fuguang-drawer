'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Extracts high-resolution shell icons for a list of paths using Windows'
 * system image list (SHIL_JUMBO). Runs in Windows PowerShell so it works
 * identically in development and in the packaged app.
 *
 * @returns {Promise<Map<string, string>>} path -> PNG data URL
 */
async function extractIcons(paths, options = {}) {
  const result = new Map();
  if (!Array.isArray(paths) || !paths.length) return result;
  if (process.platform !== 'win32') return result;

  const helperPath = options.helperPath;
  const dllPath = options.dllPath;
  if (!helperPath || !dllPath || !fs.existsSync(helperPath) || !fs.existsSync(dllPath)) {
    return result;
  }

  const token = `fuguang-icons-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const inputPath = path.join(os.tmpdir(), `${token}.txt`);
  const outputPath = path.join(os.tmpdir(), `${token}.json`);
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  try {
    await fsp.writeFile(inputPath, paths.join('\r\n'), 'utf8');
  } catch {
    return result;
  }

  try {
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(powershell, [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', helperPath,
          '-InputPath', inputPath,
          '-OutputPath', outputPath,
          '-DllPath', dllPath,
          '-Size', '96',
        ], { windowsHide: true, stdio: 'ignore' });
      } catch (err) {
        reject(err);
        return;
      }

      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error('icon extractor timed out'));
      }, 20000);

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`icon extractor exited ${code}`));
      });
    });

    const raw = await fsp.readFile(outputPath, 'utf8');
    const payload = JSON.parse(raw);
    if (payload && payload.ok && Array.isArray(payload.icons)) {
      for (const entry of payload.icons) {
        if (entry && entry.path && entry.data) {
          result.set(entry.path, `data:image/png;base64,${entry.data}`);
        }
      }
    }
  } catch {
    // Fall back to Electron's icon API on the caller side.
  } finally {
    try { await fsp.unlink(inputPath); } catch { /* ignore */ }
    try { await fsp.unlink(outputPath); } catch { /* ignore */ }
  }

  return result;
}

module.exports = { extractIcons };
