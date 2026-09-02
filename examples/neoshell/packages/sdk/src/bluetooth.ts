// Bluetooth management over bluetoothctl, run through the core's shell bridge.
// Used by the bar's Bluetooth dropdown and the Settings bluetooth page.
import { exec } from "./shell.svelte.js";

export type BtDevice = {
  mac: string;
  name: string;
  connected: boolean;
  paired: boolean;
};

async function run(command: string) {
  try {
    return String(await exec(command)).trim();
  } catch {
    return "";
  }
}

function macsOf(out: string): string[] {
  const macs: string[] = [];
  for (const line of out.split("\n")) {
    const match = line.match(/^Device\s+(\S+)/);
    if (match) {
      macs.push(match[1]);
    }
  }
  return macs;
}

// btAvailable reports whether a Bluetooth controller exists, so the bar can hide
// the Bluetooth menu on machines without an adapter.
export async function btAvailable() {
  const out = await run("bluetoothctl list 2>/dev/null");
  return out.startsWith("Controller ");
}

export async function btPowered() {
  const out = await run(
    "bluetoothctl show 2>/dev/null | grep -q 'Powered: yes' && echo yes || echo no",
  );
  return out === "yes";
}

export async function setBtPowered(on: boolean) {
  await run(`bluetoothctl power ${on ? "on" : "off"}`);
}

// scanBt runs a short, detached discovery so listBt picks up nearby devices.
export async function scanBt() {
  await run("bluetoothctl --timeout 6 scan on >/dev/null 2>&1 &");
}

export async function listBt(): Promise<BtDevice[]> {
  const all = await run("bluetoothctl devices 2>/dev/null");
  const connected = new Set(macsOf(await run("bluetoothctl devices Connected 2>/dev/null")));
  const paired = new Set(macsOf(await run("bluetoothctl devices Paired 2>/dev/null")));
  const devices: BtDevice[] = [];
  for (const line of all.split("\n")) {
    const match = line.match(/^Device\s+(\S+)\s+(.+)$/);
    if (!match) {
      continue;
    }
    const mac = match[1];
    devices.push({
      mac,
      name: match[2],
      connected: connected.has(mac),
      paired: paired.has(mac),
    });
  }
  return devices.sort(
    (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name),
  );
}

export async function connectBt(mac: string) {
  return run(`bluetoothctl connect ${mac}`);
}

export async function disconnectBt(mac: string) {
  return run(`bluetoothctl disconnect ${mac}`);
}

export async function pairBt(mac: string) {
  return run(`bluetoothctl pair ${mac}`);
}

export async function removeBt(mac: string) {
  return run(`bluetoothctl remove ${mac}`);
}
