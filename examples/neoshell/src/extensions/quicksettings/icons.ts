// Icon names from the GTK icon theme. The webview build carried its own table
// of 24x24 SVG path data and drew each one inline; GTK resolves an icon name
// through the theme and recolours a symbolic one to the widget's own colour,
// so the table survives as names and the drawing goes away.
//
// The lookup stays because the panel picks icons from backend state — a
// Bluetooth device's org.bluez class, a network's signal bucket — and a table
// beats a chain of conditionals.

export const ICONS: Record<string, string> = {
  wifi: 'network-wireless-signal-excellent-symbolic',
  wifiMedium: 'network-wireless-signal-good-symbolic',
  wifiLow: 'network-wireless-signal-weak-symbolic',
  wifiOff: 'network-wireless-offline-symbolic',
  lock: 'changes-prevent-symbolic',
  bluetooth: 'bluetooth-symbolic',
  camera: 'camera-photo-symbolic',
  moon: 'weather-clear-night-symbolic',
  cast: 'screen-shared-symbolic',
  share: 'send-to-symbolic',
  keyboard: 'input-keyboard-symbolic',
  volume: 'audio-volume-high-symbolic',
  volumeMuted: 'audio-volume-muted-symbolic',
  sun: 'display-brightness-symbolic',
  power: 'system-shutdown-symbolic',
  chevronRight: 'go-next-symbolic',
  chevronLeft: 'go-previous-symbolic',
  chevronDown: 'pan-down-symbolic',
  check: 'object-select-symbolic',
  refresh: 'view-refresh-symbolic',
  battery: 'battery-good-symbolic',
  headset: 'audio-headset-symbolic',
  mouse: 'input-mouse-symbolic',
  phone: 'phone-symbolic',
  speaker: 'audio-speakers-symbolic',
  device: 'computer-symbolic',
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

// iconName is what the markup hands `<gtkicon icon=…>`: the panel keys
// everything by the short name, and this is the one place the theme's spelling
// is known.
export function iconName(name: string): string {
  const themed = ICONS[name]
  if (themed === undefined) {
    return ICONS.device
  }
  return themed
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
