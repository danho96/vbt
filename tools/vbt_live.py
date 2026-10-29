"""Live client for the Queling VBT sensor ($ENCODE-xxxx), protocol reverse engineered from FightTech.

Nordic UART Service. Commands (1 byte, written to RX):
    0x20  status  -> reply 21 00 <u16 LE battery voltage in 0.01 V>
    0x30  start streaming
    0x31  stop streaming
Data packet (notify on TX, 82 bytes): 33 00 + 20 x (int16 LE position [mm], int16 LE velocity [mm/s]), 100 Hz.
"""
import asyncio
import struct
import sys
from bleak import BleakClient

ADDRESS = "CC:08:19:AB:13:11"
NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

CMD_STATUS = b"\x20"
CMD_START = b"\x30"
CMD_STOP = b"\x31"


def on_data(_, data: bytearray):
    if data[0] == 0x21 and len(data) == 4:
        print(f"battery: {struct.unpack_from('<H', data, 2)[0] / 100:.2f} V", flush=True)
    elif data[0] == 0x33 and len(data) == 82:
        samples = list(struct.iter_unpack("<hh", data[2:]))
        pos = [p for p, _ in samples]
        vel = [v for _, v in samples]
        print(f"pos {min(pos):5}..{max(pos):5} mm   vel {min(vel):6}..{max(vel):6} mm/s", flush=True)
    else:
        print(f"unknown: {data.hex(' ')}", flush=True)


async def main(seconds):
    loop = asyncio.get_running_loop()
    disconnected = asyncio.Event()

    def on_disconnect(_):
        print(f"disconnected after {loop.time() - started:.1f}s", flush=True)
        loop.call_soon_threadsafe(disconnected.set)

    started = loop.time()
    async with BleakClient(ADDRESS, timeout=20.0, disconnected_callback=on_disconnect) as client:
        await client.start_notify(NUS_TX, on_data)
        await client.write_gatt_char(NUS_RX, CMD_STATUS, response=False)
        await asyncio.sleep(0.5)
        await client.write_gatt_char(NUS_RX, CMD_START, response=False)
        try:
            await asyncio.wait_for(disconnected.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
        finally:
            if client.is_connected:
                await client.write_gatt_char(NUS_RX, CMD_STOP, response=True)


asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 15))
