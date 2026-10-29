# Protokół czujnika Queling VBT

Protokół rozpracowany 29.10.2026 na podstawie logu Bluetooth HCI z oficjalnej aplikacji **FightTech**
(`com.queling.fighttech`, wydawca Queling / Xuebin Zhao) i testów z laptopa (Python + `bleak`).
Producent go nie dokumentuje. Wszystko poniżej to obserwacje, a nie specyfikacja.

## Transport

| | |
|---|---|
| Nazwa w rozgłoszeniu BLE | `$ENCODE-xxxx` (u nas `$ENCODE-1311`) |
| Usługa | Nordic UART Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| RX (zapis, komendy) | `6e400002-…`, `write` / `write-without-response` |
| TX (notyfikacje, dane) | `6e400003-…`, `notify` |
| Parowanie / szyfrowanie | brak |
| Połączenia | jedno naraz. Połączony czujnik przestaje się rozgłaszać |

Czujnik **nie rozgłasza się podczas ładowania przez USB**. Przez USB nie wystawia też żadnego interfejsu danych.

## Komendy (1 bajt na RX)

| Bajt | Znaczenie | Odpowiedź na TX |
|---|---|---|
| `0x20` | status | `21 00 LL HH`: u16 LE, napięcie baterii w 0,01 V (np. `7b 01` = 3,79 V) |
| `0x30` | start strumienia | ciągłe pakiety `0x33` |
| `0x31` | stop strumienia | brak (FightTech wysyła ją jako `write` z potwierdzeniem) |

Sekwencja FightTech: włączenie notyfikacji (CCCD = `01 00`), `0x20`, `0x30`, … `0x31`.
Przy przechodzeniu między ekranami aplikacja wysyła `0x20` i `0x31` wielokrotnie.

> Interpretacja `0x21` jako napięcia baterii jest wnioskiem z wartości (3,75–3,79 V, typowe dla ogniwa Li-ion), a nie potwierdzonym faktem.

## Pakiet danych `0x33`

```
33 00 | p0 v0 | p1 v1 | … | p19 v19        (82 bajty)
```

- 20 próbek, każda to dwa `int16` little-endian:
  - `p`: **pozycja linki w mm** (rośnie, gdy linka się wysuwa; w spoczynku ok. -8…0),
  - `v`: **prędkość w mm/s** (dodatnia, gdy linka się wysuwa).
- **100 Hz** (5 pakietów/s; zmierzone 99,9 Hz).
- Jednostki potwierdzone: całka z `v` po fazie ruchu zgadza się ze zmianą `p` z dokładnością do 0–4%.

### Opóźnienie kanału prędkości

`v` jest wygładzana w czujniku i **spóźnia się względem `p` o ok. 5 próbek (50 ms)**. Korelacja
między pochodną pozycji a `v` wynosi 0,89 bez przesunięcia i 0,985 przy przesunięciu o 4–6 próbek.
Szczyty `v` są o ok. 10% niższe niż z pochodnej pozycji. To efekt wygładzania, bo średnie się zgadzają.

Pochodna samej pozycji ma pojedyncze skoki, np. odczyty `258 → 260 → 281` mm, które dają fałszywe
piki > 3 m/s. Dlatego aplikacja łączy oba kanały (zob. [ARCHITECTURE.md](ARCHITECTURE.md#metryki)).

## Narzędzia

Skrypty w [`tools/`](../tools) (Python 3, `pip install bleak`):

| Skrypt | Do czego |
|---|---|
| `scan.py` | skan BLE z RSSI, usługami i danymi producenta |
| `gatt_dump.py <MAC>` | lista usług i charakterystyk, odczyt wartości |
| `listen.py [s] [hex…]` | nasłuch notyfikacji, opcjonalnie wysyła komendy hex |
| `vbt_live.py [s]` | minimalny klient: bateria, start, dekodowanie, stop |
| `parse_snoop.py <btsnoop_hci.log>` | wyciąga zapisy i notyfikacje ATT z logu Androida |
| `analyze.py <att.txt>` | dekoduje pakiety `0x33` i sprawdza zgodność jednostek |
| `lag.mjs` | mierzy opóźnienie i skalę `v` względem pochodnej `p` |

W `vbt_live.py` i `listen.py` adres czujnika jest wpisany na sztywno. Zmień go dla innego egzemplarza.

### Jak zdobyć nowy log z FightTech

1. Na telefonie z Androidem: Opcje programisty → **Debugowanie USB** i **Dziennik snoop Bluetooth HCI**, potem wyłącz i włącz Bluetooth.
2. Zrób trening w FightTech.
3. `adb bugreport bugreport.zip`, a następnie wyciągnij `FS/data/misc/bluetooth/logs/btsnoop_hci.log`.
4. `python tools/parse_snoop.py btsnoop_hci.log > att.txt`

Bugreport zawiera dużo prywatnych danych z telefonu. Trzymaj go w `captures/` (folder jest w `.gitignore`) i nie udostępniaj.
