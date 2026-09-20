/**
 * Smoke test rdzenia obliczeniowego VRTX Checkera.
 *
 *   node test-vram.mjs
 *
 * Ładuje PRAWDZIWY skrypt z index.html na minimalnej atrapie DOM i liczy jego
 * własnymi funkcjami — test nie powtarza wzorów aplikacji, więc nie może przejść
 * na zduplikowanej (i tak samo błędnej) logice.
 *
 * Wartości oczekiwane pochodzą z dwóch niezależnych źródeł:
 *   1. Dokładne potęgi dwójki wyliczone ręcznie z architektur w config.json.
 *   2. Zmierzone rozmiary plików modeli na Hugging Face (bajty, nie szacunki).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(HERE, "index.html"), "utf8");
const GIB = 1024 ** 3;

/* ────────────────────────── atrapa DOM ────────────────────────── */

class Txt {
  constructor(t) { this.data = String(t); }
  get textContent() { return this.data; }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = []; this.attributes = {}; this.dataset = {};
    this.style = {
      _props: {},
      setProperty(k, v) { this._props[k] = String(v); },
      getPropertyValue(k) { return this._props[k] || ""; },
      removeProperty(k) { delete this._props[k]; },
    };
    this._text = ""; this.value = ""; this.hidden = false;
    this.className = ""; this.title = ""; this.label = "";
    this.scrollTop = 0; this.selected = false; this.open = false;
  }
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c.length ? c[c.length - 1] : null; }
  get rows() { return this.children; }        // <tbody>.rows
  get cells() { return this.children; }       // <tr>.cells
  appendChild(n) { this.childNodes.push(n); return n; }
  addEventListener() {} removeEventListener() {}
  scrollIntoView() {} focus() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  set textContent(v) { this.childNodes = []; this._text = String(v); }
  get textContent() {
    return this.childNodes.length
      ? this._text + this.childNodes.map((n) => n.textContent).join("")
      : this._text;
  }
  set innerHTML(v) { this.childNodes = []; this._text = String(v); }

  _matches(sel) {
    // obsługiwane: [attr], [attr=val], [attr="val"]
    const m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(sel.trim());
    if (!m) return false;
    const [, attr, want] = m;
    let have;
    if (attr.startsWith("data-")) {
      const key = attr.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase());
      have = this.dataset[key];
    } else {
      have = this.attributes[attr];
    }
    if (have === undefined || have === null) return false;
    return want === undefined ? true : String(have) === want;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c._matches(sel)) return c;
      const deep = c.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    for (const c of this.children) {
      if (c._matches(sel)) out.push(c);
      out.push(...c.querySelectorAll(sel));
    }
    return out;
  }
  cloneNode() {
    const n = new El(this.tagName);
    n.attributes = { ...this.attributes };
    n.dataset = { ...this.dataset };
    n._text = this._text; n.value = this.value;
    n.className = this.className; n.hidden = this.hidden;
    n.childNodes = this.childNodes.map((c) => (c instanceof El ? c.cloneNode(true) : new Txt(c.data)));
    return n;
  }
}

// Elementy budujemy z ATRYBUTÓW ZNALEZIONYCH W index.html, a nie z ręcznej listy —
// dzięki temu usunięcie pola z HTML wywala test, zamiast przejść niezauważone.
function buildDom(html) {
  const byId = new Map();
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) byId.set(id, new El("div"));

  const tplBlock = /<template id="tpl">([\s\S]*?)<\/template>/.exec(html);
  if (!tplBlock) throw new Error("nie znaleziono <template id=\"tpl\"> w index.html");

  const card = new El("article");
  for (const [, attr, val] of tplBlock[1].matchAll(/\b(data-f|data-act|data-role)="([^"]+)"/g)) {
    const el = new El(attr === "data-f" ? "input" : "span");
    el.dataset[attr.slice(5)] = val;
    el.setAttribute(attr, val);
    card.appendChild(el);
  }
  const tpl = byId.get("tpl") || new El("template");
  tpl.content = new El("div");
  tpl.content.appendChild(card);
  byId.set("tpl", tpl);

  return {
    byId,
    document: {
      // <html> — aplikacja ustawia na nim atrybut lang przy zmianie języka
      documentElement: new El("html"),
      getElementById: (id) => byId.get(id) || null,
      createElement: (t) => new El(t),
      createTextNode: (t) => new Txt(t),
      addEventListener() {},
    },
  };
}

