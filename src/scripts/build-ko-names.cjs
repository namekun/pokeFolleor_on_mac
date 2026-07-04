// Build a lookup of Korean Pokémon names keyed by 3-digit Pokédex number.
// Reads:  src/assets/packs/index.json  ->  { "retro": [ { id, name }, ... ] }
// Fetches: https://pokeapi.co/api/v2/pokemon-species/{dex}/  (names[] where language.name === "ko")
// Writes: src/assets/packs/names-ko.json  ->  { "001": "이상해씨", "002": "이상해풀", ... }

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKS_DIR = path.join(ROOT, "src", "assets", "packs");
const INDEX_FILE = path.join(PACKS_DIR, "index.json");
const OUT_FILE = path.join(PACKS_DIR, "names-ko.json");

const CONCURRENCY = 10;
const MAX_RETRIES = 3;

// "retro/gen-1/009-blastoise" -> 9  (leading digits of the last path segment)
function dexFromId(id) {
  const slug = String(id || "").split("/").pop() || "";
  const m = slug.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function pad3(n) {
  return String(n).padStart(3, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchKoName(dex) {
  const url = `https://pokeapi.co/api/v2/pokemon-species/${dex}/`;
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1s, 2s
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const entry = (data.names || []).find((n) => n.language && n.language.name === "ko");
      if (!entry || !entry.name) throw new Error("no ko name in response");
      return entry.name;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`dex ${dex}: ${lastErr && lastErr.message}`);
}

async function main() {
  if (!fs.existsSync(INDEX_FILE)) {
    console.error("Missing file:", INDEX_FILE);
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  const dexSet = new Set();
  for (const pack of Object.keys(index)) {
    for (const entry of index[pack]) {
      const dex = dexFromId(entry.id);
      if (Number.isFinite(dex)) dexSet.add(dex);
      else console.warn("Could not parse dex from id:", entry.id);
    }
  }

  const dexList = [...dexSet].sort((a, b) => a - b);
  console.log(`Fetching Korean names for ${dexList.length} unique dex numbers...`);

  const results = {};
  const failed = [];
  let cursor = 0;

  async function worker() {
    while (cursor < dexList.length) {
      const dex = dexList[cursor++];
      try {
        results[pad3(dex)] = await fetchKoName(dex);
      } catch (err) {
        failed.push(dex);
        console.error(err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failed.length) {
    console.error(`Failed to fetch ${failed.length} dex: ${failed.sort((a, b) => a - b).join(", ")}`);
    process.exit(1);
  }

  // Serialize manually with sorted keys. A plain object can't preserve this
  // order: JSON.stringify hoists integer-like keys ("100") ahead of
  // leading-zero keys ("001"), so we build the JSON string ourselves.
  const keys = Object.keys(results).sort();
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(results[k])}`).join(",\n");
  fs.writeFileSync(OUT_FILE, `{\n${body}\n}\n`);
  console.log(`Wrote ${OUT_FILE} with ${keys.length} entries.`);
}

main();
