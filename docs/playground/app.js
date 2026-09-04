// UniqToken playground frontend (no build step, no dependencies).
//
// Tokenizer pills, live metrics, and shareable URL hashes are all computed
// client-side through the `uniqtoken_core` WebAssembly module. Build it with:
//   wasm-pack build crates/uniqtoken_core --target web \
//     --out-dir ../../docs/playground/pkg --no-pack \
//     -- --no-default-features --features wasm
// then serve this directory over HTTP (ES modules require http(s), not file://).

const DEBOUNCE_MS = 50;
const MAX_HASH_CHARS = 4000;

const inputEl = document.getElementById("input");
const chipsEl = document.getElementById("chips");
const errorEl = document.getElementById("error");

const metricEls = {
  tokens: document.getElementById("m-tokens"),
  bpt: document.getElementById("m-bpt"),
  fallback: document.getElementById("m-fallback"),
  logprob: document.getElementById("m-logprob"),
};

let tokenizer = null;
let debounceTimer = 0;

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function encodeHash(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return b64.length <= MAX_HASH_CHARS ? `#t=${b64}` : "";
}

function decodeHash() {
  const match = location.hash.match(/^#t=([A-Za-z0-9\-_]+)$/);
  if (!match) {
    return "";
  }
  try {
    const b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function render() {
  if (!tokenizer) {
    return;
  }
  const text = inputEl.value;
  let tokens;
  let ids;
  try {
    tokens = Array.from(tokenizer.tokens(text));
    ids = Array.from(tokenizer.token_ids(text));
  } catch (err) {
    showError(`Tokenization failed: ${err}`);
    return;
  }

  chipsEl.replaceChildren();
  tokens.forEach((token, index) => {
    const pill = document.createElement("span");
    // textContent (never innerHTML): token bytes cannot inject markup or scripts.
    pill.textContent = token === "" ? "∅" : token;
    pill.className = `chip c${index % 8}`;
    pill.title = `id=${ids[index]}`;
    chipsEl.appendChild(pill);
  });

  metricEls.tokens.textContent = String(tokens.length);
  metricEls.bpt.textContent = tokens.length === 0 ? "0.00" : tokenizer.bytes_per_token(text).toFixed(2);
  metricEls.fallback.textContent = String(tokenizer.fallback_count(text));
  metricEls.logprob.textContent = tokens.length === 0 ? "0.00" : tokenizer.avg_logprob(text).toFixed(3);

  const hash = encodeHash(text);
  history.replaceState(null, "", hash === "" ? location.pathname + location.search : hash);
}

function scheduleRender() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(render, DEBOUNCE_MS);
}

async function boot() {
  let module;
  try {
    module = await import("./pkg/uniqtoken_core.js");
  } catch {
    showError(
      "WebAssembly bundle not found at ./pkg/. Build it with " +
        "`wasm-pack build crates/uniqtoken_core --target web --out-dir ../../docs/playground/pkg " +
        "--no-pack -- --no-default-features --features wasm`, then serve this directory over HTTP."
    );
    return;
  }
  try {
    await module.default();
    tokenizer = new module.PlaygroundTokenizer();
  } catch (err) {
    showError(`Failed to start the tokenizer: ${err}`);
    return;
  }

  document.getElementById("vocab-line").textContent = `Demo vocabulary: ${tokenizer.vocab_size()} entries.`;

  const shared = decodeHash();
  inputEl.value = shared !== "" ? shared : "def calculate_fibonacci(n: int) -> int:\nprint('hello world 🌍')";
  inputEl.addEventListener("input", scheduleRender);
  render();
}

boot();
