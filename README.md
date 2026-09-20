# VRTX Checker

Liczy, ile pamięci karty graficznej zajmie **kilka modeli AI załadowanych jednocześnie** — wagi, KV cache i narzuty systemowe. Powstał po to, żeby przed pobraniem 40 GB plików wiedzieć, czy zestaw w ogóle się zmieści.

Aplikacja jest jednym plikiem HTML bez zależności i bez build stepu. Otwierasz `index.html` w przeglądarce i działa — także offline, z pliku lokalnego.

```bash
node test-vram.mjs
```

---

## Dlaczego nie „wagi razy dwa"

Popularne kalkulatory szacują KV cache z liczby parametrów. To nie działa od czasu, gdy modele przestały mieć jednolitą architekturę uwagi. KV cache zależy od **kształtu warstw**, nie od rozmiaru modelu:

- **GQA** — Llama 2 7B ma 32 głowice KV, Llama 3.1 8B tylko 8. Model jest większy, a jego cache **czterokrotnie mniejszy**.
- **Sliding window** — Gemma 4 i gpt-oss trzymają większość warstw w oknie przesuwnym. Ich cache prawie nie rośnie z kontekstem.
- **MoE** — o zajętości VRAM decydują wszystkie wagi, o prędkości tylko aktywne.
- **Encoder** — embeddingi i rerankery nie generują autoregresywnie, więc cache'u nie mają wcale.

Ten kalkulator liczy z rzeczywistej architektury odczytanej z `config.json` każdego modelu.

---

## Model obliczeniowy

### KV cache

```
KV = 2 × warstwy × głowiceKV × wymiarGłowicy × tokeny × bajtyNaElement
```

Mnożnik `2` to klucze i wartości. Warstwy z uwagą globalną liczą się z całym kontekstem, warstwy z oknem przesuwnym tylko z `min(kontekst, okno)`:

```
KV = KV_globalne(kontekst) + KV_lokalne(min(kontekst, okno))
```

Warstw `linear_attention` (Mamba, GDN) nie liczymy — mają stan o stałym rozmiarze, niezależnym od długości kontekstu.

Wzór jest dokładny, nie przybliżony. Testy weryfikują go na kotwicach o wartościach będących równymi potęgami dwójki — np. Llama 3.1 8B przy 8K w FP16 to **dokładnie** 1,000 GiB.

### Wagi

```
wagi = parametry(mld) × mnożnik(kwantyzacja)
```

Mnożniki są **efektywne** — uwzględniają skale kwantyzacji i warstwy trzymane w wyższej precyzji. Nie są wyliczone ze wzoru „bity dzielone przez osiem", tylko skalibrowane na **zmierzonych rozmiarach plików** Llama 3.1 8B Instruct z Hugging Face:

| Kwantyzacja | Mnożnik | Podstawa kalibracji |
|---|---|---|
| FP16 / BF16 | 2,00 | 32 128 885 888 B (f32 ÷ 2) |
| FP8 | 1,00 | — |
| INT8 / Q8_0 | 1,06 | 8 540 775 840 B |
| Q6_K | 0,82 | 6 596 011 424 B |
| Q5_K_M | 0,71 | 5 732 992 416 B |
| NVFP4 | 0,75 | 6 027 861 376 B |
| AWQ / GPTQ INT4 | 0,70 | — |
| Q4_K_M | 0,61 | 4 920 739 232 B |
| Q3_K_M | 0,50 | — |
| Q2_K | 0,40 | — |

Modele o bardzo dużym słowniku (Qwen 151k, Gemma 262k) mogą wyjść nieco wyżej — tabela embeddingów nie skaluje się z liczbą parametrów.

### Suma

```
podsuma = system + Σ(wagi + KV + narzutNaProces)
razem   = podsuma × (1 + fragmentacja)
```

Narzut systemu liczy się **raz**, narzut na proces **razy liczba modeli** — każda instancja dostaje własny kontekst CUDA (0,3–0,5 GiB niezależnie od wielkości modelu) plus bufory obliczeniowe.

### Prędkość generowania

```
tok/s = przepustowość × 0,75 / (parametryAktywne × mnożnik)
```

Generowanie jednego strumienia jest ograniczone przepustowością pamięci: na każdy token trzeba przeczytać wagi. W MoE czyta się tylko aktywnych ekspertów, więc o prędkości decydują parametry **aktywne**, a o zajętości VRAM **wszystkie**.

To szacunek górnej granicy dla pojedynczego strumienia. Batch podnosi przepustowość łączną, nie prędkość jednej odpowiedzi.

---

## Precyzja KV cache — dwa niezależne pokrętła

Najczęstsze nieporozumienie: **kwantyzacja wag** i **precyzja KV cache** brzmią podobnie, ale nie mają ze sobą nic wspólnego i nie nakładają się na siebie.