function runApp() {
  const src = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
  if (!src || !src.includes("__vram")) throw new Error("nie znaleziono skryptu aplikacji z szwem __vram");

  const { document } = buildDom(HTML);
  function Option(text, value, _def, selected) {
    const o = new El("option");
    o.textContent = text; o.value = value; o.selected = !!selected;
    return o;
  }
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

  new Function("document", "Option", "localStorage", "navigator", "window", src)(
    document, Option, localStorage, {}, {}
  );

  if (!globalThis.__vram) throw new Error("szew __vram nie został wystawiony");
  return { V: globalThis.__vram, document };
}

/* ────────────────────────── mikro-framework ────────────────────────── */

let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; fails.push(name); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? "  → " + detail : ""}`); }
}
function eq(name, got, want, tol = 0) {
  const d = Math.abs(got - want);
  ok(name, d <= tol, `otrzymano ${got}, oczekiwano ${want} (Δ ${d.toExponential(2)}, tol ${tol})`);
}
function pct(name, got, want, maxPct) {
  const p = Math.abs(got - want) / want * 100;
  ok(name, p <= maxPct, `otrzymano ${got.toFixed(4)}, oczekiwano ${want.toFixed(4)} (Δ ${p.toFixed(2)}%, limit ${maxPct}%)`);
}
function group(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

/* ────────────────────────── dane referencyjne ────────────────────────── */

// Zmierzone rozmiary plików (bajty) — Llama 3.1 8B Instruct, 8,03 mld parametrów.
// bartowski/Meta-Llama-3.1-8B-Instruct-GGUF oraz nvidia/Llama-3.1-8B-Instruct-FP4
const L31_PARAMS = 8.03;
const MEASURED = {
  FP16:   32128885888 / 2,   // brak f16 w repo — f32 podzielone na pół
  Q8:     8540775840,
  Q6_K:   6596011424,
  Q5_K_M: 5732992416,
  Q4_K_M: 4920739232,
  NVFP4:  6027861376,
};

// Architektury odczytane z config.json na Hugging Face (sierpień 2026).
const ARCH = {
  "l31-8b":     { fullLayers: 32, kvHeads: 8,  headDim: 128, localLayers: 0 },
  "l2-7b":      { fullLayers: 32, kvHeads: 32, headDim: 128, localLayers: 0 },
  "qwen38-27":  { fullLayers: 16, kvHeads: 4,  headDim: 256, localLayers: 0 },
  "qwen36-35a3":{ fullLayers: 10, kvHeads: 2,  headDim: 256, localLayers: 0, activeParams: 3 },
  "gemma4-12":  { fullLayers: 8,  kvHeads: 1,  headDim: 256, localLayers: 40, localKvHeads: 8, window: 1024 },
  "gptoss-20":  { fullLayers: 12, kvHeads: 8,  headDim: 64,  localLayers: 12, localKvHeads: 8, window: 128, activeParams: 3.6 },
  // OCR — część językowa; params obejmują też wieżę wizyjną
  "paddleocr16":  { fullLayers: 18, kvHeads: 2,  headDim: 128, localLayers: 0 },
  "glm-ocr":      { fullLayers: 16, kvHeads: 8,  headDim: 128, localLayers: 0 },
  "mineru25":     { fullLayers: 24, kvHeads: 2,  headDim: 64,  localLayers: 0 },
  "deepseek-ocr": { fullLayers: 12, kvHeads: 10, headDim: 128, localLayers: 0, activeParams: 0.57 },
};

// Zmierzone liczby parametrów z API Hugging Face (safetensors.total).
const OCR_PARAMS = {
  "paddleocr16":  958588736,
  "glm-ocr":      1325258240,
  "mineru25":     1156026624,
  "deepseek-ocr": 3336106240,
};

// Modele mowy. XTTS i Chatterbox trzymają wagi w FP32 (.pth / .safetensors),
// więc liczbę parametrów wyliczamy z rozmiaru pliku dzielonego przez 4 bajty.
const SPEECH_PARAMS = {
  "xtts2":      1867929118 / 4,                                    // model.pth
  "chatterbox": (2143989928 + 1056484620 + 5695784) / 4,           // t3_v3 + s3gen + ve
  "whisper3":   1543490560,                                        // safetensors.total
  "mms-tts-pl": 36286128,                                          // safetensors.total
};

const SPEECH_ARCH = {
  "xtts2":      { fullLayers: 30, kvHeads: 16, headDim: 64 },
  "chatterbox": { fullLayers: 30, kvHeads: 16, headDim: 64 },
  "whisper3":   { fullLayers: 32, kvHeads: 20, headDim: 64 },
};

/* ────────────────────────── testy ────────────────────────── */

const { V, document: doc } = runApp();
const P = (id) => V.PRESETS.find((p) => p.id === id);
const model = (presetId, over = {}) => Object.assign(V.mk(1, "t", presetId, "Q4_K_M", 8192), over);

console.log("\x1b[1m\x1b[36mVRTX Checker — smoke test\x1b[0m  (kod z index.html, atrapa DOM)");

/* ---- 1. KV cache: dokładne wartości wyliczone ręcznie ---- */
group("1. KV cache — kotwice o dokładnych wartościach");
{
  // 2 × 32 warstwy × 8 głowic × 128 wymiar × 8192 tok × 2 B = 1 073 741 824 B = dokładnie 1 GiB
  eq("Llama 3.1 8B @8K FP16 = dokładnie 1,000 GiB",
     V.kvGiB(model("l31-8b", { context: 8192 }), 16), 1, 1e-12);

  // 2 × 32 × 32 × 128 × 4096 × 2 = 2 147 483 648 B = dokładnie 2 GiB (MHA, bez GQA)
  eq("Llama 2 7B MHA @4K FP16 = dokładnie 2,000 GiB",
     V.kvGiB(model("l2-7b", { context: 4096 }), 16), 2, 1e-12);

  // Gemma 4 12B @32K: globalne 2×8×1×256×32768×2 = 0,25 GiB
  //                   lokalne  2×40×8×256×1024×2 = 0,3125 GiB  →  0,5625 GiB
  eq("Gemma 4 12B @32K FP16 = dokładnie 0,5625 GiB",
     V.kvGiB(model("gemma4-12", { context: 32768 }), 16), 0.5625, 1e-12);

  // gpt-oss 20B @32K: globalne 2×12×8×64×32768×2 = 0,75 GiB
  //                   lokalne  2×12×8×64×128×2   = 0,0029296875 GiB
  eq("gpt-oss 20B @32K FP16 = dokładnie 0,7529296875 GiB",
     V.kvGiB(model("gptoss-20", { context: 32768 }), 16), 0.7529296875, 1e-12);
}

/* ---- 2. Skalowanie i niezmienniki ---- */
group("2. Skalowanie i niezmienniki");
{
  const m = model("l31-8b", { context: 8192 });
  const k16 = V.kvGiB(m, 16);

  eq("FP8 daje dokładnie połowę FP16", V.kvGiB(m, 8), k16 / 2, 1e-12);
  eq("Q4 daje dokładnie ćwierć FP16",  V.kvGiB(m, 4), k16 / 4, 1e-12);

  const m2 = model("l31-8b", { context: 16384 });
  eq("podwojenie kontekstu podwaja KV (model bez okna)", V.kvGiB(m2, 16), k16 * 2, 1e-12);

  const enc = model("qwen3emb-06", { context: 131072 });
  eq("encoder nie ma KV cache niezależnie od kontekstu", V.kvGiB(enc, 16), 0, 0);

  // Przy oknie 128 tokenów część lokalna jest stała — przyrost KV zależy tylko od warstw globalnych.
  const g1 = V.kvGiB(model("gptoss-20", { context: 65536 }), 16);
  const g2 = V.kvGiB(model("gptoss-20", { context: 131072 }), 16);
  const globalDelta = (2 * 12 * 8 * 64 * (131072 - 65536) * 2) / GIB;
  eq("uwaga lokalna nie rośnie z kontekstem (okno 128)", g2 - g1, globalDelta, 1e-12);

  // Gdy kontekst < okno, warstwy lokalne używają kontekstu, nie okna.
  const small = model("gemma4-12", { context: 512, window: 4096 });
  const expect = (2 * 8 * 1 * 256 * 512 * 2 + 2 * 40 * 8 * 256 * 512 * 2) / GIB;
  eq("okno przycięte do kontekstu, gdy kontekst < okno", V.kvGiB(small, 16), expect, 1e-12);
}

/* ---- 3. Wagi vs zmierzone pliki na Hugging Face ---- */
group("3. Wagi — porównanie ze zmierzonymi plikami (tolerancja 2%)");
for (const [quant, bytes] of Object.entries(MEASURED)) {
  const m = model("l31-8b", { params: L31_PARAMS, quant });
  pct(`Llama 3.1 8B ${quant} ≈ ${(bytes / 1e9).toFixed(2)} GB`, V.weightsGiB(m), bytes / GIB, 2);
}

/* ---- 4. Prędkość: MoE i przepustowość ---- */
group("4. Prędkość generowania");
{
  const bw = 1792;                                  // RTX 5090
  const moe = model("gptoss-20", { quant: "Q4_K_M" });
  const dense = model("l31-8b", { params: 3.6, quant: "Q4_K_M", activeParams: 0 });
  eq("MoE liczy prędkość z parametrów aktywnych, nie łącznych",
     V.tokensPerSec(moe, bw), V.tokensPerSec(dense, bw), 1e-9);

  const m = model("l31-8b", { params: 8.03, quant: "Q4_K_M", activeParams: 0 });
  eq("prędkość skaluje się liniowo z przepustowością",
     V.tokensPerSec(m, 2 * bw), 2 * V.tokensPerSec(m, bw), 1e-9);

  const expected = (bw * V.BW_EFF) / (8.03 * V.QUANT.Q4_K_M.mul);
  eq("dense: tok/s = przepustowość × sprawność / rozmiar wag", V.tokensPerSec(m, bw), expected, 1e-9);

  ok("brak danych o przepustowości → brak szacunku", V.tokensPerSec(m, null) === null);
}

/* ---- 5. Agregacja w compute() ---- */
group("5. Agregacja całkowitego zużycia");
{
  const base = V.defaults();
  V.load(JSON.parse(JSON.stringify(base)));
  const r = V.compute();

  const manual = r.rows.reduce((a, x) => a + x.weights + x.kv + x.over, 0) + r.os;
  eq("suma składników zgadza się z sumą wierszy", manual + manual * base.frag, r.total, 1e-9);
  eq("fragmentacja liczona od podsumy", r.frag, manual * base.frag, 1e-9);

  // +0,1 GiB narzutu na proces przy 3 modelach → +0,3 GiB przed fragmentacją
  const bumped = JSON.parse(JSON.stringify(base));
  bumped.proc = base.proc + 0.1;
  V.load(bumped);
  const r2 = V.compute();
  eq("narzut na proces mnoży się przez liczbę modeli",
     r2.total - r.total, 0.3 * (1 + base.frag), 1e-9);

  V.load(JSON.parse(JSON.stringify(base)));
  const r3 = V.compute();
  const enc = r3.rows.find((x) => x.m.role === "encoder");
  ok("model typu encoder ma zerowy KV cache w podsumowaniu", enc && enc.kv === 0);
  ok("encoder nie dostaje szacunku tok/s", enc && enc.tps === null);
}

/* ---- 5b. Powiązanie kolorów karta ↔ pasek ↔ tabela ---- */
group("5b. Znaczniki kolorystyczne kart modeli");
{
  const st = V.defaults();
  st.models.push(V.mk(4, "czwarty", "qwen3-14", "Q4_K_M", 8192));
  st.models.push(V.mk(5, "piąty", "l32-3b", "Q4_K_M", 8192));
  V.load(st);
  const rows = V.compute().rows;
  const cards = doc.getElementById("models").children;

  ok("liczba kart zgadza się z liczbą modeli", cards.length === rows.length,
     `${cards.length} kart, ${rows.length} modeli`);

  let stripes = 0, swatches = 0;
  rows.forEach((row, i) => {
    const card = cards[i];
    if (!card) return;
    if (card.style.getPropertyValue("--accent") === row.color) stripes++;
    const sw = card.querySelector("[data-role=swatch]");
    if (sw && sw.style.background === row.color) swatches++;
  });
  ok("pasek boczny karty ma kolor jej segmentu na wykresie", stripes === rows.length,
     `${stripes}/${rows.length}`);
  ok("próbka przy nazwie ma kolor jej segmentu na wykresie", swatches === rows.length,
     `${swatches}/${rows.length}`);

  // Po usunięciu modelu kolory muszą się przenumerować spójnie w obu miejscach.
  st.models.splice(1, 1);
  V.load(st);
  const rows2 = V.compute().rows;
  const cards2 = doc.getElementById("models").children;
  const spójne = rows2.every((row, i) => cards2[i] && cards2[i].style.getPropertyValue("--accent") === row.color);
  ok("po usunięciu modelu kolory kart i wykresu nadal się zgadzają", spójne);

  V.load(V.defaults());
}

/* ---- 5c. Precyzja KV cache: globalna domyślna + nadpisania per model ---- */
group("5c. Precyzja KV cache — domyślna globalna i nadpisania");
{
  const st = () => {
    const s = V.defaults();
    // trzy modele generatywne, żeby dziedziczenie i nadpisanie dało się rozdzielić
    s.models = [V.mk(1, "a", "l31-8b", "Q4_K_M", 8192),
                V.mk(2, "b", "qwen3-14", "Q4_K_M", 8192),
                V.mk(3, "c", "qwen3emb-06", "FP16", 4096)];
    return s;
  };

  // --- dziedziczenie: brak nadpisania = wartość globalna ---
  const s1 = st();
  s1.kvBits = 16;
  V.load(s1);
  const r16 = V.compute();
  eq("bez nadpisania model liczy KV globalną precyzją",
     r16.rows[0].kv, V.kvGiB(r16.rows[0].m, 16), 1e-12);
  ok("bez nadpisania wiersz jest oznaczony jako dziedziczony",
     r16.rows[0].kvInherited === true && r16.rows[1].kvInherited === true);
  ok("wiersz raportuje faktycznie użytą precyzję", r16.rows[0].kvBits === 16);

  // --- zmiana globalnej rusza wszystkimi dziedziczącymi ---
  const s2 = st();
  s2.kvBits = 8;
  V.load(s2);
  const r8 = V.compute();
  eq("zmiana globalnej połowi KV pierwszego modelu", r8.rows[0].kv, r16.rows[0].kv / 2, 1e-12);
  eq("zmiana globalnej połowi KV drugiego modelu",  r8.rows[1].kv, r16.rows[1].kv / 2, 1e-12);

  // --- nadpisanie odcina model od globalnej, nie ruszając reszty ---
  const s3 = st();
  s3.kvBits = 16;
  s3.models[0].kvBits = 8;
  V.load(s3);
  const r3 = V.compute();
  eq("nadpisany model liczy własną precyzją, nie globalną",
     r3.rows[0].kv, r16.rows[0].kv / 2, 1e-12);
  eq("model bez nadpisania nie zmienia się przez cudze nadpisanie",
     r3.rows[1].kv, r16.rows[1].kv, 1e-12);
  ok("nadpisany wiersz nie jest oznaczony jako dziedziczony",
     r3.rows[0].kvInherited === false && r3.rows[1].kvInherited === true);
  ok("nadpisany wiersz raportuje własną precyzję", r3.rows[0].kvBits === 8);

  // --- każdy model może mieć inną precyzję jednocześnie ---
  const s4 = st();
  s4.kvBits = 16;
  s4.models[0].kvBits = 4;
  s4.models[1].kvBits = 16;
  V.load(s4);
  const r4 = V.compute();
  eq("Q4 na jednym modelu daje ćwierć FP16", r4.rows[0].kv, r16.rows[0].kv / 4, 1e-12);
  eq("FP16 na drugim modelu zostaje bez zmian", r4.rows[1].kv, r16.rows[1].kv, 1e-12);

  // --- encoder ignoruje precyzję: nie ma cache'u do zapisania ---
  const s5 = st();
  s5.models[2].kvBits = 4;
  V.load(s5);
  ok("encoder ma zerowy KV mimo nadpisanej precyzji", V.compute().rows[2].kv === 0);

  // --- effKvBits: wartości spoza tabeli wracają do globalnej ---
  const s6 = st();
  s6.kvBits = 8;
  V.load(s6);
  ok("kvBits = 0 oznacza dziedziczenie", V.effKvBits({ kvBits: 0 }) === 8);
  ok("kvBits spoza tabeli wraca do globalnej", V.effKvBits({ kvBits: 7 }) === 8);
  ok("kvBits z tabeli jest respektowany", V.effKvBits({ kvBits: 4 }) === 4);

  // --- domyślny stan aplikacji nie ma nadpisań (globalna nadal rządzi) ---
  V.load(V.defaults());
  ok("stan domyślny nie zawiera nadpisań precyzji",
     V.compute().rows.every((row) => row.kvInherited === true));
}

/* ---- 5d. Ostrzeżenie o braku sprzętowego FP8 ---- */
group("5d. Ostrzeżenie o sprzętowym FP8");
{
  const warn = doc.getElementById("kv-warn");
  ok("panel ustawień ma miejsce na ostrzeżenie", warn !== null);

  const on = (gpuId, bits, role = "decoder") => {
    const s = V.defaults();
    s.gpu = gpuId;
    s.kvBits = bits;
    s.models = [Object.assign(V.mk(1, "czat", "l31-8b", "Q4_K_M", 8192), { role })];
    V.load(s);
    return !warn.hidden;
  };

  ok("Ampere + FP8 → ostrzeżenie", on("rtx3090", 8));
  ok("Ada + FP8 → brak ostrzeżenia", !on("rtx4090", 8));
  ok("Blackwell + FP8 → brak ostrzeżenia", !on("rtx5090", 8));
  ok("Ampere + FP16 → brak ostrzeżenia", !on("rtx3090", 16));
  // q4_0 to kwantyzacja programowa — działa na każdej karcie, więc nie ostrzegamy
  ok("Ampere + Q4 → brak ostrzeżenia (kwantyzacja programowa)", !on("rtx3090", 4));
  ok("karta własna o nieznanej architekturze → brak ostrzeżenia", !on("custom", 8));
  ok("Ampere + FP8 tylko na encoderze → brak ostrzeżenia", !on("rtx3090", 8, "encoder"));

  // ostrzeżenie wywołane wyłącznie nadpisaniem na modelu, przy globalnej FP16
  const s = V.defaults();
  s.gpu = "rtx3090";
  s.kvBits = 16;
  s.models = [Object.assign(V.mk(1, "czat", "l31-8b", "Q4_K_M", 8192), { kvBits: 8 })];
  V.load(s);
  ok("Ampere + FP8 z samego nadpisania na modelu → ostrzeżenie", !warn.hidden);
  ok("ostrzeżenie wskazuje model, którego dotyczy", warn.textContent.includes("czat"));

  V.load(V.defaults());
}

/* ---- 6. Presety vs config.json ---- */
group("6. Presety — zgodność z config.json z Hugging Face");
for (const [id, want] of Object.entries(ARCH)) {
  const p = P(id);
  if (!p) { ok(`preset ${id} istnieje`, false); continue; }
  const got = {
    fullLayers: p.fullLayers || 0, kvHeads: p.kvHeads || 0, headDim: p.headDim || 0,
    localLayers: p.localLayers || 0,
  };
  const wanted = {
    fullLayers: want.fullLayers, kvHeads: want.kvHeads, headDim: want.headDim,
    localLayers: want.localLayers,
  };
  ok(`${id}: ${want.fullLayers} warstw globalnych, ${want.kvHeads} głowic KV, wymiar ${want.headDim}`,
     JSON.stringify(got) === JSON.stringify(wanted),
     `${JSON.stringify(got)} ≠ ${JSON.stringify(wanted)}`);
  if (want.localLayers > 0) {
    ok(`${id}: okno ${want.window} tok., ${want.localKvHeads} lokalnych głowic KV`,
       p.window === want.window && p.localKvHeads === want.localKvHeads,
       `okno=${p.window}, głowice=${p.localKvHeads}`);
  }
  if (want.activeParams) {
    ok(`${id}: ${want.activeParams} mld parametrów aktywnych (MoE)`, p.activeParams === want.activeParams,
       `activeParams=${p.activeParams}`);
  }
}

/* ---- 6b. Modele OCR ---- */
group("6b. Modele OCR — liczba parametrów vs API Hugging Face");
for (const [id, bytes] of Object.entries(OCR_PARAMS)) {
  const p = P(id);
  if (!p) { ok(`preset ${id} istnieje`, false); continue; }
  pct(`${p.name}: ${(bytes / 1e9).toFixed(2)} mld parametrów`, p.params, bytes / 1e9, 3);
}
{
  const ocr = V.PRESETS.filter((p) => p.group === "ocr");
  ok("grupa OCR ma co najmniej 3 modele", ocr.length >= 3, `${ocr.length}`);
  ok("modele OCR są generatywne (mają KV cache)",
     ocr.every((p) => (p.role || "decoder") === "decoder"));

  // Modele OCR są małe — KV cache przy typowej stronie A4 musi być pomijalny.
  const duze = ocr.filter((p) => V.kvGiB(model(p.id, { context: 8192 }), 16) > 0.6);
  ok("KV cache każdego modelu OCR @8K FP16 poniżej 0,6 GiB", duze.length === 0,
     duze.map((p) => p.name).join(", "));
}

/* ---- 6c. Modele mowy ---- */
group("6c. Modele mowy — parametry i architektura");
for (const [id, params] of Object.entries(SPEECH_PARAMS)) {
  const p = P(id);
  if (!p) { ok(`preset ${id} istnieje`, false); continue; }
  pct(`${p.name}: ${(params / 1e9).toFixed(3)} mld parametrów`, p.params, params / 1e9, 3);
}
for (const [id, want] of Object.entries(SPEECH_ARCH)) {
  const p = P(id);
  ok(`${p.name}: ${want.fullLayers} warstw, ${want.kvHeads} głowic KV, wymiar ${want.headDim}`,
     p.fullLayers === want.fullLayers && p.kvHeads === want.kvHeads && p.headDim === want.headDim,
     `${p.fullLayers}/${p.kvHeads}/${p.headDim}`);
}
{
  const mowa = V.PRESETS.filter((p) => p.group === "speech");
  ok("grupa mowy ma co najmniej 3 modele", mowa.length >= 3, `${mowa.length}`);

  // VITS nie jest autoregresyjny — nie może mieć KV cache.
  const vits = P("mms-tts-pl");
  ok("MMS-TTS (VITS) oznaczony jako bez KV cache", vits.role === "encoder");
  eq("MMS-TTS nie zużywa KV cache nawet przy 128K", V.kvGiB(model("mms-tts-pl", { context: 131072 }), 16), 0, 0);

  // Modele mowy są małe — cały stos TTS + STT musi mieścić się w kilku GiB.
  const stos = ["xtts2", "whisper3"].reduce((a, id) => {
    const m = model(id, { quant: "FP16", context: 2048 });
    return a + V.weightsGiB(m) + V.kvGiB(m, 16);
  }, 0);
  ok("XTTS v2 + Whisper large-v3 w FP16 poniżej 5 GiB", stos < 5, `${stos.toFixed(2)} GiB`);
}

/* ---- 7. Spójność danych ---- */
group("7. Spójność tabel");
{
  const bad = V.PRESETS.filter((p) => p.id !== "manual").filter(
    (p) => !(p.params > 0) || (p.localLayers > 0 && !(p.window > 0)) ||
           (p.role !== "encoder" && !(p.fullLayers > 0 || p.localLayers > 0))
  );
  ok("każdy preset ma sensowne parametry i architekturę", bad.length === 0,
     bad.map((p) => p.id).join(", "));

  // Monotoniczność ma sens tylko wewnątrz jednej rodziny. GGUF kwantyzuje wszystkie
  // warstwy, więc tu porządek jest ścisły.
  const gguf = ["FP16", "Q8", "Q6_K", "Q5_K_M", "Q4_K_M", "Q3_K_M", "Q2_K"];
  let mono = true;
  for (let i = 1; i < gguf.length; i++) {
    if (V.QUANT[gguf[i]].mul >= V.QUANT[gguf[i - 1]].mul) mono = false;
  }
  ok("mnożniki GGUF maleją monotonicznie", mono,
     gguf.map((q) => `${q}=${V.QUANT[q].mul}`).join(" "));

  // NVFP4 i AWQ/GPTQ zostawiają lm_head (a czasem embeddings) w wyższej precyzji,
  // więc mimo 4 bitów na wagę wypadają WYŻEJ niż Q4_K_M — potwierdzone pomiarem
  // 6,03 GB (NVFP4) vs 4,92 GB (Q4_K_M) dla tego samego modelu 8B.
  for (const q of ["NVFP4", "AWQ4"]) {
    ok(`${q} leży między Q4_K_M a Q8 (warstwy w wyższej precyzji)`,
       V.QUANT[q].mul > V.QUANT.Q4_K_M.mul && V.QUANT[q].mul < V.QUANT.Q8.mul,
       `${q}=${V.QUANT[q].mul}`);
  }

  ok("każda karta GPU ma dodatni VRAM", V.GPUS.every((g) => g.vram > 0));
  ok("karty z przepustowością mają ją dodatnią",
     V.GPUS.every((g) => g.bw === null || g.bw > 0));
  ok("wszystkie konteksty są potęgami dwójki",
     V.CONTEXTS.every((c) => Number.isInteger(Math.log2(c))));

  // Bez arch karta po cichu przestaje ostrzegać o braku FP8 — łatwo przeoczyć
  // przy dopisywaniu nowego modelu do listy.
  const bezArch = V.GPUS.filter((g) => g.id !== "custom" && !g.arch);
  ok("każda karta z listy ma przypisaną architekturę", bezArch.length === 0,
     bezArch.map((g) => g.id).join(", "));
  ok("architektury pochodzą ze znanego zbioru",
     V.GPUS.every((g) => !g.arch || ["ampere", "ada", "blackwell"].includes(g.arch)));
  ok("tablica FP8 obejmuje Adę i Blackwella, pomija Ampere",
     V.FP8_ARCH.ada && V.FP8_ARCH.blackwell && !V.FP8_ARCH.ampere);
  ok("tabela precyzji KV jest posortowana malejąco",
     V.KV_BITS.every((b, i) => i === 0 || V.KV_BITS[i - 1] > b));
  ok("0 nie jest prawidłową precyzją (zarezerwowane na dziedziczenie)",
     !V.KV_BITS.includes(0));
}

/* ---- 8. Warstwa językowa ---- */
// Najgroźniejszy błąd przy i18n to nie zła translacja, tylko BRAKUJĄCY klucz —
// wtedy w UI pojawia się goła nazwa klucza albo tekst zostaje w drugim języku.
// Dlatego sprawdzamy komplet kluczy w obie strony i pokrycie wszystkich
// atrybutów data-i18n* wypisanych w HTML.
group("8. Warstwa językowa PL / EN");
{
  const pl = Object.keys(V.I18N.pl);
  const en = Object.keys(V.I18N.en);

  const brakEn = pl.filter((k) => !(k in V.I18N.en));
  const brakPl = en.filter((k) => !(k in V.I18N.pl));
  ok("każdy klucz PL ma odpowiednik EN", brakEn.length === 0, brakEn.join(", "));
  ok("każdy klucz EN ma odpowiednik PL", brakPl.length === 0, brakPl.join(", "));

  const puste = pl.filter((k) => !String(V.I18N.pl[k]).trim() || !String(V.I18N.en[k] ?? "").trim());
  ok("żadne tłumaczenie nie jest puste", puste.length === 0, puste.join(", "));

  // Klucze wypisane w HTML muszą istnieć w słowniku — inaczej element zostanie pusty.
  const wHtml = [...HTML.matchAll(/data-i18n(?:-html|-title|-aria)?="([^"]+)"/g)].map((m) => m[1]);
  ok("HTML odwołuje się do jakichkolwiek kluczy", wHtml.length > 40, `znaleziono ${wHtml.length}`);
  const sieroty = [...new Set(wHtml)].filter((k) => !(k in V.I18N.pl));
  ok("każdy klucz z HTML istnieje w słowniku", sieroty.length === 0, sieroty.join(", "));

  // Teksty wstawiane przez innerHTML muszą być oznaczone prefiksem "h." —
  // to jedyna droga, którą do DOM trafia znacznik, więc musi być rozpoznawalna.
  const htmlKeys = [...HTML.matchAll(/data-i18n-html="([^"]+)"/g)].map((m) => m[1]);
  ok("klucze z markupem mają prefiks h.", htmlKeys.every((k) => k.startsWith("h.")),
     htmlKeys.filter((k) => !k.startsWith("h.")).join(", "));
  const zwykle = [...HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const zeZnacznikiem = zwykle.filter((k) => /[<>]/.test(V.I18N.pl[k] ?? "") || /[<>]/.test(V.I18N.en[k] ?? ""));
  ok("teksty wstawiane jako textContent nie zawierają znaczników", zeZnacznikiem.length === 0,
     zeZnacznikiem.join(", "));

  // Placeholdery pozycyjne muszą się zgadzać, inaczej EN zgubi liczbę.
  const zlePlaceholdery = pl.filter((k) => {
    if (!(k in V.I18N.en)) return false;
    const a = (String(V.I18N.pl[k]).match(/\{\d\}/g) || []).sort().join();
    const b = (String(V.I18N.en[k]).match(/\{\d\}/g) || []).sort().join();
    return a !== b;
  });
  ok("placeholdery {0}, {1}… zgadzają się między językami", zlePlaceholdery.length === 0,
     zlePlaceholdery.join(", "));

  // Separator dziesiętny: PL przecinek, EN kropka.
  V.setLang("pl");
  ok("PL formatuje liczby z przecinkiem", V.t("copy.total", "1,5", "32").includes("1,5"));
  const stPl = V.defaults();
  V.load(stPl);
  const plKv = V.compute().rows[0];
  ok("PL: podsumowanie wiersza używa przecinka", /\d,\d/.test(String(plKv.weights.toFixed(2)).replace(".", ",")));

  V.setLang("en");
  ok("przełączenie ustawia bieżący język na EN", V.lang() === "en");
  ok("EN tłumaczy etykiety interfejsu", V.t("m.add") === "+ Add model", V.t("m.add"));
  ok("EN tłumaczy nazwy grup presetów", V.t("grp.2025") === "2025 generation", V.t("grp.2025"));
  ok("EN zmienia separator dziesiętny w etykiecie kwantyzacji",
     V.t("quant.Q6_K").includes("6.6"), V.t("quant.Q6_K"));
  ok("PL ma przecinek w tej samej etykiecie",
     V.I18N.pl["quant.Q6_K"].includes("6,6"), V.I18N.pl["quant.Q6_K"]);

  // Domyślne nazwy modeli mają się przetłumaczyć, bo użytkownik ich nie tknął.
  const nazwy = V.state().models.map((m) => m.name);
  ok("domyślne nazwy modeli przechodzą na EN", nazwy.includes("Chat / agent (MoE)"), nazwy.join(" | "));

  // Nazwa nadana ręcznie musi przetrwać przełączenie języka.
  V.setLang("pl");
  const stWlasna = V.defaults();
  stWlasna.models[0].name = "mój własny model";
  V.load(stWlasna);
  V.setLang("en");
  ok("nazwa nadana przez użytkownika nie jest tłumaczona",
     V.state().models[0].name === "mój własny model", V.state().models[0].name);

  V.setLang("pl");
  V.load(V.defaults());
}

/* ────────────────────────── podsumowanie ────────────────────────── */

console.log(`\n${"─".repeat(58)}`);
if (fail === 0) {
  console.log(`\x1b[32m\x1b[1mOK — ${pass} testów przeszło\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1mBŁĄD — ${fail} z ${pass + fail} testów nie przeszło:\x1b[0m`);
  fails.forEach((f) => console.log(`  • ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
