// Icon path data on a 24x24 viewBox, drawn as strokes so one set works at
// tile size and in list rows. Kept as data rather than components: the panel
// picks icons by name from backend state (a Bluetooth device's class, a
// network's signal bucket) and a lookup beats a chain of conditionals.

export const ICONS: Record<string, string> = {
  wifi: 'M2 8.5a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01',
  wifiMedium: 'M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0M12 19h.01',
  wifiLow: 'M8.5 15.5a6 6 0 0 1 7 0M12 19h.01',
  wifiOff: 'M3 3l18 18M8.5 15.5a6 6 0 0 1 7 0M12 19h.01M2 8.5a16 16 0 0 1 6-3.6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  bluetooth: 'M7 7.5l10 9L12 21V3l5 4.5-10 9',
  camera: 'M4 7h3l1.5-2h7L17 7h3v12H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  cast: 'M3 18h.01M3 14a7 7 0 0 1 7 7M3 10a11 11 0 0 1 11 11M4 5h16v10h-6',
  share: 'M17 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM9.2 10.8l5.6-2.9M9.2 13.2l5.6 2.9',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
  volume: 'M4 9v6h3.5L12 19V5L7.5 9zM16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10',
  volumeMuted: 'M4 9v6h3.5L12 19V5L7.5 9zM17 10l4 4M21 10l-4 4',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  power: 'M12 3v9M7.5 6.5a7.5 7.5 0 1 0 9 0',
  chevronRight: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronDown: 'M6 9l6 6 6-6',
  check: 'M4 12.5l5 5L20 6.5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  battery: 'M2 8h16v8H2zM20 11v2',
  headset: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2zM20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2z',
  mouse: 'M12 2a6 6 0 0 1 6 6v8a6 6 0 0 1-12 0V8a6 6 0 0 1 6-6zM12 6v4',
  phone: 'M7 2h10v20H7zM11 18.5h2',
  speaker: 'M5 2h14v20H5zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 6h.01',
  device: 'M4 5h16v11H4zM9 20h6M12 16v4',
}

// A Bluetooth device's org.bluez Icon property is a freedesktop icon name;
// only the families worth distinguishing in a list are mapped.
const DEVICE_ICONS: Record<string, string> = {
  'audio-headset': 'headset',
  'audio-headphones': 'headset',
  'audio-card': 'speaker',
  'input-mouse': 'mouse',
  'input-keyboard': 'keyboard',
  phone: 'phone',
  computer: 'device',
}

export function deviceIcon(icon: string): string {
  const mapped = DEVICE_ICONS[icon]
  if (mapped === undefined) {
    return 'bluetooth'
  }
  return mapped
}

export function signalIcon(signal: number, connected: boolean): string {
  if (!connected) {
    return 'wifiOff'
  }
  if (signal >= 66) {
    return 'wifi'
  }
  if (signal >= 33) {
    return 'wifiMedium'
  }
  return 'wifiLow'
}

// The strength wording matches what the panel shows as a tile subtitle, so the
// same vocabulary appears on the tile and in the network list.
export function signalLabel(signal: number): string {
  if (signal >= 75) {
    return 'Strong'
  }
  if (signal >= 50) {
    return 'Good'
  }
  if (signal >= 25) {
    return 'Weak'
  }
  return 'Very weak'
}
