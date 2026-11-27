/* Deutsch-Quest · DW "Kurz und leicht" helpers.
 * Pure functions that turn one day's episode (transcript + Glossar) into review games.
 * No DOM access here: app.js renders the results, tests/test_dw_games.js checks them in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DQDW = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- randomness that stays the same all day for one episode ----------
  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const uniq = (list) => [...new Set(list)];

  // ---------- text ----------
  const WORD_RE = /[A-Za-zÄÖÜäöüßÀ-ÿ0-9]+(?:[-’'][A-Za-zÄÖÜäöüßÀ-ÿ0-9]+)*/g;
  const ARTICLES = ['der', 'die', 'das', 'den', 'dem', 'des'];
  const BOILERPLATE = /^(kurz und leicht|video-?nachrichten|das waren|das war'?s|bis morgen|tschüss|danke fürs|willkommen)/i;
  const STOP_NOUNS = new Set(['Kurz', 'Video', 'Nachrichten', 'Videonachrichten', 'Deutsch', 'Deutschlernen', 'Ende']);
  const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

  /** Split a sentence into word and gap tokens: [{t, w: true|false, i}] (i = index among words). */
  function tokenize(text) {
    const out = [];
    let last = 0;
    let n = 0;
    String(text).replace(WORD_RE, (m, offset) => {
      if (offset > last) out.push({ t: text.slice(last, offset), w: false });
      out.push({ t: m, w: true, i: n++ });
      last = offset + m.length;
      return m;
    });
    if (last < text.length) out.push({ t: text.slice(last), w: false });
    return out;
  }
  const words = (text) => String(text).match(WORD_RE) || [];

  function foldGerman(text) {
    return String(text || '').trim().toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[„“"'.,!?;:]/g, '').replace(/\s+/g, ' ');
  }
  /** Typed answers: case, umlaut spelling (ae/oe/ue/ss) and stray punctuation do not matter. */
  function checkTyped(input, answer) {
    return !!foldGerman(input) && foldGerman(input) === foldGerman(answer);
  }

  /** Every sentence of the episode, in order: [{id, de, story}]. */
  function sentences(ep) {
    const list = [];
    (ep && ep.stories || []).forEach((story, s) => {
      (story.sentences || []).forEach((x) => list.push({ id: x.id, de: x.de, story: s }));
    });
    return list;
  }
  const isBoilerplate = (de) => BOILERPLATE.test(String(de).trim());
  const contentSentences = (ep) => sentences(ep).filter((s) => !isBoilerplate(s.de) && words(s.de).length >= 4);

  // ---------- Glossar terms inside the transcript ----------
  const PLACEHOLDERS = new Set(['etwas', 'jemanden', 'jemandem', 'jemand', 'jemandes', 'sich', 'etw', 'jmdn', 'jmdm',
    'jdn', 'jdm', 'hier', 'zu', 'mit', 'für', 'an', 'auf', 'von', 'in', 'um', 'über']);
  /** Stems used to find a Glossar term in inflected text: "etwas verlängern" -> ["verlänger"]. */
  function termStems(term) {
    let base = String(term || '').split(',')[0].replace(/\([^)]*\)/g, ' ');
    const parts = base.split(/\s+/).map((w) => w.replace(/[.;:]/g, '')).filter(Boolean)
      .filter((w) => !ARTICLES.includes(w.toLowerCase()) && !['ein', 'eine'].includes(w.toLowerCase()))
      .filter((w) => !PLACEHOLDERS.has(w.toLowerCase()));
    const stems = [];
    for (const raw of parts) {
      const pieces = raw.split('|');
      const joined = pieces.join('');
      const options = pieces.length > 1 ? [joined, pieces[pieces.length - 1]] : [joined];
      for (const word of options) {
        let stem = word;
        if (/^[a-zäöüß]/.test(word) && /(?:ern|eln)$/.test(word)) stem = word.slice(0, -1);
        else if (/^[a-zäöüß]/.test(word) && /en$/.test(word) && word.length > 5) stem = word.slice(0, -2);
        else if (/^[a-zäöüß]/.test(word) && /n$/.test(word) && word.length > 5) stem = word.slice(0, -1);
        if (stem.length >= 4) stems.push(stem);
      }
    }
    return uniq(stems).sort((a, b) => b.length - a.length);
  }
  function tokenMatchesStem(token, stem) {
    const t = token.toLowerCase();
    const s = stem.toLowerCase();
    return t.startsWith(s) && t.length - s.length <= 4;
  }
  /** Index (among words) of the first token in `de` that matches the Glossar term, or -1. */
  function findTerm(term, de) {
    const stems = termStems(term);
    const ws = words(de);
    for (const stem of stems) {
      const k = ws.findIndex((w) => tokenMatchesStem(w, stem));
      if (k >= 0) return k;
    }
    return -1;
  }
  /**
   * Link Glossar entries to the transcript.
   * Returns {byGloss: {gid: {sid, word}}, bySentence: {sid: {wordIndex: gid}}}.
   */
  function linkGlossary(ep) {
    const byGloss = {};
    const bySentence = {};
    const all = sentences(ep);
    for (const g of (ep && ep.glossary) || []) {
      const pool = g.story === null || g.story === undefined ? all
        : all.filter((s) => s.story === g.story).concat(all.filter((s) => s.story !== g.story));
      for (const s of pool) {
        const k = findTerm(g.term, s.de);
        if (k < 0) continue;
        if (!byGloss[g.id]) byGloss[g.id] = { sid: s.id, word: k };
        bySentence[s.id] = bySentence[s.id] || {};
        if (bySentence[s.id][k] === undefined) bySentence[s.id][k] = g.id;
      }
    }
    return { byGloss, bySentence };
  }

  // ---------- Artikel lookup for nouns in the transcript ----------
  /** Map lowercase noun -> article, from entries like "der Bahnhof" or "die Gewerkschaft, -en". */
  function buildArtikelIndex(entries) {
    const index = {};
    for (const raw of entries || []) {
      const m = String(raw || '').trim().match(/^(der|die|das)\s+([A-ZÄÖÜ][A-Za-zäöüß-]+)(?:\s*,.*)?$/);
      if (m && !index[m[2].toLowerCase()]) index[m[2].toLowerCase()] = m[1];
    }
    return index;
  }
  /** Article for a (possibly inflected) noun from the transcript, or ''. */
  function artikelFor(word, index) {
    if (!word || !/^[A-ZÄÖÜ]/.test(word)) return '';
    const w = word.toLowerCase();
    if (index[w]) return index[w];
    for (const end of ['en', 'n', 'e', 'er', 's', 'es']) {
      if (w.endsWith(end) && index[w.slice(0, -end.length)]) return index[w.slice(0, -end.length)];
    }
    return '';
  }

  // ---------- game 1: Glossar matching ----------
  /** Rounds of up to `size` term/definition pairs: [{pairs: [{id, term, say, definition}], defs: [id…]}]. */
  function buildMatch(ep, rand, size = 5, maxRounds = 2) {
    const gloss = ((ep && ep.glossary) || []).filter((g) => g.term && g.definition);
    if (gloss.length < 2) return [];
    const picked = shuffle(gloss, rand).slice(0, size * maxRounds);
    const rounds = [];
    for (let i = 0; i < picked.length; i += size) {
      let chunk = picked.slice(i, i + size);
      if (chunk.length < 2 && rounds.length) { rounds[rounds.length - 1].pairs.push(...chunk); continue; }
      chunk = chunk.map((g) => ({ id: g.id, term: g.term, say: g.say || g.term, definition: g.definition }));
      rounds.push({ pairs: chunk, defs: [] });
    }
    rounds.forEach((r) => { r.defs = shuffle(r.pairs.map((p) => p.id), rand); });
    return rounds;
  }

  // ---------- game 2: Lückentext ----------
  function isKeyNoun(word, index) {
    return index > 0 && /^[A-ZÄÖÜ][a-zäöüß]/.test(word) && word.length >= 5 && !STOP_NOUNS.has(word);
  }
  function blankSentence(de, wordIndex) {
    const toks = tokenize(de);
    const at = toks.findIndex((t) => t.w && t.i === wordIndex);
    return {
      before: toks.slice(0, at).map((t) => t.t).join(''),
      answer: toks[at].t,
      after: toks.slice(at + 1).map((t) => t.t).join(''),
    };
  }
  /**
   * Cloze items: [{sid, before, answer, after, options, kind: 'glossar'|'nomen'|'artikel', hint}].
   * Glossar words first, then key nouns, then articles, one blank per sentence.
   */
  function buildCloze(ep, rand, count = 6) {
    const links = linkGlossary(ep);
    const gloss = {};
    ((ep && ep.glossary) || []).forEach((g) => { gloss[g.id] = g; });
    const pool = shuffle(contentSentences(ep), rand);
    const used = new Set();
    const items = [];
    const nounPool = uniq(contentSentences(ep).flatMap((s) => words(s.de).filter((w, i) => isKeyNoun(w, i))));
    const glossSurface = [];
    for (const s of contentSentences(ep)) {
      const marks = links.bySentence[s.id] || {};
      for (const k of Object.keys(marks)) glossSurface.push(words(s.de)[k]);
    }
    const distractors = (answer, candidates) => {
      const sameCase = (w) => /^[A-ZÄÖÜ]/.test(w) === /^[A-ZÄÖÜ]/.test(answer);
      const others = uniq(candidates.filter((w) => w && w.toLowerCase() !== answer.toLowerCase()));
      const preferred = shuffle(others.filter(sameCase), rand);
      const rest = shuffle(others.filter((w) => !sameCase(w)), rand);
      return preferred.concat(rest).slice(0, 3);
    };
    const add = (s, k, kind, hint, candidates) => {
      const blank = blankSentence(s.de, k);
      const wrong = kind === 'artikel'
        ? shuffle(ARTICLES.filter((a) => a !== blank.answer.toLowerCase()), rand).slice(0, 3)
        : distractors(blank.answer, candidates);
      if (wrong.length < 2) return false;
      const answerText = kind === 'artikel' ? blank.answer.toLowerCase() : blank.answer;
      items.push({ sid: s.id, before: blank.before, answer: blank.answer, after: blank.after, kind, hint,
        options: shuffle([answerText, ...wrong], rand) });
      used.add(s.id);
      return true;
    };
    for (const s of pool) {
      if (items.length >= count) break;
      const marks = links.bySentence[s.id];
      if (!marks) continue;
      const k = Number(Object.keys(marks)[0]);
      const g = gloss[marks[k]];
      add(s, k, 'glossar', g ? g.definition : '', glossSurface.concat(nounPool));
    }
    for (const s of pool) {
      if (items.length >= count) break;
      if (used.has(s.id)) continue;
      const ws = words(s.de);
      const k = ws.findIndex((w, i) => isKeyNoun(w, i));
      if (k >= 0) add(s, k, 'nomen', '', nounPool.concat(glossSurface));
    }
    for (const s of pool) {
      if (items.length >= count) break;
      if (used.has(s.id)) continue;
      const ws = words(s.de);
      const k = ws.findIndex((w, i) => i > 0 && ARTICLES.includes(w));
      if (k >= 0) add(s, k, 'artikel', 'der / die / das / den / dem / des', []);
    }
    const order = new Map(sentences(ep).map((s, i) => [s.id, i]));
    return items.sort((a, b) => order.get(a.sid) - order.get(b.sid));
  }

  // ---------- game 3: Satz-Puzzle ----------
  /** [{sid, words: [...correct order], shuffled: [...]}] for medium-length sentences. */
  function buildPuzzle(ep, rand, count = 3) {
    const pool = shuffle(contentSentences(ep).filter((s) => {
      const n = s.de.split(/\s+/).length;
      return n >= 5 && n <= 13;
    }), rand).slice(0, count);
    return pool.map((s) => {
      const parts = s.de.trim().split(/\s+/);
      let mixed = shuffle(parts, rand);
      for (let tries = 0; tries < 5 && mixed.join(' ') === parts.join(' '); tries++) mixed = shuffle(parts, rand);
      return { sid: s.id, words: parts, shuffled: mixed };
    });
  }
  const puzzleSolved = (item, picked) => picked.join(' ') === item.words.join(' ');

  // ---------- game 4: Richtig oder falsch? ----------
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
    'November', 'Dezember'];
  // Words that typically stand right before a name or place: "zwischen München und Augsburg", "mit Macron".
  const BEFORE_NAME = new Set(['in', 'nach', 'aus', 'zwischen', 'und', 'oder', 'von', 'mit', 'gegen', 'bei', 'für',
    'an', 'über', 'wie', 'als', 'sagte', 'sagt', 'besucht', 'besuchte', 'trifft', 'traf', 'präsident', 'kanzler']);
  /** Capitalised word right after a preposition/conjunction: probably a name or place, safe to swap. */
  function isNameLike(list, i) {
    const w = list[i];
    if (i === 0 || !/^[A-ZÄÖÜ][a-zäöüß]{3,}$/.test(w) || STOP_NOUNS.has(w) || WEEKDAYS.includes(w) || MONTHS.includes(w)) return false;
    return BEFORE_NAME.has(list[i - 1].toLowerCase());
  }
  function falseVersion(s, all, rand, ep) {
    // 1) a different number
    const num = s.de.match(/(?<![\d,.])\d+(?:,\d+)?(?![\d,.])/);
    if (num) {
      const value = parseFloat(num[0].replace(',', '.'));
      if (Number.isFinite(value) && value > 0) {
        const choices = uniq([value * 2, value + 10, Math.max(1, Math.round(value / 2)), value + 3])
          .filter((v) => v !== value && v > 0).map((v) => String(Number.isInteger(v) ? v : v.toFixed(1)).replace('.', ','));
        const swap = choices[Math.floor(rand() * choices.length)];
        if (swap) return { text: s.de.replace(num[0], swap), why: `數字不對：${num[0]} → ${swap}` };
      }
    }
    // 2) another weekday
    const day = WEEKDAYS.find((d) => new RegExp(`\\b${d}\\b`).test(s.de));
    if (day) {
      const other = shuffle(WEEKDAYS.filter((d) => d !== day), rand)[0];
      return { text: s.de.replace(new RegExp(`\\b${day}\\b`), other), why: `日期不對：${day} → ${other}` };
    }
    // 3) a Glossar noun swapped for another Glossar noun with the same article (stays grammatical)
    const gnouns = (ep && ep.glossary || []).map((g) => String(g.term).split(',')[0].trim()
      .match(/^(der|die|das)\s+([A-ZÄÖÜ][a-zäöüß-]+)$/)).filter(Boolean);
    const mine = words(s.de);
    for (const [, art, noun] of shuffle(gnouns, rand)) {
      if (!mine.includes(noun)) continue;
      const other = shuffle(gnouns.filter((m) => m[1] === art && m[2] !== noun && !mine.includes(m[2])), rand)[0];
      if (other) return { text: s.de.replace(new RegExp(`\\b${noun}\\b`), other[2]), why: `換了一個詞：${noun} → ${other[2]}` };
    }
    // 4) another place ("in Bayern" -> "in Hamburg")
    const PLACE = /\b(?:[Ii]n|[Nn]ach|[Aa]us)\s+([A-ZÄÖÜ][a-zäöüß]{2,})\b/g;
    const places = (text) => [...String(text).matchAll(PLACE)].map((m) => m[1]).filter((w) => !STOP_NOUNS.has(w));
    const here = places(s.de);
    const there = uniq(all.filter((x) => x.story !== s.story).flatMap((x) => places(x.de))).filter((w) => !here.includes(w));
    if (here.length && there.length) {
      const from = here[0];
      const to = shuffle(there, rand)[0];
      return { text: s.de.replace(new RegExp(`\\b${from}\\b`), to), why: `地點不對：${from} → ${to}` };
    }
    // 5) last resort: a name-like word (no article before it) from another news item
    const names = (list) => list.filter((w, i) => isNameLike(list, i));
    const fromNames = names(mine);
    const elsewhere = uniq(all.filter((x) => x.story !== s.story).flatMap((x) => names(words(x.de))))
      .filter((w) => !mine.includes(w));
    if (fromNames.length && elsewhere.length) {
      const from = shuffle(fromNames, rand)[0];
      const to = shuffle(elsewhere, rand)[0];
      return { text: s.de.replace(new RegExp(`\\b${from}\\b`), to), why: `換了一個詞：${from} → ${to}` };
    }
    return null;
  }
  /** [{sid, statement, truth, original, why}] about half true, half altered. Empty if nothing can be altered. */
  function buildTrueFalse(ep, rand, count = 4) {
    const all = contentSentences(ep);
    if (all.length < 3) return [];
    const wantFalse = Math.ceil(count / 2);
    const falses = [];
    const trues = [];
    for (const s of shuffle(all, rand)) {
      if (falses.length + trues.length >= count) break;
      if (falses.length < wantFalse) {
        const alt = falseVersion(s, all, rand, ep);
        if (alt && alt.text !== s.de) {
          falses.push({ sid: s.id, statement: alt.text, truth: false, original: s.de, why: alt.why });
          continue;
        }
      }
      if (trues.length < count - wantFalse) trues.push({ sid: s.id, statement: s.de, truth: true, original: s.de, why: '' });
    }
    return falses.length ? shuffle(trues.concat(falses), rand) : [];
  }

  // ---------- which games, and progress ----------
  const GAME_IDS = ['match', 'cloze', 'puzzle', 'truefalse'];
  function buildGames(ep, seedText) {
    const seed = hashSeed(seedText || (ep && ep.id) || '');
    return {
      match: buildMatch(ep, rng(seed + 1)),
      cloze: buildCloze(ep, rng(seed + 2)),
      puzzle: buildPuzzle(ep, rng(seed + 3)),
      truefalse: buildTrueFalse(ep, rng(seed + 4)),
    };
  }
  const availableGames = (games) => GAME_IDS.filter((id) => games[id] && games[id].length);
  /** Games needed for the daily "Spiele" check: three, or all of them if fewer exist. */
  const gamesNeeded = (available) => Math.min(3, available.length);

  function prevDay(key) {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  /** Consecutive days with a completed episode, counting back from today (or from yesterday if today is open). */
  function streak(doneDays, today) {
    let day = doneDays[today] ? today : prevDay(today);
    let n = 0;
    while (doneDays[day]) { n++; day = prevDay(day); }
    return n;
  }

  return {
    hashSeed, rng, shuffle, tokenize, words, foldGerman, checkTyped, sentences, isBoilerplate,
    termStems, findTerm, linkGlossary, buildArtikelIndex, artikelFor,
    buildMatch, buildCloze, buildPuzzle, puzzleSolved, buildTrueFalse, buildGames, availableGames,
    gamesNeeded, streak, prevDay, GAME_IDS, ARTICLES,
  };
});
