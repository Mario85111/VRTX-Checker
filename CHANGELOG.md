# Historia zmian

Format wg [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).

## [Nieopublikowane]

### Dodane

- **Precyzja KV cache per model.** Każdy model ma własne pole precyzji z domyślną pozycją `Jak globalnie — …`, która podąża za panelem ustawień. Odpowiada to rzeczywistości: precyzję cache'u zadaje się osobno dla każdego procesu serwera (`--cache-type-k` w llama.cpp, `--kv-cache-dtype` w vLLM), a każdy model chodzi jako osobny serwer. Wcześniej jedno ustawienie globalne obowiązywało wszystkie modele bez możliwości rozdzielenia.
- **Ostrzeżenie o braku sprzętowego FP8.** Wybór 8-bitowego KV cache na karcie Ampere (RTX 30xx) pokazuje w panelu ustawień komunikat z listą modeli, których to dotyczy. Ostrzeżenie jest informacyjne, nie blokujące — na Ampere 8-bitowy cache jest osiągalny programowo przez `q8_0`, kosztem wydajności. Nie pojawia się dla 4 bitów (`q4_0` to zawsze kwantyzacja programowa, działa wszędzie) ani dla karty własnej (nieznana architektura).
- Pole `arch` przy każdej karcie GPU (`ampere` / `ada` / `blackwell`) oraz tablica `FP8_ARCH` rozstrzygająca, które architektury mają sprzętowe FP8.
- `README.md` z modelem obliczeniowym, opisem dziedziczenia precyzji i ograniczeniami.
- 31 nowych testów: sekcja 5c (dziedziczenie i nadpisania precyzji), sekcja 5d (ostrzeżenie o FP8) oraz kontrole spójności w sekcji 7 — m.in. że każda karta z listy ma przypisaną architekturę, żeby dodanie nowej bez `arch` nie wyłączyło po cichu ostrzeżenia. Łącznie 100 testów.

### Zmienione

- **Nazwa: „Kalkulator VRAM dla modeli AI" → „VRTX Checker".** Zmiana obejmuje tytuł strony, nagłówek, meta description, nagłówek eksportu do schowka, banner testów i `README.md`. Klucz `localStorage` celowo pozostaje `vram-calc-v2` — jego zmiana skasowałaby zapisany stan wszystkim, którzy już korzystali z aplikacji.
- Panel globalny: etykieta „Precyzja KV cache" → „Precyzja KV cache — domyślna", z wyjaśnieniem, że modele mogą ją nadpisać. Lista opcji generowana z tabeli `KV_PREC` zamiast wpisanej w HTML, więc globalny select i te na kartach modeli nie mogą się rozjechać.
- Podsumowanie modelu podaje precyzję użytą do wyliczenia (`KV cache 0,75 GiB @ FP16`), a przy nadpisaniu dopisek `(własna)`.
- Eksport do schowka rozdziela kwantyzację wag od precyzji KV i oznacza nadpisania gwiazdką z legendą.
- Zmiana globalnej precyzji przerysowuje karty modeli, żeby etykieta `Jak globalnie — …` pokazywała aktualną wartość.
- `compute()` zwraca w każdym wierszu `kvBits` (faktycznie użyta precyzja) i `kvInherited` (czy pochodzi z ustawienia globalnego).

### Uwagi o zgodności

Klucz `localStorage` pozostaje `vram-calc-v2`. Zapisy sprzed tej zmiany wczytują się bez utraty danych — brak pola `kvBits` przy modelu jest interpretowany jako dziedziczenie precyzji globalnej, czyli dokładnie dotychczasowe zachowanie.

Sygnatura `kvGiB(m, kvBits)` nie zmieniła się — precyzja nadal jest jawnym argumentem, a rozstrzyganie dziedziczenia siedzi w `effKvBits()` wywoływanym przez `compute()`.
