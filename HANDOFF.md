# Handoff: aplikacja VBT dla czujnika Queling

Stan na 29.10.2026. Dokument dla osoby (albo sesji Claude), która przejmuje projekt.

## Czym jest projekt

Własna aplikacja do treningu VBT (velocity-based training) z czujnikiem **Queling** (linkowy enkoder
pozycji, Bluetooth LE). Zastępuje oryginalną aplikację FightTech, która była nieczytelna.
Używają jej zawodnik i trenerka, każde na swoim telefonie z Androidem w Chrome.

- **Aplikacja:** https://danho96.github.io/vbt/ (instalowana z Chrome: „Dodaj do ekranu głównego”)
- **Repozytorium:** [danho96/vbt](https://github.com/danho96/vbt)
- **Dokumentacja:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PROTOCOL.md](docs/PROTOCOL.md)

## Co działa

- [x] Protokół czujnika rozpracowany i potwierdzony testami na żywo z laptopa i z telefonu
- [x] Połączenie przez Web Bluetooth z dowolnym czujnikiem `$ENCODE-…`, automatyczne ponowne łączenie
- [x] Wykrywanie powtórzeń w obu kierunkach linki (wysuwa / wsuwa / auto)
- [x] Automatyczny podział na serie po przerwie i przycisk „Nowa seria”
- [x] Ekran treningu: duża liczba + kafelki + lista powtórzeń, wszystko konfigurowalne
- [x] Ostrzeżenie o spadku prędkości: kolor, wibracja, opcjonalnie dźwięk
- [x] Podsumowanie, historia na telefonie, eksport CSV (polski Excel)
- [x] Tryb demo na prawdziwym nagraniu, działanie offline, ekran nie gaśnie w trakcie treningu
- [x] 10 testów jednostkowych, CI i automatyczne wdrożenie

Użytkownik przetestował aplikację z czujnikiem na telefonie i potwierdził, że działa, także z wyborem kierunku.

## Jak uruchomić

```bash
python -m http.server 8080 --directory app       # aplikacja na http://localhost:8080
npm test                                         # testy (Node 22+)
```

Na telefonie przez USB (Web Bluetooth wymaga HTTPS albo localhost):

```bash
adb reverse tcp:8080 tcp:8080
```

Potem otwórz `http://localhost:8080` w Chrome na telefonie. Bez czujnika użyj „Tryb demo”.

**Wdrożenie:** push na `main`. GitHub Actions uruchamia testy i publikuje `app/`.

## Środowisko na komputerze właściciela (Windows)

- Node.js 26 (winget `OpenJS.NodeJS.LTS`), Python 3.13 + `bleak`, `adb` (winget `Google.PlatformTools`), `gh` zalogowany jako `danho96`.
- Git w tym repo ma ustawione `http.sslBackend=schannel`, bo bez tego push kończył się błędem certyfikatu SSL.
- Czujnik użytkownika: `$ENCODE-1311`, MAC `CC:08:19:AB:13:11`. Telefon: POCO X6 Pro 5G.
- Folder `captures/` (poza repo) zawiera oryginalny log HCI i bugreport z telefonu. To prywatne dane, nie publikować.

## Znane ograniczenia i ryzyka

| Temat | Opis | Waga |
|---|---|---|
| Zgodność z FightTech | Metryki liczone metodą standardową, ale nieporównane z FightTech na tej samej serii | średnia |
| Opóźnienie prędkości | 5 próbek oszacowane z jednego nagrania (ok. 25 s ruchu) | niska |
| Bateria | `0x21` → napięcie to wniosek z wartości, nie potwierdzony. Brak progu „niski poziom” | niska |
| Zerwanie połączenia | Raz (test z laptopa) połączenie zerwało się po 4,5 s z nieznanego powodu. Ponowne łączenie zaimplementowane, ale nieprzetestowane na prawdziwym zerwaniu | średnia |
| Sklejone powtórzenia | Jeśli prędkość nie spadnie do zera między powtórzeniami (bez pauzy na górze/dole), dwa ruchy liczą się jako jeden (na nagraniu: 73 cm) | niska |
| Pauza w połowie ruchu | Zatrzymanie w trakcie fazy koncentrycznej dzieli ją na dwie fazy | niska |
| Tryb auto | Przy szybkich, symetrycznych ruchach może wybrać zły kierunek. Dlatego domyślnie „wysuwa” | niska |
| Spadek: live vs CSV | Na żywo względem najlepszego *do tej pory*, w CSV i podsumowaniu względem najlepszego w serii | kosmetyczna |
| Historia | Tylko localStorage, maks. 200 treningów. Wyczyszczenie danych Chrome je usuwa | średnia |
| iPhone | Nieobsługiwany (brak Web Bluetooth w WebKit) | poza zakresem |

## Wersja 2 (branch `feature/trainer-v2`)

Na podstawie materiałów od trenerki (rendery z Gemini, filmy Vitruve i OVR Velocity; materiały
w `trener_info/`, poza repo). Jej priorytet: wartość główna, powtórzenia i podsumowanie serii.
Reszta to dodatki.

- [x] Jeden ciemny motyw na wszystkich zakładkach, dolna nawigacja (Trening, Strefy, Zawodnicy, Ustawienia)
- [x] Ekran treningu jak render 1: ćwiczenie, „Seria N | Powt. M”, pierścień, 3 kafelki z ikonami, karta serii
- [x] Strefy prędkości (Moc, Hipertrofia, Siła + własne, edycja podwójnym suwakiem), kolorowanie i pierścień
- [x] Zawodnik, ćwiczenie i ciężar przypisane do serii, moc w W
- [x] Podsumowanie jak render 2: wykres słupkowy, tabela, komentarz, „Zatwierdź wynik”
- [x] Zawodnicy: wyszukiwarka, wykres postępu (także przy stałym ciężarze), lista treningów ze statusem
- [x] Próba na telefonie z prawdziwym czujnikiem (scalone do `main` w PR #1)
- [x] Statystyki z renderów 5–7 (branch `feature/progress-stats`): postęp każdego ćwiczenia u zawodnika
  (trend przy głównym ciężarze, mini-wykres), ekran ćwiczenia (wykres, kluczowe dane, trend, tabela, raport CSV),
  karta „Ćwiczenia” w podsumowaniu treningu (średnia per ćwiczenie, czas treningu, status)
- Świadomie pominięte z renderów: bateria na ekranie treningu (użytkownik wcześniej prosił o jej usunięcie),
  zdjęcia zawodników (są inicjały), „metalowe” tła z renderów 5–7, RPE.

## Pomysły na kolejne kroki

Dalszy kierunek ustala zawodnik z trenerką. Do tej pory zgłaszane były tylko uwagi o przejrzystości.

1. **Porównanie z FightTech:** jedna seria nagrana równocześnie (snoop log) i porównanie liczb z ekranem FightTech.
2. **Ćwiczenie i ciężar** przy serii (do CSV i historii). To naturalny następny krok, jeśli trenerka chce analizować dane.
3. **Strefy prędkości** (np. siła / moc / szybkość) jako kolor dużej liczby.
4. **Profil siła–prędkość i szacowanie 1RM**, jeśli dojdzie ciężar.
5. **Kopia historii** (eksport/import JSON) albo synchronizacja, jeśli trenerka chce widzieć treningi zdalnie.
6. Test ponownego łączenia: wyłączyć czujnik w trakcie serii i włączyć z powrotem.
