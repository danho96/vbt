import asyncio
import sys
import time
from bleak import BleakClient

ADDRESS = "CC:08:19:AB:13:11"
NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # write: commands to the sensor
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # notify: data from the sensor


async def main(seconds, commands):
    start = time.monotonic()
    count = 0

    def on_data(_, data: bytearray):
        nonlocal count
        count += 1
        print(f"{time.monotonic() - start:8.3f}  len={len(data):3}  {data.hex(' ')}", flush=True)

    async with BleakClient(ADDRESS, timeout=20.0) as client:
        await client.start_notify(NUS_TX, on_data)
        print(f"listening {seconds}s", flush=True)
        for cmd in commands:
            payload = bytes.fromhex(cmd)
            print(f"--> write {payload.hex(' ')}", flush=True)
            await client.write_gatt_char(NUS_RX, payload, response=False)
            await asyncio.sleep(1.0)
        await asyncio.sleep(seconds)
        await client.stop_notify(NUS_TX)
    print(f"packets: {count}")


asyncio.run(main(float(sys.argv[1]) if len(sys.argv) > 1 else 20, sys.argv[2:]))
