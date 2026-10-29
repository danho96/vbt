// Sensor sources. Both emit the same events:
//   'state'   detail: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
//   'battery' detail: volts
//   'samples' detail: Array<[position mm, velocity mm/s]>
import {
  NUS_SERVICE, NUS_RX, NUS_TX, NAME_PREFIX, CMD_STATUS, CMD_START, CMD_STOP,
  parsePacket, hexToDataView,
} from './protocol.js';

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

class SensorBase extends EventTarget {
  name = '';
  state = 'disconnected';

  emit(type, detail) {
    if (type === 'state') this.state = detail;
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  handlePacket(view) {
    const packet = parsePacket(view);
    if (packet.type === 'battery') this.emit('battery', packet.volts);
    else if (packet.type === 'samples') this.emit('samples', packet.samples);
  }
}

export const bluetoothAvailable = () => 'bluetooth' in navigator;

export class BleSensor extends SensorBase {
  #device = null;
  #rx = null;
  #wantConnected = false;

  async connect() {
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: NAME_PREFIX }, { services: [NUS_SERVICE] }],
      optionalServices: [NUS_SERVICE],
    });
    this.name = this.#device.name || 'Czujnik';
    this.#device.addEventListener('gattserverdisconnected', () => this.#onDisconnected());
    this.#wantConnected = true;
    this.emit('state', 'connecting');
    await this.#open();
  }

  async #open() {
    const server = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(NUS_SERVICE);
    this.#rx = await service.getCharacteristic(NUS_RX);
    const tx = await service.getCharacteristic(NUS_TX);
    tx.addEventListener('characteristicvaluechanged', (e) => this.handlePacket(e.target.value));
    await tx.startNotifications();
    await this.#send(CMD_STATUS);
    await this.#send(CMD_START);
    this.emit('state', 'connected');
  }

  #send(cmd) {
    return this.#rx.writeValueWithoutResponse(Uint8Array.of(cmd));
  }

  async #onDisconnected() {
    if (!this.#wantConnected) return;
    this.emit('state', 'reconnecting');
    for (let attempt = 0; this.#wantConnected; attempt++) {
      await new Promise((r) => setTimeout(r, RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]));
      if (!this.#wantConnected) return;
      try {
        await this.#open();
        return;
      } catch {
        // keep retrying until the user disconnects
      }
    }
  }

  async disconnect() {
    this.#wantConnected = false;
    try {
      if (this.#device?.gatt.connected) {
        await this.#send(CMD_STOP);
        this.#device.gatt.disconnect();
      }
    } finally {
      this.emit('state', 'disconnected');
    }
  }
}

/** Replays the reference recording in real time (5 packets/s), looping. */
export class DemoSensor extends SensorBase {
  name = 'Demo';
  #timer = null;

  async connect() {
    this.emit('state', 'connecting');
    const { packets } = await (await fetch(new URL('../demo/recording.json', import.meta.url))).json();
    this.emit('battery', 3.79);
    this.emit('state', 'connected');
    let i = 0;
    this.#timer = setInterval(() => this.handlePacket(hexToDataView(packets[i++ % packets.length])), 200);
  }

  async disconnect() {
    clearInterval(this.#timer);
    this.emit('state', 'disconnected');
  }
}