| | Kwantyzacja wag | Precyzja KV cache |
|---|---|---|
| Gdzie | per model | domyślna globalna + nadpisanie per model |
| Co zmienia | rozmiar **wag** | rozmiar **bufora kontekstu** |
| Wartości | FP16 … Q2_K | FP16, FP8, Q4 |
| Funkcja | `weightsGiB()` | `kvGiB()` |

Model w Q4_K_M może trzymać cache w FP16 i odwrotnie. Nic nie jest liczone dwa razy — `compute()` sumuje oba składniki osobno.

### Dziedziczenie

Precyzja KV cache jest ustawiana **per proces serwera** (`--cache-type-k` w llama.cpp, `--kv-cache-dtype` w vLLM), a każdy model chodzi jako osobny serwer. Dlatego każdy model ma własne pole precyzji, a ustawienie globalne jest tylko **wartością domyślną**:

- Model z ustawieniem `Jak globalnie` (domyślne) podąża za panelem globalnym. Zmiana globalnej rusza wszystkimi takimi modelami naraz.
- Model z własną precyzją jest od globalnej **odcięty** — jego wiersz w podsumowaniu ma dopisek `(własna)`, a w eksporcie do schowka gwiazdkę.

W stanie wewnętrznym nadpisanie zapisane jest jako `m.kvBits`, gdzie `0` oznacza dziedziczenie:

```js
function effKvBits(m) {
  return KV_BITS.indexOf(m.kvBits) >= 0 ? m.kvBits : S.kvBits;
}
```

Wartość `0` nigdy nie jest prawidłową precyzją — jest zarezerwowana wyłącznie na dziedziczenie, co pilnuje osobny test.

### Ostrzeżenie o sprzętowym FP8

FP8 dla KV cache to format **sprzętowy**. Mają go dopiero Ada (RTX 40xx) i Blackwell (RTX 50xx); Ampere (RTX 30xx) nie. Gdy wybierzesz 8-bitowy cache na karcie Ampere, panel ustawień pokaże ostrzeżenie z listą modeli, których to dotyczy.

Ostrzeżenie jest **informacyjne, nie blokujące**, bo 8-bitowy cache na Ampere jest osiągalny programowo (`--cache-type-k q8_0` w llama.cpp) — kosztuje trochę wydajności, ale oszczędność pamięci jest realna. Natomiast `--kv-cache-dtype fp8` w vLLM faktycznie wymaga Ady lub nowszej.

Dla 4 bitów ostrzeżenia nie ma: `q4_0` to zawsze kwantyzacja programowa i działa na każdej karcie. Dla karty własnej też nie — jej architektury nie znamy.

---

## Język interfejsu

Pigułka `PL | EN` w nagłówku przełącza cały interfejs. Wybór zapisuje się razem z resztą stanu, więc wraca przy kolejnej wizycie.

Przełączenie zmienia nie tylko etykiety:

| Element | PL | EN |
|---|---|---|
| Separator dziesiętny | `25,7 GiB` | `25.7 GiB` |
| Etykieta kwantyzacji | `Q6_K — 6,6 bpw` | `Q6_K — 6.6 bpw` |
| Atrybut `lang` dokumentu | `pl` | `en` |
| Eksport do schowka | polski | angielski |

**Nazwy modeli traktowane są jako dane użytkownika.** Przetłumaczą się tylko te, których nigdy nie tknąłeś — domyślne z `defaults()` oraz wzięte z presetu. Nazwa wpisana ręcznie przeżywa przełączenie bez zmian.

Teksty trzymane są w słowniku `I18N` z kluczami `pl` i `en`, a pobierane funkcją `t(klucz, …)` z placeholderami pozycyjnymi `{0}`, `{1}`. Statyczne napisy w HTML są oznaczone atrybutami `data-i18n` (przez `textContent`), `data-i18n-html` (przez `innerHTML`, tylko klucze z prefiksem `h.`), `data-i18n-title` i `data-i18n-aria`.

Test sekcji 8 pilnuje, żeby oba słowniki miały identyczny zbiór kluczy, żeby każdy klucz użyty w HTML istniał w słowniku i żeby placeholdery zgadzały się między językami — brakujący klucz jest przy i18n groźniejszy niż zła translacja, bo daje pusty element albo gołą nazwę klucza.

## Zawartość

**28 presetów modeli** w pięciu grupach, z architekturami odczytanymi z `config.json` na Hugging Face (stan: sierpień 2026):

