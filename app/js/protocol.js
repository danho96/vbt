// Queling VBT sensor ($ENCODE-xxxx) protocol, reverse engineered from the FightTech app.
// Transport: Nordic UART Service. Commands are single bytes written to RX; replies arrive as notifications on TX.

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const NAME_PREFIX = '$ENCODE';

export const CMD_STATUS = 0x20; // -> 21 00 <u16 LE battery, 0.01 V>
export const CMD_START = 0x30; // start streaming data packets
export const CMD_STOP = 0x31; // stop streaming

export const SAMPLE_RATE_HZ = 100;

/**
 * Decode one notification.
 * @param {DataView} view
 * @returns {{type: 'battery', volts: number} | {type: 'samples', samples: Array<[number, number]>} | {type: 'unknown', bytes: Uint8Array}}
 *   samples are [position mm, velocity mm/s] pairs.
 */
export function parsePacket(view) {
  const kind = view.getUint8(0);
  if (kind === 0x21 && view.byteLength === 4) {
    return { type: 'battery', volts: view.getUint16(2, true) / 100 };
  }
  if (kind === 0x33 && view.byteLength >= 6 && (view.byteLength - 2) % 4 === 0) {
    const samples = [];
    for (let off = 2; off < view.byteLength; off += 4) {
      samples.push([view.getInt16(off, true), view.getInt16(off + 2, true)]);
    }
    return { type: 'samples', samples };
  }
  return { type: 'unknown', bytes: new Uint8Array(view.buffer, view.byteOffset, view.byteLength) };
}

export function hexToDataView(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return new DataView(bytes.buffer);
}
