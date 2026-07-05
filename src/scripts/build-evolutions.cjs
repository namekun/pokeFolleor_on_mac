// Build the gen1-4 evolution graph so content.js can auto-evolve the follower.
// Reads:  src/assets/packs/index.json  ->  { "retro": [ { id, name }, ... ] } (dex range gate + existence check)
// Fetches: https://pokeapi.co/api/v2/pokemon-species/{dex}/     (evolution_chain.url)
//          https://pokeapi.co/api/v2/evolution-chain/{id}/      (the chain tree, fetched once per unique chain)
// Writes: src/assets/packs/evolutions.json -> { "001": { to: [{ dex: "002", level: 16 }] }, ... }
//
// Non-level evolution methods are converted to a flat level so the XP/level
// engine (which has no concept of stones/trade/friendship) has a single
// number to compare against:
//   - level-up with an explicit min_level -> that level
//   - use-item (evolution stones)         -> 36
//   - trade                               -> 40
//   - min_happiness set (friendship)      -> 30
//   - anything else (location/time/move/etc. special conditions) -> 36
// Only edges where BOTH species are within gen1-4 (dex <= 493) are kept.
//
// A source entry gets `baby: true` when PokeAPI flags that species
// is_baby (Pichu, Cleffa, Togepi, Tyrogue, ...). Consumers (content.js's
// isLockedDex, popup.js's lock UI) use this to except a baby's own
// immediate evolution from the lock policy -- e.g. Pikachu is selectable
// from the start even though it's Pichu's evolution result, since in normal
// play nobody starts with a baby (it only appears via breeding); Raichu
// (Pikachu's own evolution) stays locked as usual.

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKS_DIR = path.join(ROOT, "src", "assets", "packs");
const INDEX_FILE = path.join(PACKS_DIR, "index.json");
const OUT_FILE = path.join(PACKS_DIR, "evolutions.json");

const MAX_DEX = 493; // gen1-4 ceiling: evolutions resulting in gen5+ are excluded
const CONCURRENCY = 10;
const MAX_RETRIES = 3;

const LEVEL_STONE = 36;
const LEVEL_TRADE = 40;
const LEVEL_FRIENDSHIP = 30;
const LEVEL_SPECIAL = 36; // location/time/move/other special conditions

