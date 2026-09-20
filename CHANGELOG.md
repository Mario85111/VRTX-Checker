# Historia zmian

Format wg [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).

## [Nieopublikowane]

### Dodane

- **Przełącznik języka PL / EN.** Pigułka `PL|EN` w nagłówku przełącza cały interfejs — etykiety, podpowiedzi, nazwy grup presetów, komunikaty, ostrzeżenia, eksport do schowka i atrybut `lang` dokumentu. Wybór zapisuje się razem z resztą stanu. Zmienia się też **separator dziesiętny**: przecinek w PL, kropka w EN (dotyczy także etykiet kwantyzacji, np. `Q6_K — 6,6 bpw` / `6.6 bpw`).
- **Słownik `I18N`** z kluczami `pl` / `en` oraz funkcja `t(klucz, …)` z placeholderami pozycyjnymi `{0}`, `{1}`. Teksty zawierające znaczniki (`<strong>`, `<code>`, `<em>`) mają prefiks `h.` i trafiają do `innerHTML`; to bezpieczne, bo są to literały z pliku, nigdy dane użytkownika — nazwy modeli nadal wstawiamy wyłącznie przez `textContent` i `.value`.
- Statyczne teksty w HTML oznaczone atrybutami `data-i18n`, `data-i18n-html`, `data-i18n-title` i `data-i18n-aria`, wypełniane przez `applyI18nIn()`.
- **Precyzja KV cache per model.** Każdy model ma własne pole precyzji z domyślną pozycją `Jak globalnie — …`, która podąża za panelem ustawień. Odpowiada to rzeczywistości: precyzję cache'u zadaje się osobno dla każdego procesu serwera (`--cache-type-k` w llama.cpp, `--kv-cache-dtype` w vLLM), a każdy model chodzi jako osobny serwer. Wcześniej jedno ustawienie globalne obowiązywało wszystkie modele bez możliwości rozdzielenia.
- **Ostrzeżenie o braku sprzętowego FP8.** Wybór 8-bitowego KV cache na karcie Ampere (RTX 30xx) pokazuje w panelu ustawień komunikat z listą modeli, których to dotyczy. Ostrzeżenie jest informacyjne, nie blokujące — na Ampere 8-bitowy cache jest osiągalny programowo przez `q8_0`, kosztem wydajności. Nie pojawia się dla 4 bitów (`q4_0` to zawsze kwantyzacja programowa, działa wszędzie) ani dla karty własnej (nieznana architektura).
- Pole `arch` przy każdej karcie GPU (`ampere` / `ada` / `blackwell`) oraz tablica `FP8_ARCH` rozstrzygająca, które architektury mają sprzętowe FP8.
- `README.md` z modelem obliczeniowym, opisem dziedziczenia precyzji i ograniczeniami.
- 17 testów warstwy językowej (sekcja 8): komplet kluczy w obie strony, pokrycie wszystkich `data-i18n*` z HTML, zgodność placeholderów, rozdział tekstów z markupem od zwykłych, separator dziesiętny oraz to, że własna nazwa modelu przeżywa przełączenie języka. Łącznie 117 testów.
- 31 nowych testów: sekcja 5c (dziedziczenie i nadpisania precyzji), sekcja 5d (ostrzeżenie o FP8) oraz kontrole spójności w sekcji 7 — m.in. że każda karta z listy ma przypisaną architekturę, żeby dodanie nowej bez `arch` nie wyłączyło po cichu ostrzeżenia. 

### Zmienione

- **Nazwa: „Kalkulator VRAM dla modeli AI" → „VRTX Checker".** Zmiana obejmuje tytuł strony, nagłówek, meta description, nagłówek eksportu do schowka, banner testów i `README.md`. Klucz `localStorage` celowo pozostaje `vram-calc-v2` — jego zmiana skasowałaby zapisany stan wszystkim, którzy już korzystali z aplikacji.
- Panel globalny: etykieta „Precyzja KV cache" → „Precyzja KV cache — domyślna", z wyjaśnieniem, że modele mogą ją nadpisać. Lista opcji generowana z tabeli `KV_PREC` zamiast wpisanej w HTML, więc globalny select i te na kartach modeli nie mogą się rozjechać.
- Podsumowanie modelu podaje precyzję użytą do wyliczenia (`KV cache 0,75 GiB @ FP16`), a przy nadpisaniu dopisek `(własna)`.
- Eksport do schowka rozdziela kwantyzację wag od precyzji KV i oznacza nadpisania gwiazdką z legendą.
- Domyślne nazwy modeli i nazwy wzięte z presetu tłumaczą się przy zmianie języka; nazwa nadana ręcznie przez użytkownika zostaje nietknięta — jest jego danymi, nie etykietą interfejsu.
- Listy rozwijane precyzji KV i kart graficznych są przebudowywane przy zmianie języka (`fillKvPrec()`, `fillGpus()`), więc nie zostają z etykietami w poprzednim języku.
- Zmiana globalnej precyzji przerysowuje karty modeli, żeby etykieta `Jak globalnie — …` pokazywała aktualną wartość.
- `compute()` zwraca w każdym wierszu `kvBits` (faktycznie użyta precyzja) i `kvInherited` (czy pochodzi z ustawienia globalnego).

### Uwagi o zgodności

Klucz `localStorage` pozostaje `vram-calc-v2`. Zapisy sprzed tej zmiany wczytują się bez utraty danych — brak pola `kvBits` przy modelu jest interpretowany jako dziedziczenie precyzji globalnej, czyli dokładnie dotychczasowe zachowanie.

Pole `lang` w zapisanym stanie jest opcjonalne — jego brak oznacza polski, czyli dotychczasowe zachowanie.

Sygnatura `kvGiB(m, kvBits)` nie zmieniła się — precyzja nadal jest jawnym argumentem, a rozstrzyganie dziedziczenia siedzi w `effKvBits()` wywoływanym przez `compute()`.
