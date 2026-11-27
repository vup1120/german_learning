// DW "Kurz und leicht" review games: generated from one episode, stable per day, always answerable.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DW = require('../site/dw_games.js');
const episode = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/dw_kurz/episode_2026-11-26.json'), 'utf8'));

test('Glossar terms are found in inflected transcript words', () => {
  assert.deepEqual(DW.termStems('etwas verlängern'), ['verlänger']);
  assert.deepEqual(DW.termStems('die Gewerkschaft, -en'), ['Gewerkschaft']);
  assert.deepEqual(DW.termStems('aus|fallen'), ['ausfall', 'fall']);
  assert.equal(DW.findTerm('etwas verlängern', 'Die Waffenruhe wird um zwei Wochen verlängert.'), 6);
  assert.equal(DW.findTerm('aus|fallen', 'Viele Züge fallen aus.'), 2);
  assert.equal(DW.findTerm('die Gewerkschaft', 'Die Gewerkschaften streiken.'), 1);
  assert.equal(DW.findTerm('gesperrt', 'Alles ist offen.'), -1);
  const links = DW.linkGlossary(episode);
  assert.equal(Object.keys(links.byGloss).length, episode.glossary.length);
  assert.deepEqual(links.byGloss.g1, { sid: 's1', word: 1 });
});

test('games are the same all day for one episode and differ for a new seed', () => {
  const a = DW.buildGames(episode, episode.id);
  const b = DW.buildGames(episode, episode.id);
  assert.deepEqual(a, b);
  assert.deepEqual(DW.availableGames(a), ['match', 'cloze', 'puzzle', 'truefalse']);
  assert.equal(DW.gamesNeeded(DW.availableGames(a)), 3);
  const c = DW.buildGames(episode, `${episode.id}:again`);
  assert.notDeepEqual(a, c);
});

test('matching rounds pair every term with exactly one definition', () => {
  const rounds = DW.buildMatch(episode, DW.rng(1));
  const ids = rounds.flatMap((r) => r.pairs.map((p) => p.id)).sort();
  assert.deepEqual(ids, episode.glossary.map((g) => g.id).sort());
  for (const round of rounds) {
    assert.ok(round.pairs.length >= 2 && round.pairs.length <= 6);
    assert.deepEqual([...round.defs].sort(), round.pairs.map((p) => p.id).sort());
  }
  assert.equal(rounds[0].pairs.find((p) => p.id === 'g5').say, 'ausfallen');
});

test('every cloze item rebuilds its sentence and offers the answer once', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const items = DW.buildCloze(episode, DW.rng(seed));
    assert.ok(items.length >= 4, `seed ${seed}`);
    const sentences = new Map(DW.sentences(episode).map((s) => [s.id, s.de]));
    for (const it of items) {
      assert.equal(it.before + it.answer + it.after, sentences.get(it.sid));
      const correct = it.options.filter((o) => o.toLowerCase() === it.answer.toLowerCase());
      assert.equal(correct.length, 1, JSON.stringify(it));
      assert.ok(it.options.length >= 3);
      assert.ok(['glossar', 'nomen', 'artikel'].includes(it.kind));
    }
    assert.ok(items.some((it) => it.kind === 'glossar'));
  }
});

test('articles become cloze blanks when nothing else is left', () => {
  const ep = { id: 'x', glossary: [], stories: [{ heading: '', sentences: [
    { id: 's1', de: 'Heute kommt der Bus sehr spät.' },
    { id: 's2', de: 'Morgen fährt die Bahn wieder normal.' },
  ] }] };
  const items = DW.buildCloze(ep, DW.rng(3));
  assert.ok(items.length >= 1);
  const art = items.find((it) => it.kind === 'artikel') || items[0];
  if (art.kind === 'artikel') {
    assert.ok(DW.ARTICLES.includes(art.answer));
    assert.ok(art.options.includes(art.answer));
  }
});

test('sentence puzzles are shuffled and solvable', () => {
  const items = DW.buildPuzzle(episode, DW.rng(7));
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.deepEqual([...it.shuffled].sort(), [...it.words].sort());
    assert.notEqual(it.shuffled.join(' '), it.words.join(' '));
    assert.ok(DW.puzzleSolved(it, it.words));
    assert.ok(!DW.puzzleSolved(it, it.shuffled));
  }
});

test('true/false items: true ones are original, false ones are really changed', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const items = DW.buildTrueFalse(episode, DW.rng(seed));
    assert.ok(items.length >= 3, `seed ${seed}`);
    assert.ok(items.some((it) => !it.truth));
    for (const it of items) {
      if (it.truth) assert.equal(it.statement, it.original);
      else { assert.notEqual(it.statement, it.original); assert.ok(it.why); }
      assert.ok(!/Kurz und leicht/.test(it.statement));
    }
  }
});

test('an episode without transcript or Glossar yields no games and no errors', () => {
  const games = DW.buildGames({ id: 'empty', stories: [], glossary: [] });
  assert.deepEqual(DW.availableGames(games), []);
  assert.equal(DW.gamesNeeded([]), 0);
});

test('typed answers ignore case, umlaut spelling and punctuation', () => {
  assert.ok(DW.checkTyped(' gewerkschaft ', 'Gewerkschaft'));
  assert.ok(DW.checkTyped('Strasse', 'Straße'));
  assert.ok(DW.checkTyped('verlaengert.', 'verlängert'));
  assert.ok(!DW.checkTyped('', 'verlängert'));
  assert.ok(!DW.checkTyped('verlängern', 'verlängert'));
});

test('Artikel index only learns from noun entries, then finds inflected nouns', () => {
  const index = DW.buildArtikelIndex(['die Gewerkschaft, -en', 'der Streik', 'Die Kinder spielen draußen.', 'das Gesetz']);
  assert.equal(DW.artikelFor('Gewerkschaften', index), 'die');
  assert.equal(DW.artikelFor('Streiks', index), 'der');
  assert.equal(DW.artikelFor('Kinder', index), '');
  assert.equal(DW.artikelFor('gesetz', index), '');
});

test('daily streak counts back from today, or from yesterday while today is open', () => {
  assert.equal(DW.streak({ '2026-11-25': 'a', '2026-11-26': 'b' }, '2026-11-26'), 2);
  assert.equal(DW.streak({ '2026-11-25': 'a', '2026-11-26': 'b' }, '2026-11-27'), 2);
  assert.equal(DW.streak({ '2026-11-24': 'a' }, '2026-11-27'), 0);
  assert.equal(DW.streak({ '2026-02-28': 'a', '2026-03-01': 'b' }, '2026-03-01'), 2);
});

test('tokenize keeps every character so the transcript renders unchanged', () => {
  const text = 'Viele Züge fallen aus, z. B. zwischen München und Augsburg.';
  const tokens = DW.tokenize(text);
  assert.equal(tokens.map((t) => t.t).join(''), text);
  assert.equal(tokens.filter((t) => t.w).length, DW.words(text).length);
});

test('audio lookup keys agree with tools/build_dw_audio.py', () => {
  const source = fs.readFileSync(path.join(__dirname, '../site/speech.js'), 'utf8');
  const window = { setTimeout() {} };
  vm.runInNewContext(source, { window, document: { addEventListener() {}, getElementById() { return null; } },
    navigator: {}, localStorage: { getItem: () => null, setItem() {} }, URL, Blob, console });
  // Same literal as tests/test_fetch_dw_kurz.py::AudioKeyTest.
  assert.equal(window.DQAudio.chop('Der FC Bayern hat 2:1 gewonnen.').join(' '), 'Der FC Bayern hat 2: 1 gewonnen.');
});
