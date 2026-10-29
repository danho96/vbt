# VBT

Aplikacja webowa (PWA) do treningu VBT z czujnikiem **Queling** (`$ENCODE-xxxx`).
Działa w Chrome na Androidzie przez Web Bluetooth: bez kroku budowania i bez backendu. Treningi zostają na telefonie.

**Aplikacja:** https://danho96.github.io/vbt/

| | |
|---|---|
| [HANDOFF.md](HANDOFF.md) | stan projektu, jak uruchomić, znane ograniczenia, kolejne kroki |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | moduły, przepływ danych, algorytm powtórzeń i serii |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | protokół Bluetooth czujnika i narzędzia do jego badania |

## Struktura

- `app/`: aplikacja, publikowana na GitHub Pages przy każdym pushu na `main`
- `tests/`: `npm test` (Node 22+), wykrywanie powtórzeń na nagranej sesji
- `tools/`: skrypty w Pythonie do badania czujnika (`pip install bleak`)

## Uruchomienie lokalne

```
python -m http.server 8080 --directory app
```

Na telefonie przez USB (Web Bluetooth wymaga HTTPS albo localhost): `adb reverse tcp:8080 tcp:8080`,
a potem `http://localhost:8080` w Chrome na telefonie.
