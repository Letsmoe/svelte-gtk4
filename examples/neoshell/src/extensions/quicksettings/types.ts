// The shapes the network and bluetooth backends retain on the bus. The panel
// parses each snapshot once and passes typed values down, so no component
// unpacks `unknown`.

export interface NetworkState {
  available: boolean
  enabled: boolean
  connected: boolean
  ssid: string
  signal: number
  secured: boolean
  device: string
  ipv4: string
  gateway: string
  dns: string[]
}

export interface WifiNetwork {
  ssid: string
  signal: number
  secured: boolean
  active: boolean
  saved: boolean
}

export interface BluetoothState {
  available: boolean
  powered: boolean
  discovering: boolean
  adapter: string
}

export interface BluetoothDevice {
  mac: string
  name: string
  connected: boolean
  paired: boolean
  trusted: boolean
  icon: string
  battery: number
}
