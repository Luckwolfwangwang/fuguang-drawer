'use strict';

const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

function expandEnv(value) {
  if (!value) return value;
  return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
}

function stripQuotes(value) {
  if (!value) return value;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return expandEnv(v);
}

/**
 * "C:\App\app.exe,0" -> { file: "C:\App\app.exe", index: 0 }
 * ",0" -> null
 */
function parseIconLocation(location) {
  if (!location) return null;
  let value = stripQuotes(location);
  let index = 0;
  const comma = value.lastIndexOf(',');
  if (comma > 1) {
    const tail = value.slice(comma + 1).trim();
    if (/^-?\d+$/.test(tail)) {
      index = Number(tail);
      value = stripQuotes(value.slice(0, comma));
    }
  }
  if (!value) return null;
  return { file: value, index };
}

function fileExists(file) {
  if (!file) return false;
  try { return fs.existsSync(file); } catch { return false; }
}

/**
 * Finds the best icon source for a desktop item. Windows shortcuts often
 * point at a target executable and carry an empty IconLocation. Extracting
 * the shortcut itself returns the generic "white page" icon, so resolve the
 * real target first.
 */
async function resolveIconSource(item) {
  if (!item || !item.path) return null;

  if (item.ext === '.lnk') {
    try {
      const link = shell.readShortcutLink(item.path);
      const icon = parseIconLocation(link.icon);
      if (icon && fileExists(icon.file)) return icon.file;
      if (link.target && fileExists(link.target)) return link.target;
    } catch {
      // Broken shortcut: fall through to the .lnk icon.
    }
    return item.path;
  }

  if (item.ext === '.url') {
    try {
      const text = await fs.promises.readFile(item.path, 'utf8');
      const match = text.match(/^\s*IconFile\s*=\s*(.+?)\s*$/mi);
      if (match) {
        const icon = parseIconLocation(match[1]);
        if (icon && fileExists(icon.file)) return icon.file;
      }
      const url = text.match(/^\s*URL\s*=\s*(.+?)\s*$/mi);
      if (url && /^https?:/i.test(url[1].trim())) return item.path;
    } catch {
      // Ignore malformed .url files.
    }
    return item.path;
  }

  return item.path;
}

module.exports = {
  parseIconLocation,
  resolveIconSource,
  fileExists,
  expandEnv,
  stripQuotes,
  basenameNoExt: (name) => path.parse(name).name || name,
};