- **Generacja 2026** — Qwen3.8 27B, Qwen3.6 27B / 35B-A3B, Gemma 4 12B, gpt-oss 20B
- **Generacja 2025** — Qwen3 8B/14B/32B, Bielik 11B v3 (PL), Gemma 3 12B, Phi-4, Llama 3.1/3.2/3.3, Mistral 7B, Llama 2 7B
- **OCR / dokumenty** — PaddleOCR-VL 1.6, GLM-OCR, MinerU 2.5, DeepSeek-OCR
- **Mowa (polski)** — XTTS v2, Chatterbox Multilingual v3, Whisper large-v3, MMS-TTS
- **Embedding / reranker** — Qwen3-Embedding 0.6B/4B, EmbeddingGemma 300M, BGE-M3

Poza tym **10 kwantyzacji wag**, **3 precyzje KV cache**, **10 kart GPU** plus limit własny, konteksty od 2K do 128K.

Presety opisują architekturę, ale wszystkie pola są edytowalne. Zmiana dowolnego z nich przełącza model na `— ręcznie —`.

> Architektury zmieniają się co kwartał. Przy modelu spoza listy zweryfikuj wartości w jego `config.json`: `layer_types` mówi, ile warstw to `full_attention`, a ile `sliding_attention`.

---

## Testy

```bash
node test-vram.mjs
```

117 testów, bez zależności zewnętrznych. Test **ładuje prawdziwy skrypt z `index.html`** na minimalnej atrapie DOM i liczy jego własnymi funkcjami — nie powtarza wzorów aplikacji, więc nie może przejść na zduplikowanej (i tak samo błędnej) logice.

Wartości oczekiwane pochodzą z dwóch niezależnych źródeł: dokładnych potęg dwójki wyliczonych ręcznie z architektur oraz zmierzonych rozmiarów plików na Hugging Face (bajty, nie szacunki).

| Sekcja | Co sprawdza |
|---|---|
| 1 | KV cache — kotwice o dokładnych wartościach |
| 2 | Skalowanie i niezmienniki (precyzja, kontekst, okno) |
| 3 | Wagi vs zmierzone pliki, tolerancja 2% |
| 4 | Prędkość generowania |
| 5 | Agregacja całkowitego zużycia |
| 5b | Spójność kolorów karta ↔ pasek ↔ tabela |
| 5c | Precyzja KV — dziedziczenie i nadpisania |
| 5d | Ostrzeżenie o sprzętowym FP8 |
| 6 | Presety vs `config.json` z Hugging Face |
| 6b–6c | Liczby parametrów OCR i mowy vs API HF |
| 7 | Spójność tabel referencyjnych |
| 8 | Warstwa językowa PL / EN — komplet kluczy, pokrycie HTML, placeholdery |

Atrapa DOM buduje karty modeli **z atrybutów znalezionych w `index.html`**, a nie z ręcznej listy — usunięcie pola z HTML wywala test, zamiast przejść niezauważone.

---

## Struktura

```
index.html      cała aplikacja: HTML, CSS, dane referencyjne, logika
test-vram.mjs   smoke test rdzenia obliczeniowego
```

Skrypt w `index.html` dzieli się na sekcje: dane referencyjne (`QUANT`, `PRESETS`, `GPUS`, `KV_PREC`), stan, rdzeń obliczeń, render, zdarzenia. Na końcu wystawia **szew testowy** `globalThis.__vram` — nie zmienia zachowania UI, służy wyłącznie temu, żeby testy liczyły tym samym kodem, który działa w przeglądarce.

### Stan

Zapisywany do `localStorage` pod kluczem `vram-calc-v2`, z pełną walidacją przy odczycie — plik mógł zostać zapisany przez starszą wersję albo ręcznie zmodyfikowany. Każde pole ma wartość zastępczą, więc uszkodzony zapis nie wywraca aplikacji.

Schemat jest wstecznie zgodny: zapisy bez pola `kvBits` wczytują się jako dziedziczenie globalnej precyzji, brak pola `lang` oznacza polski, a starsza nazwa `layers` jest czytana jako `fullLayers`.

Brak dostępu do `localStorage` (tryb prywatny, `data:` URL) jest obsłużony — aplikacja działa, tylko nie zapamiętuje stanu.

---

## Ograniczenia

- **Narzut na proces to reguła kciuka**, nie zmierzona stała — inaczej niż mnożniki wag. Zmierz własny: uruchom jeden model i porównaj `nvidia-smi --query-gpu=memory.used --format=csv` z sumą wag i KV cache z tabeli.
- **Prędkość to górna granica** dla jednego strumienia przy 75% sprawności przepustowości. Realne wyniki bywają niższe.
- **Kontekst modeli mowy to tokeny audio, nie słowa.** XTTS mieści ok. 1000 tokenów (ok. 20 s mowy), Whisper generuje maks. 448 naraz — najniższa pozycja z listy i tak je przeszacowuje, więc wynik jest po bezpiecznej stronie.
- **Liczby parametrów modeli OCR obejmują wieżę wizyjną**, tak jak raportuje Hugging Face, ale KV cache trzyma tylko część językowa.
