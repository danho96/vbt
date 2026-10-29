# Architektura

Aplikacja webowa (PWA) w czystym JavaScripcie (moduły ES): **bez frameworka, bez kroku budowania,
bez backendu**. Działa w Chrome na Androidzie przez Web Bluetooth. Dane zostają na telefonie.

## Założenia produktowe

- Ciemny, przejrzysty interfejs. Domyślnie prędkość średnia i max, a reszta do włączenia w ustawieniach.
  Oryginalna aplikacja była przeładowana informacjami.
- Główni użytkownicy: zawodnik i trenerka. Każde z nich prowadzi pomiar na własnym telefonie z Androidem.
- Bez kont i synchronizacji. Wymiana danych przez eksport CSV.
- iPhone poza zakresem, bo Safari i WebKit nie obsługują Web Bluetooth. Obejście: przeglądarka Bluefy (nietestowane).

## Moduły

```
app/
├── index.html          5 ekranów: home, live, settings, summary, history (sekcje z [hidden])
├── css/style.css       tokeny kolorów w :root, układ mobilny
├── js/
│   ├── protocol.js     UUID, komendy, parsePacket(): DataView → battery | samples
│   ├── sensor.js       BleSensor (Web Bluetooth, auto-reconnect), DemoSensor (odtwarza nagranie)
│   ├── analysis.js     RepDetector (fazy ruchu), Session (kierunek, serie), metryki
│   ├── settings.js     definicje metryk (METRICS), ustawienia w localStorage
│   ├── history.js      historia treningów w localStorage, eksport CSV
│   └── main.js         nawigacja, renderowanie, spinanie modułów
├── demo/recording.json 122 pakiety z prawdziwej sesji (tryb demo i testy)
├── sw.js               service worker: najpierw sieć, potem cache (działa offline)
└── manifest.webmanifest, icon*.{svg,png}
```

## Przepływ danych

```
BleSensor/DemoSensor ──'samples'──▶ RepDetector.push([pos, vel])
                                        │ fazy ruchu w obu kierunkach (direction ±1)
                                        ▼
                     main.onPhase ──▶ Session.addPhase(phase) ──▶ [{set, rep}] przyjęte powtórzenia
                                        │                              │
                                        │ kierunek, podział na serie   ▼
                                        │                     main.showAccepted → renderLive
                     „Zakończ” ──▶ Session.closeSet() ──▶ history.saveWorkout → summary
```

Oba źródła czujnika (`BleSensor`, `DemoSensor`) emitują te same zdarzenia `state`, `battery` i `samples`,
więc reszta aplikacji nie wie, czy dane są prawdziwe.

## Wykrywanie faz ruchu (`RepDetector`)

