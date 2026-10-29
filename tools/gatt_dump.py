import asyncio
import sys
from bleak import BleakClient


async def main(address):
    async with BleakClient(address, timeout=20.0) as client:
        print(f"connected to {address}")
        for service in client.services:
            print(f"[service] {service.uuid}  {service.description}")
            for char in service.characteristics:
                line = f"  [char] {char.uuid}  props={','.join(char.properties)}  {char.description}"
                if "read" in char.properties:
                    try:
                        value = await client.read_gatt_char(char)
                        line += f"  value={value.hex()} {value!r}"
                    except Exception as e:
                        line += f"  read error: {e}"
                print(line)


asyncio.run(main(sys.argv[1]))
