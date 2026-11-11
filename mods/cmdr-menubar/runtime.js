// Portable host helpers. Keep identical copies in cmdr-* folders: Herdr mods
// cannot import another mod's code. No Node APIs or shell interpolation.
import { exec, home } from "herdr";

const runtimes = new Map();
const PROBE = 'import json,sys,os; print(json.dumps({"platform":sys.platform,"home":os.path.expanduser("~"),"executable":sys.executable,"version":list(sys.version_info[:2])}))';
const windowsHome = () => /^[A-Za-z]:[\\/]|^\\\\/.test(home());
const encodePowerShell = (text) => {
  // PowerShell -EncodedCommand is UTF-16LE, not UTF-8. btoa is not available
  // in every Herdr runtime, so encode explicitly using only JavaScript.
  const bytes = [];
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i) & 255, text.charCodeAt(i) >> 8);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63]
      + (b === undefined ? "=" : alphabet[(n >>> 6) & 63])
      + (c === undefined ? "=" : alphabet[n & 63]);
  }
  return out;
};

async function discover(options) {
  const localWindows = !options.on && windowsHome();
  const candidates = [];
  if (localWindows) {
    // An already-open app may still have its old PATH after Python is installed.
    for (const version of ["314", "313", "312", "311", "310", "39"])
      candidates.push([`${home()}/AppData/Local/Programs/Python/Python${version}/python.exe`, []]);
  }
  candidates.push(["py", ["-3"]], ["python3", []], ["python", []]);
  const probe = async ([command, prefix]) => {
    try {
      const r = await exec(command, [...prefix, "-I", "-X", "utf8", "-c", PROBE], { ...options, timeout: 10000 });
      if (r.code !== 0) return null;
      const info = JSON.parse(r.stdout.trim());
      if (info.version?.[0] !== 3 || info.version?.[1] < 9 || !info.executable) return null;
      return { command: info.executable, prefix: [], info };
    } catch { return null; }
  };
  for (const candidate of candidates) {
    const found = await probe(candidate);
    if (found) return found;
  }
  // Also find per-user Python on remote Windows hosts whose SSH PATH is old.
  try {
    const script = "$ErrorActionPreference='Stop'; @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Programs\\Python\\Python*\\python.exe') -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName) | ConvertTo-Json -Compress";
    const r = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)], { ...options, timeout: 10000 });
    if (r.code === 0 && r.stdout.trim()) {
      const paths = JSON.parse(r.stdout.trim());
      for (const path of Array.isArray(paths) ? paths : [paths]) {
        const found = await probe([path, []]);
        if (found) return found;
      }
    }
  } catch {}
  throw new Error(`Python 3.9 or newer is required ${options.on ? `on ${options.on}` : "on this machine"}. Install Python, then retry.`);
}

async function runtime(options = {}) {
  const key = options.on ?? "";
  if (!runtimes.has(key)) {
    const pending = discover(options).catch((error) => { runtimes.delete(key); throw error; });
    runtimes.set(key, pending);
  }
  return runtimes.get(key);
}

export async function execPython(args, options = {}) {
  const selected = await runtime(options);
  // Retry discovery on the next action if an interpreter was removed. Never
  // replay a helper after it started: it may already have written a to-do.
  try { return await exec(selected.command, ["-X", "utf8", ...args], options); }
  catch (error) { runtimes.delete(options.on ?? ""); throw error; }
}

export async function hostInfo(options = {}) {
  return (await runtime(options)).info;
}

export async function openUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error("Only HTTP and HTTPS links can be opened.");
  let result;
  if (windowsHome()) {
    const script = `$ErrorActionPreference='Stop'; Start-Process -FilePath '${url.replace(/'/g, "''")}'`;
    result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)]);
  } else {
    try { result = await exec("xdg-open", [url]); }
    catch { result = await exec("open", [url]); }
    if (result.code !== 0) result = await exec("open", [url]);
  }
  if (result.code !== 0) throw new Error(result.stderr?.trim() || "Could not open the link.");
  return result;
}