function pad3(n) {
  return String(n).padStart(3, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "retro/gen-1/009-blastoise" -> 9
function dexFromId(id) {
  const slug = String(id || "").split("/").pop() || "";
  const m = slug.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

// PokeAPI resource URLs end in ".../pokemon-species/2/" (or "/evolution-chain/2/")
function idFromUrl(url) {
  const m = String(url || "").match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : NaN;
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, attempt - 1)); // 500ms, 1s, 2s
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Convert one evolves_to node's evolution_details[0] into a flat level.
// Multiple detail entries (alternate ways to reach the same target) collapse
// to the first one -- Phase 1 has no per-method state (items/trade/friendship)
// so there is no way to distinguish between them anyway.
function levelFromDetails(details) {
  const d = (details && details[0]) || {};
  if (typeof d.min_level === "number") return d.min_level;
  const trigger = d.trigger && d.trigger.name;
  if (trigger === "use-item") return LEVEL_STONE;
  if (trigger === "trade") return LEVEL_TRADE;
  if (typeof d.min_happiness === "number") return LEVEL_FRIENDSHIP;
  return LEVEL_SPECIAL;
}

// Walk one evolution-chain response, emitting a { fromDex: { to: [...] } }
// edge for every parent->child link in the tree (not just the root).
function walkChain(node, dexSet, out) {
  const fromDex = idFromUrl(node.species && node.species.url);
  const children = node.evolves_to || [];
  if (Number.isFinite(fromDex) && dexSet.has(fromDex)) {
    const to = [];
    for (const child of children) {
      const toDex = idFromUrl(child.species && child.species.url);
      if (Number.isFinite(toDex) && dexSet.has(toDex)) {
        to.push({ dex: pad3(toDex), level: levelFromDetails(child.evolution_details) });
      }
    }
    if (to.length) {
      const key = pad3(fromDex);
      out[key] = out[key] || { to: [] };
      out[key].to.push(...to);
    }
  }
  for (const child of children) walkChain(child, dexSet, out);
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
      if (Number.isFinite(dex) && dex <= MAX_DEX) dexSet.add(dex);
    }
  }

  const dexList = [...dexSet].sort((a, b) => a - b);
  console.log(`Resolving evolution chains for ${dexList.length} gen1-4 species...`);

  // Phase 1: species -> evolution_chain id (dedup: many species share one chain),
  // plus is_baby (free on the same response -- no extra requests).
  const chainIds = new Set();
  const babyDex = new Set();
  const failedSpecies = [];
  {
    let cursor = 0;
    async function worker() {
      while (cursor < dexList.length) {
        const dex = dexList[cursor++];
        try {
          const species = await fetchJson(`https://pokeapi.co/api/v2/pokemon-species/${dex}/`);
          const chainId = idFromUrl(species.evolution_chain && species.evolution_chain.url);
          if (Number.isFinite(chainId)) chainIds.add(chainId);
          else failedSpecies.push(dex);
          if (species.is_baby) babyDex.add(dex);
        } catch (err) {
          failedSpecies.push(dex);
          console.error(`species ${dex}: ${err.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  if (failedSpecies.length) {
    console.error(`Failed to resolve ${failedSpecies.length} species: ${failedSpecies.sort((a, b) => a - b).join(", ")}`);
    process.exit(1);
  }

  console.log(`Fetching ${chainIds.size} unique evolution chains...`);

  // Phase 2: fetch each unique chain once, walk it into edges
  const results = {};
  const failedChains = [];
  {
    const chainList = [...chainIds];
    let cursor = 0;
    async function worker() {
      while (cursor < chainList.length) {
        const id = chainList[cursor++];
        try {
          const chain = await fetchJson(`https://pokeapi.co/api/v2/evolution-chain/${id}/`);
          walkChain(chain.chain, dexSet, results);
        } catch (err) {
          failedChains.push(id);
          console.error(`chain ${id}: ${err.message}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }

  if (failedChains.length) {
    console.error(`Failed to fetch ${failedChains.length} chains: ${failedChains.sort((a, b) => a - b).join(", ")}`);
    process.exit(1);
  }

  // Build-time sanity check: every target dex must exist in our own pack
  // index, or content.js would have nothing to load when it tries to evolve.
  const knownDex = dexSet;
  let droppedTargets = 0;
  for (const key of Object.keys(results)) {
    const before = results[key].to.length;
    results[key].to = results[key].to.filter((t) => knownDex.has(parseInt(t.dex, 10)));
    droppedTargets += before - results[key].to.length;
    if (!results[key].to.length) delete results[key];
  }
  if (droppedTargets) console.log(`Dropped ${droppedTargets} target(s) missing from index.json.`);

  // Flag baby source entries (see the file-header comment) -- baby first in
  // insertion order purely for readability of the emitted JSON.
  let babyEntries = 0;
  for (const dex of babyDex) {
    const key = pad3(dex);
    if (results[key]) {
      results[key] = { baby: true, to: results[key].to };
      babyEntries++;
    }
  }

  // Manual serialization with numerically-sorted keys: JSON.stringify on a
  // plain object hoists integer-like keys ("100") ahead of leading-zero keys
  // ("001"), same pitfall documented in build-ko-names.cjs.
  const keys = Object.keys(results).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(results[k])}`).join(",\n");
  fs.writeFileSync(OUT_FILE, `{\n${body}\n}\n`);

  const totalEdges = keys.reduce((sum, k) => sum + results[k].to.length, 0);
  const branchCount = keys.filter((k) => results[k].to.length > 1).length;
  console.log(`Wrote ${OUT_FILE}: ${keys.length} species with evolutions, ${totalEdges} edges, ${branchCount} branching, ${babyEntries} baby sources.`);
}

main();