1. **Wyrównanie kanałów.** Pozycja czeka w buforze 5 próbek (`VELOCITY_LAG_SAMPLES`), żeby trafić
   w parę z właściwą, spóźnioną prędkością (zob. [PROTOCOL.md](PROTOCOL.md#opóźnienie-kanału-prędkości)).
2. **Faza** to ciąg próbek o tym samym znaku prędkości. Kończy się przy zmianie znaku albo przy zerze.
   Próbki fazy w kierunku „wsuwa” są odbijane (×-1), więc zakres i prędkość zawsze wychodzą dodatnie.
3. **Filtry:** faza się liczy, jeśli prędkość choć raz przekroczyła 100 mm/s, zakres ≥ 5 cm,
   a szczyt ≥ 150 mm/s (`DEFAULT_DETECTION`). Odrzuca to drgania i odkładanie sztangi.

### Metryki

| Metryka | Jak liczona | Dlaczego |
|---|---|---|
| Prędkość średnia | zakres / czas fazy | pozycja nie jest filtrowana, więc to standard dla enkoderów liniowych |
| Prędkość max | max wyrównanej prędkości z czujnika | pochodna pozycji ma fałszywe skoki |
| Zakres ruchu | pozycja końcowa − początkowa | |
| Czas koncentryczny, czas do max | liczba próbek × 10 ms | |
| Spadek prędkości | (najlepsza średnia − bieżąca) / najlepsza | |

> **Uwaga:** na ekranie treningu spadek liczony jest względem najlepszego powtórzenia *do tej pory*
> i tak zostaje zapisany przy powtórzeniu (kolory na liście). W podsumowaniu serii i w CSV spadek liczony jest
> względem najlepszego powtórzenia *całej* serii. Dla powtórzeń przed najlepszym te liczby się różnią.

## Serie i kierunek (`Session`)

- **Nowa seria** zaczyna się po `setGapSeconds` (domyślnie 30 s) bez żadnego ruchu albo po przycisku
  „Nowa seria”. Przerwę mierzy zegar ścienny w `main.onPhase`, więc czas rozłączenia też liczy się jako odpoczynek.
- **Kierunek fazy koncentrycznej** (`settings.direction`):
  - `out`: linka się wysuwa (domyślnie),
  - `in`: linka się wsuwa,
  - `auto`: w każdej serii wygrywa szybszy kierunek (średnio). Decyzja zapada od razu przy różnicy ≥ 20%,
    a w innym razie po 3 fazach w każdą stronę albo na końcu serii. Do tego czasu fazy czekają w `pending`
    i potem pojawiają się naraz. Na nagraniu referencyjnym kierunki różnią się o < 20%, więc
    prosta reguła „pierwsza para” pomyliłaby się w pierwszej serii.
- Zmiana kierunku w ustawieniach działa od następnej serii.
- `addPhase`, `newSet` i `closeSet` zwracają listę **nowo przyjętych** powtórzeń, bo w trybie auto jedno
  zdarzenie może przyjąć kilka zaległych powtórzeń.

## Połączenie (`BleSensor`)

- `requestDevice` z filtrami `namePrefix: '$ENCODE'` **lub** usługa NUS, więc działa z dowolnym egzemplarzem czujnika.
- Po połączeniu: notyfikacje TX, `0x20` (bateria), `0x30` (start).
- `gattserverdisconnected`: ponowne łączenie z przerwami 0,5 / 1 / 2 / 4 / 8 s, w nieskończoność, dopóki
  użytkownik nie zakończy treningu. Nagłówek pokazuje wtedy żółty komunikat.
- „Zakończ” wysyła `0x31` i rozłącza.
- Wake Lock trzyma ekran włączony, bo bez tego Chrome po wygaszeniu ekranu zrywa połączenie BLE.
  Blokada wraca po `visibilitychange`.

## Dane lokalne

| Klucz localStorage | Zawartość |
|---|---|
| `vbt.settings.v1` | ustawienia (metryki, progi, kierunek, wibracja/dźwięk) |
| `vbt.history.v1` | do 200 ostatnich treningów: `{date, sets: [{number, reps: [Rep]}]}` |

Wyczyszczenie danych przeglądarki usuwa historię. Jedyna kopia zapasowa to eksport CSV.
CSV ma separator `;`, przecinki dziesiętne i BOM, czyli format, który otwiera polski Excel.

## Testy

`npm test` (Node 22+) uruchamia [`tests/analysis.test.js`](../tests/analysis.test.js):
- parsowanie pakietów,
- 14 faz w każdą stronę na nagraniu referencyjnym, zakres pierwszego powtórzenia 32,3 cm,
- lustrzane nagranie z „wsuwa” daje identyczne wyniki jak oryginał z „wysuwa”,
- tryb auto przy wyraźnej różnicy (w obie strony) i przy niejednoznacznym nagraniu,
- podział na serie, odrzucanie drgań.

UI nie ma testów automatycznych. Sprawdza się je ręcznie w trybie demo.

## Wdrożenie

GitHub Actions ([`.github/workflows/pages.yml`](../.github/workflows/pages.yml)): każdy push na `main`
uruchamia testy i publikuje folder `app/` na GitHub Pages. Service worker działa w trybie „najpierw sieć”,
więc nowa wersja pojawia się przy następnym otwarciu aplikacji z internetem.
