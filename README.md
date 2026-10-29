# VBT

Web app (PWA) for velocity-based training with the Queling VBT sensor (`$ENCODE-xxxx`).
Runs in Chrome on Android via Web Bluetooth; no build step, no backend. Workouts stay on the phone.

- `app/` – the web app, deployed to GitHub Pages on every push to `main`
- `tests/` – `npm test` (Node 22+), runs rep detection against a recorded session
- `tools/` – Python scripts used to reverse engineer the sensor (`pip install bleak`)

## Sensor protocol

Nordic UART Service (`6e400001-b5a3-f393-e0a9-e50e24dcca9e`). Single-byte commands written to RX (`…0002`):

| Command | Meaning | Reply on TX (`…0003`) |
|---|---|---|
| `0x20` | status | `21 00` + u16 LE battery voltage in 0.01 V |
| `0x30` | start streaming | data packets |
| `0x31` | stop streaming | – |

Data packet: `33 00` + 20 × (int16 LE position [mm], int16 LE velocity [mm/s]) at 100 Hz.
The velocity channel is smoothed on the sensor and lags position by ~50 ms (5 samples).

## Local development

```
python -m http.server 8080 --directory app
```

To test on a phone over USB (Web Bluetooth needs HTTPS or localhost):

```
adb reverse tcp:8080 tcp:8080
```

then open `http://localhost:8080` in Chrome on the phone.
