"""Decode 0x33 data packets from parse_snoop.py output and check how channel A relates to channel B."""
import re
import struct
import sys
from datetime import datetime

samples = []  # (packet_time, a, b)
packet_times = []
for line in open(sys.argv[1], encoding="utf-16" if open(sys.argv[1], "rb").read(2) == b"\xff\xfe" else "utf-8"):
    m = re.match(r"(\S+) .*NOTIFY .*len= 82 (33 00 .*)$", line.strip())
    if not m:
        continue
    t = datetime.strptime(m.group(1), "%H:%M:%S.%f")
    raw = bytes.fromhex(m.group(2).replace(" ", ""))
    packet_times.append(t)
    for a, b in struct.iter_unpack("<hh", raw[2:]):
        samples.append((a, b))

span = (packet_times[-1] - packet_times[0]).total_seconds()
rate = (len(samples) - 20) / span
print(f"packets={len(packet_times)} samples={len(samples)} span={span:.2f}s -> {rate:.1f} Hz")

a = [s[0] for s in samples]
b = [s[1] for s in samples]
print(f"A range {min(a)}..{max(a)}   B range {min(b)}..{max(b)}")

# Split into reps: segments where |B| is clearly non-zero.
reps, inside, start = [], False, 0
for i, v in enumerate(b):
    if not inside and abs(v) > 30:
        inside, start = True, i
    elif inside and all(abs(x) <= 2 for x in b[i : i + 10]):
        inside = False
        reps.append((start, i))
dt = 1 / rate
for n, (s, e) in enumerate(reps, 1):
    seg_b = b[s:e]
    # Concentric phase = from start until B first changes sign.
    up_end = next((i for i, v in enumerate(seg_b) if v < 0), len(seg_b))
    up_b = seg_b[:up_end]
    integral = sum(up_b) * dt
    da = a[s + up_end] - a[s]
    print(
        f"rep {n}: samples {s}-{e}  A {a[s]} -> peak {max(a[s:e])}  "
        f"concentric: {len(up_b) * dt:.2f}s, B peak {max(up_b)}, B mean {sum(up_b) / max(len(up_b), 1):.0f}, "
        f"sum(B)*dt={integral:.1f}  dA={da}  ratio={integral / da if da else float('nan'):.2f}"
    )
