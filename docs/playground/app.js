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
const shareNoteEl = document.getElementById("share-note");

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
}

// Versioned share payloads: "v1." marks deflate-compressed UTF-8 bytes,
// while a bare payload keeps the legacy uncompressed encoding so links shared
// by older versions keep working.
const HASH_VERSION = "v1.";

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(payload) {
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function readStream(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return readStream(stream);
}

async function inflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder().decode(await readStream(stream));
}

async function encodeHashPayload(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream !== "undefined") {
    try {
      return HASH_VERSION + base64UrlEncode(await deflateBytes(bytes));
    } catch {
      // Fall through to the legacy uncompressed encoding below.
    }
  }
  return base64UrlEncode(bytes);
}

async function decodeHashPayload(payload) {
  if (payload.startsWith(HASH_VERSION)) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("this share link needs DecompressionStream support");
    }
    return inflateBytes(base64UrlDecode(payload.slice(HASH_VERSION.length)));
  }
  return new TextDecoder().decode(base64UrlDecode(payload));
}

async function decodeHash() {
  const match = location.hash.match(/^#t=([A-Za-z0-9\-_.]+)$/);
  if (!match) {
    return "";
  }
  return decodeHashPayload(match[1]);
}

let hashSeq = 0;

async function updateHash(text) {
  const seq = ++hashSeq;
  let payload;
  try {
    payload = await encodeHashPayload(text);
  } catch {
    return; // keep the previous link rather than writing a broken one
  }
  if (seq !== hashSeq) {
    return; // a newer keystroke already superseded this render
  }
  if (payload.length > MAX_HASH_CHARS) {
    // Leave the URL untouched and say so: silently dropping share state
    // would strand anyone holding the stale link.
    shareNoteEl.textContent = "Input too long for a shareable link — the URL was left unchanged.";
    return;
  }
  shareNoteEl.textContent = "";
  history.replaceState(null, "", `#t=${payload}`);
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

  updateHash(text);
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

  const shared = await decodeHash().catch((err) => {
    showError(`Could not open the shared link: ${err}`);
    return "";
  });
  inputEl.value = shared !== "" ? shared : "def calculate_fibonacci(n: int) -> int:\nprint('hello world 🌍')";
  inputEl.addEventListener("input", scheduleRender);
  render();
}

boot();
