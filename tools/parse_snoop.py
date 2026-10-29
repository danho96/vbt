"""Extract ATT writes/notifications from an Android btsnoop_hci.log (H4 datalink)."""
import struct
import sys
from datetime import datetime, timedelta

BTSNOOP_EPOCH = datetime(2000, 1, 1) - timedelta(microseconds=0x00DCDDB30F2F8000)

ATT_OPS = {
    0x12: "WRITE_REQ",
    0x13: "WRITE_RSP",
    0x52: "WRITE_CMD",
    0x1B: "NOTIFY",
    0x1D: "INDICATE",
    0x0A: "READ_REQ",
    0x0B: "READ_RSP",
}


def records(path):
    with open(path, "rb") as f:
        magic, version, datalink = struct.unpack(">8sII", f.read(16))
        assert magic == b"btsnoop\0", magic
        while header := f.read(24):
            orig_len, incl_len, flags, _drops, ts = struct.unpack(">IIIIq", header)
            yield flags, ts, f.read(incl_len), orig_len


def main(path, only_handles=None):
    reassembly = {}
    for flags, ts, pkt, orig_len in records(path):
        if not pkt or pkt[0] != 0x02:  # H4 ACL only
            continue
        handle_flags, _length = struct.unpack("<HH", pkt[1:5])
        conn = handle_flags & 0x0FFF
        pb = (handle_flags >> 12) & 0x3
        payload = pkt[5:]
        direction = "phone->sensor" if (flags & 1) == 0 else "sensor->phone"
        key = (conn, direction)
        if pb == 0x1:  # continuation fragment
            if key not in reassembly:
                continue
            reassembly[key] += payload
        else:
            reassembly[key] = payload
        buf = reassembly[key]
        if len(buf) < 4:
            continue
        l2_len, cid = struct.unpack("<HH", buf[:4])
        if len(buf) - 4 < l2_len:
            continue  # wait for more fragments
        del reassembly[key]
        if cid != 0x0004:  # ATT
            continue
        att = buf[4 : 4 + l2_len]
        op = att[0]
        name = ATT_OPS.get(op)
        if name is None:
            continue
        attr_handle = struct.unpack("<H", att[1:3])[0] if len(att) >= 3 and op not in (0x13, 0x0B) else None
        if only_handles and attr_handle not in only_handles:
            continue
        value = att[3:] if attr_handle is not None else att[1:]
        when = BTSNOOP_EPOCH + timedelta(microseconds=ts)
        h = f"0x{attr_handle:04x}" if attr_handle is not None else "      "
        trunc = " (truncated)" if orig_len != len(pkt) else ""
        print(f"{when:%H:%M:%S.%f} conn={conn:#05x} {direction:14} {name:10} h={h} len={len(value):3} {value.hex(' ')}{trunc}")


if __name__ == "__main__":
    main(sys.argv[1], {int(h, 16) for h in sys.argv[2:]} or None)
