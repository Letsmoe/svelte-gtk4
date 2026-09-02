// Wi-Fi management over nmcli, run through the core's shell bridge. Used by the
// bar's Wi-Fi dropdown and the Settings network page.
import { exec } from "./shell.svelte.js";

export type WifiNetwork = {
  ssid: string;
  signal: number; // 0..100
  secured: boolean;
  active: boolean;
};

// Single-quote a value for safe interpolation into the `sh -c` command.
function shArg(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function run(command: string) {
  try {
    return String(await exec(command)).trim();
  } catch {
    return "";
  }
}

// wifiAvailable reports whether the machine has a Wi-Fi device at all, so the bar
// can hide the Wi-Fi menu on wired-only hosts.
export async function wifiAvailable() {
  const out = await run("nmcli -t -f TYPE device 2>/dev/null");
  return out.split("\n").includes("wifi");
}

export async function wifiEnabled() {
  return (await run("nmcli radio wifi")) === "enabled";
}

export async function setWifiEnabled(on: boolean) {
  await run(`nmcli radio wifi ${on ? "on" : "off"}`);
}

export async function rescanWifi() {
  await run("nmcli dev wifi rescan");
}

// listWifi puts SSID last so a colon inside an SSID can't shift the other fields.
export async function listWifi(): Promise<WifiNetwork[]> {
  const out = await run("nmcli -t -f ACTIVE,SIGNAL,SECURITY,SSID dev wifi 2>/dev/null");
  const byName = new Map<string, WifiNetwork>();
  for (const line of out.split("\n")) {
    if (!line) {
      continue;
    }
    const parts = line.split(":");
    if (parts.length < 4) {
      continue;
    }
    const active = parts[0] === "yes";
    const signal = Number(parts[1]) || 0;
    const secured = parts[2] !== "";
    const ssid = parts.slice(3).join(":").replace(/\\:/g, ":");
    if (!ssid) {
      continue;
    }
    const existing = byName.get(ssid);
    if (!existing || active || signal > existing.signal) {
      byName.set(ssid, { ssid, signal, secured, active: active || Boolean(existing?.active) });
    }
  }
  return [...byName.values()].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal,
  );
}

// connectWifi reuses a saved secret when password is empty.
export async function connectWifi(ssid: string, password = "") {
  if (password) {
    return run(`nmcli dev wifi connect ${shArg(ssid)} password ${shArg(password)}`);
  }
  return run(`nmcli dev wifi connect ${shArg(ssid)}`);
}

export async function disconnectWifi(ssid: string) {
  return run(`nmcli con down ${shArg(ssid)}`);
}

export async function forgetWifi(ssid: string) {
  return run(`nmcli con delete ${shArg(ssid)}`);
}

// savedWifi returns the names of stored Wi-Fi connection profiles.
export async function savedWifi(): Promise<string[]> {
  const out = await run("nmcli -t -f NAME,TYPE con show 2>/dev/null");
  const names: string[] = [];
  for (const line of out.split("\n")) {
    if (!line) {
      continue;
    }
    const parts = line.split(":");
    const type = parts[parts.length - 1];
    if (type && type.includes("wireless")) {
      names.push(parts.slice(0, -1).join(":"));
    }
  }
  return names;
}
