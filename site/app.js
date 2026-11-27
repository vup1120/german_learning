/* Deutsch-Quest: a phone-first German practice site.
 * Plain JavaScript, no build step. Progress is kept in this browser only. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const view = document.getElementById('view');
  const tabbar = document.getElementById('tabbar');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
  const dayNumber = () => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); };

  function rng(seed) { // small seeded generator so "today's questions" stay the same all day
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand = Math.random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    school: '<path d="M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-3a3 3 0 0 0-3 3"/><path d="M20 5v13h-6"/>',
    people: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 14.5c3.5-.8 7 1.5 7 5.5"/>',
    shield: '<path d="M12 3l8 3v6c0 4.500-3.200 7.800-8 9-4.800-1.200-8-4.500-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    cup: '<path d="M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10h2a2.500 2.500 0 0 1 0 5h-2"/><path d="M8 3v3"/><path d="M12 3v3"/>',
    news: '<rect x="3" y="5" width="14" height="15" rx="2"/><path d="M17 9h4v9a2 2 0 0 1-2 2H7"/><path d="M7 9h6"/><path d="M7 13h6"/><path d="M7 17h4"/>',
    scale: '<path d="M12 4v16"/><path d="M6 20h12"/><path d="M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0z"/><path d="M19 7l-3 7a3 3 0 0 0 6 0z"/>',
    car: '<path d="M4 13l2-6h12l2 6"/><rect x="3" y="13" width="18" height="5" rx="2"/><circle cx="7.500" cy="18" r="1.500"/><circle cx="16.500" cy="18" r="1.500"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    sound: '<path d="M4 10v4h4l5 4V6l-5 4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.500 6.500a8 8 0 0 1 0 11"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    map: '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="M5 5l2 2"/><path d="M17 17l2 2"/><path d="M5 19l2-2"/><path d="M17 7l2-2"/>',
    cards: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v11"/>',
    play: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>',
  };
  const icon = (name, size = 24) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

  // ---------- saved progress ----------
  const STORE_KEY = 'deutschquest.v1';
  const INTERVALS = [0, 1, 3, 7, 14, 30]; // days until a card comes back, by box
  const STEPS = ['review', 'news', 'scene', 'speak'];
  function load() {
    const blank = { xp: 0, streak: 0, lastDay: '', days: {}, cards: {}, watched: {}, best: {},
      dw: {}, dwDays: {}, dwArtikel: false }; // dw: per-episode progress, dwDays: day -> episode completed
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? Object.assign(blank, JSON.parse(raw)) : blank;
    } catch (err) { return blank; }
  }
  let S = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (err) { /* storage unavailable: keep going in memory */ } }
  function touchDay() {
    const t = dayKey();
    if (S.lastDay === t) return;
    S.streak = S.lastDay === addDays(-1) ? S.streak + 1 : 1;
    S.lastDay = t;
  }
  function addXp(n) { touchDay(); S.xp += n; save(); }
  function todayState() { const t = dayKey(); if (!S.days[t]) S.days[t] = {}; return S.days[t]; }
  function markStep(step) {
    const d = todayState();
    if (d[step]) return;
    d[step] = true;
    addXp(10);
    if (STEPS.every((s) => d[s]) && !d.bonus) { d.bonus = true; addXp(20); }
    save();
  }
  function addCard(de, zh, src, examples) {
    if (!de) return;
    if (S.cards[de]) {
      // Existing spaced-repetition progress is preserved.
      if (examples && !S.cards[de].examples) {
        S.cards[de].examples = examples;
        save();
      }
      return;
    }
    S.cards[de] = { zh: zh || '', src: src || '', box: 0, due: dayKey(),
      examples: examples || usageExamples(de, zh, '', null) };
    save();
  }
  const dueCards = () => Object.keys(S.cards).filter((de) => S.cards[de].due <= dayKey());

  // ---------- speech ----------
  function say(text) {
    // The old implementation swallowed failures. The audio layer now reports
    // audible playback status, missing voices and browser errors.
    return window.DQAudio ? window.DQAudio.play(text) : false;
  }

  // ---------- data ----------
  const DATA = { movies: { movies: [] }, life: [], test: { questions: [], vocab: [] }, drive: { groups: [] }, cards: { episodes: {} }, friends: { episodes: [], lessons: {}, dialogues: {}, subtitled: [] }, news: { groups: [], updated: '' }, dw: { episodes: [], latest: '' } };
  async function getJson(path, fallback) {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (err) { return fallback; }
  }
  async function loadData() {
    const [life, test, drive, cards, friends, movies, news, dw] = await Promise.all([
      getJson('content/life.json', DATA.life),
      getJson('content/einbuergerung.json', DATA.test),
      getJson('content/fahrpruefung.json', DATA.drive),
      getJson('content/friends_cards.json', DATA.cards),
      getJson('data/friends.json', DATA.friends),
      getJson('data/movies.json', DATA.movies),
      getJson('data/news.json', DATA.news),
      getJson('data/dw/index.json', DATA.dw),
    ]);
    Object.assign(DATA, { life, test, drive, cards, friends, movies, news, dw });
  }

  // ---------- per-render registry (keeps data out of HTML attributes) ----------
  let reg = [];
  const put = (value) => reg.push(value) - 1;
  let ui = {}; // state of the current screen; cleared when the route changes

  // ---------- shared pieces ----------
  function header(title, sub, backHref) {
    return `<div class="topbar">
      ${backHref ? `<a class="back" href="${backHref}" aria-label="返回">${icon('back', 20)}</a>` : ''}
      <div class="grow"><h1${/^[0-9 A-Za-zÀ-ÿ.,!?:;’'()&\-·]+$/.test(title) && /[A-Za-zÀ-ÿ]/.test(title) ? ' lang="de"' : ''}>${esc(title)}</h1>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}</div>
    </div>`;
  }
  function usageExamples(de, zh, note, original) {
    // Prefer the curated, original example sentence in the lesson data.
    const provided = original && original.de ? original : null;
    const match = !provided ? String(note || '').match(/^(.+?)（(.+?)）/) : null;
    const fullSentence = /[.!?。！？]$/.test(String(de).trim()) || /\s/.test(de) && /[.!?]/.test(de);
    const base = provided ? provided.de : match ? match[1] :
      fullSentence ? de : 'Kannst du mir erklären, was „' + de + '“ bedeutet?';
    const baseZh = provided ? provided.zh || zh : match ? match[2] :
      fullSentence ? zh : '你能跟我解釋「' + de + '」是什麼意思嗎？';
    const fallback = !provided && !match && !fullSentence;
    return [
      { scene: fallback ? '用法詢問' : '原創例句', de: base, zh: baseZh },
      { scene: '朋友聊天 · 兩人對話',
        de: 'A: Wie war dein Tag? B: ' + base + ' A: Ach so! Erzähl mir mehr.',
        zh: 'A：你今天過得如何？B：' + baseZh + ' A：原來如此！再多跟我說一些。' },
      { scene: '日常交流 · 說明原因',
        de: 'A: Kannst du mir die Situation erklären? B: ' + base +
          ' A: Was bedeutet das für dich?',
        zh: 'A：你能解釋一下目前的情況嗎？B：' + baseZh + ' A：這對你而言有什麼意義？' },
    ];
  }
  const ARTIKEL = ['der', 'die', 'das'];
  function splitArtikel(de) {
    const s = String(de || '').trim();
    if (!s || /[.!?]/.test(s)) return null;
    for (const art of ARTIKEL) {
      if (s.startsWith(art + ' ')) {
        const rest = s.slice(art.length + 1).trim();
        if (rest) return { art, rest };
      }
    }
    return null;
  }
  const artikelBadge = (art) => `<span class="artikel-tag artikel-${art}">${art}</span>`;
  function renderDeWithArtikel(de) {
    const parsed = splitArtikel(de);
    return parsed ? `${artikelBadge(parsed.art)} ${esc(parsed.rest)}` : esc(de);
  }
  function artikelQuizButton(pairs, title, backHref) {
    const nouns = pairs.filter((p) => splitArtikel(p.de));
    if (!nouns.length) return '';
    const i = put({ title, nouns, backHref });
    return `<button class="btn ghost" data-act="artikel-quiz" data-i="${i}">練冠詞（der / die / das）· ${nouns.length} 題</button>`;
  }

  function phraseCard(de, zh, note, src, originalExample, opts = {}) {
    // opts.examples: ready-made example list; opts.meaningLang: language of `zh` (DW Glossar explains in German).
    const open = !!(ui.open && ui.open[de]);
    const examples = opts.examples || usageExamples(de, zh, note, originalExample);
    const n = ((ui.exampleCycle || {})[de] || 0) % examples.length;
    const selected = examples[n];
    const i = put({ de, zh, src, examples });
    return '<div class="card phrase"><div class="phrase-wrap">' +
      '<button class="phrase-main grow" data-act="reveal" data-i="' + i + '" aria-expanded="' + open + '">' +
        '<span class="grow"><span class="phrase-de" lang="de">' + renderDeWithArtikel(de) + '</span>' +
        (open ? '<div class="phrase-zh"' + (opts.meaningLang ? ' lang="' + opts.meaningLang + '"' : '') + '>' + esc(zh) + '</div>' +
          (note ? '<div class="phrase-note">' + esc(note) + '</div>' : '') :
          '<div class="phrase-hint">點一下看中文，並加入複習</div>') +
        '</span></button>' +
      '<div class="phrase-side"><button class="icon-btn" data-act="say" data-i="' + i +
        '" aria-label="播放德文發音" title="播放德文發音">' + icon('sound', 20) + '</button></div>' +
      '</div>' +
      (open ? '<div class="phrase-extra"><div class="row phrase-caption">' +
          '<strong>可切換的情境例句</strong><span class="tag">' + esc(selected.scene) + ' · ' + (n + 1) +
          ' / ' + examples.length + '</span></div>' +
          '<p class="phrase-example-de" lang="de">' + esc(selected.de) + '</p>' +
          '<p class="muted small">' + esc(selected.zh) + '</p>' +
          '<div class="phrase-tools">' +
            '<button class="btn ghost" data-act="example-say" data-i="' + i + '">' +
            icon('sound', 18) + ' 聽例句</button>' +
            '<button class="btn ghost" data-act="example-next" data-i="' + i + '">換一個情境</button>' +
            '<button class="btn" data-act="coach" data-i="' + i + '">分步對話練習</button>' +
          '</div></div>' : '') +
      '</div>';
  }
  function promptCard(title, hint, text) {
    const i = put({ text });
    const state = ui.copied === i ? ui.copyState : '';
    const label = state === 'ok' ? '已複製，到 ChatGPT 貼上' : state === 'fail' ? '無法自動複製，請長按上方文字' : '複製提示詞';
    return `<div class="card night">
      <h3>${esc(title)}</h3>
      <p class="muted small">${esc(hint)}</p>
      <div class="prompt" lang="de">${esc(text)}</div>
      <button class="btn warm" data-act="copy" data-i="${i}">${label}</button>
    </div>`;
  }
  const TEACHER = 'Sprich nur Deutsch, in natürlichem Tempo, und unterbrich mich nicht mitten im Satz. Mein Niveau ist B1. Korrigiere mich erst am Ende: Nenne mir dann einen Grammatikfehler, eine natürlichere Formulierung und einen Tipp zur Aussprache.';

  // ---------- quiz engine ----------
  function startQuiz(title, items, backHref, bestKey) {
    ui.quiz = { title, items, i: 0, picked: null, score: 0, backHref, bestKey, done: false };
    render();
    if (items[0] && items[0].say) say(items[0].say);
  }
  function quizView() {
    const q = ui.quiz;
    if (q.done) {
      return `${header(q.title, '完成', q.backHref)}
        <div class="card flash"><div class="flash-de">${q.score} / ${q.items.length}</div>
        <p class="muted">答對一題得 2 XP</p></div>
        <button class="btn" data-act="quiz-exit">回到上一頁</button>`;
    }
    const it = q.items[q.i];
    const answered = q.picked !== null;
    const opts = it.opts.map((o, k) => {
      let cls = 'opt';
      if (answered && o.ok) cls += ' good';
      else if (answered && q.picked === k) cls += ' bad';
      return `<button class="${cls}" data-act="quiz-pick" data-k="${k}" ${answered ? 'disabled' : ''} ${it.optLang ? `lang="${it.optLang}"` : ''} ${it.noAutoSpeech ? 'data-no-auto-speech' : ''}>${esc(o.t)}</button>`;
    }).join('');
    const right = answered && it.opts[q.picked].ok;
    return `${header(q.title, `第 ${q.i + 1} 題，共 ${q.items.length} 題`, q.backHref)}
      ${it.say ? `<button class="big-play" data-act="quiz-say" aria-label="再聽一次">${icon('sound', 40)}</button><p class="muted small" style="text-align:center">聽指令，選出意思。可以重複播放。</p>` : ''}
      ${it.q ? `<p class="quiz-q" ${it.qLang ? `lang="${it.qLang}"` : ''}>${esc(it.q)}</p>` : ''}
      ${it.sub ? `<p class="muted small">${esc(it.sub)}</p>` : ''}
      <div class="stack">${opts}</div>
      ${answered ? `<div class="card">
          <p class="verdict ${right ? 'good' : 'bad'}">${right ? '答對了' : '答錯了'}</p>
          ${it.reveal ? `<p lang="de"><strong>${esc(it.reveal)}</strong></p>` : ''}
          ${it.why ? `<p>${esc(it.why)}</p>` : ''}
        </div>
        <button class="btn" data-act="quiz-next">${q.i + 1 < q.items.length ? '下一題' : '看結果'}</button>` : ''}`;
  }

  // ---------- screens ----------
  const ZONE_ICONS = { nachbarschaft: 'home', schule: 'school', eltern: 'people', konflikt: 'shield' };
  const sceneRotation = () => {
    const list = ['#/zone/nachbarschaft', '#/test', '#/zone/schule', '#/fahren', '#/zone/eltern', '#/friends', '#/zone/konflikt'];
    return list[dayNumber() % list.length];
  };
  function nextEpisode() {
    return DATA.friends.episodes.find((e) => !S.watched[e.episode_id]) || DATA.friends.episodes[0];
  }
  const sceneLabels = () => {
    const map = { '#/test': 'Einbürgerungstest · 入籍考試', '#/fahren': 'Fahrprüfung · 路考德語', '#/friends': 'Friends · 下一集' };
    DATA.life.forEach((z) => { map[`#/zone/${z.id}`] = `${z.de} · ${z.zh}`; });
    return map;
  };

  function homeView() {
    const level = Math.floor(S.xp / 100) + 1;
    const inLevel = S.xp % 100;
    const today = sceneRotation();
    const zone = (href, iconName, name, sub, count, extra = '') => `<a class="zone ${today === href ? 'today' : ''} ${extra}" href="${href}">
        <span class="node">${icon(iconName, 26)}</span>
        <span class="grow"><span class="zone-name" lang="de">${esc(name)}</span><br><span class="muted small">${esc(sub)}${today === href ? ' · 今日主題' : ''}</span></span>
        <span class="count">${esc(count)}</span>
      </a>`;
    const life = DATA.life.map((z) => {
      const learned = z.phrases.filter((p) => S.cards[p[0]]).length;
      return zone(`#/zone/${z.id}`, ZONE_ICONS[z.id] || 'home', z.de, `${z.zh} · ${z.tagline}`, `${learned} / ${z.phrases.length}`);
    }).join('');
    const watched = DATA.friends.episodes.filter((e) => S.watched[e.episode_id]).length;
    const nx = nextEpisode();
    return `<div class="row"><div class="grow"><h1 lang="de">Deutsch-Quest</h1><p class="muted small">等級 ${level} · 共 ${S.xp} XP</p></div>
        <span class="pill">連續 ${S.streak} 天</span></div>
      <div class="xp"><div class="xp-track"><div class="xp-fill" style="width:${Math.max(4, inLevel)}%"></div></div><span class="muted small">${inLevel} / 100</span></div>
      <a class="btn" href="#/heute">開始今天的任務 · 約 15 分鐘</a>
      <h2>生活地圖</h2>
      <div class="stack">${life}</div>
      <h2>支線與考試</h2>
      <div class="stack">
        ${zone('#/dw', 'play', 'Kurz und leicht', `DW 每日 A2 影片新聞 · 逐字稿 · 複習遊戲${dwStreak() ? ` · 連續 ${dwStreak()} 天` : ''}`, dwHomeCount(), 'night')}
        ${zone('#/friends', 'cup', 'Central Perk', `Friends 追劇 · 完整教案 ${Object.keys(DATA.friends.lessons || {}).length} 集`, `${watched} / ${DATA.friends.episodes.length || 236}`, 'night')}
        ${zone('#/movies', 'cards', 'Filme · 電影學習', `電影字幕 · ${DATA.movies.movies.reduce((n, m) => n + m.chapters.length, 0)} 個場景教案`, `${DATA.movies.movies.length} 部電影`)}
        ${zone('#/news', 'news', 'Nachrichten', '德國與慕尼黑每日新聞', '每日更新')}
        ${zone('#/test', 'scale', 'Einbürgerungstest', '入籍考試 · 價值與憲政', S.best.test ? `最佳 ${S.best.test}` : `${DATA.test.questions.length} 題`)}
        ${zone('#/fahren', 'car', 'Fahrprüfung', '路考 · 聽懂考官指令', S.best.drive ? `最佳 ${S.best.drive}` : '聽力練習')}
      </div>`;
  }

  function dwHomeCount() {
    const latest = (DATA.dw.episodes || [])[0];
    if (!latest) return '每日更新';
    const st = S.dw[latest.id];
    if (st && st.done) return `${dwDayLabel(latest.id)} ✓`;
    return latest.id === dayKey() ? '今天新集數' : dwDayLabel(latest.id);
  }
  function heuteView() {
    const d = todayState();
    const scene = sceneRotation();
    const labels = sceneLabels();
    const due = dueCards().length;
    const steps = [
      ['review', '#/review', 'Wiederholen', due ? `複習 ${due} 張到期的卡片` : '今天沒有到期的卡片，進去確認即可'],
      ['news', '#/news', 'Nachrichten', '讀一則德國或慕尼黑新聞'],
      ['scene', scene, 'Neue Szene', `今日主題：${labels[scene] || ''}`],
      ['speak', scene, 'Sprechen', '在今日主題頁複製提示詞，到 ChatGPT 語音模式練 5 分鐘'],
    ];
    let foundNext = false;
    const html = steps.map(([key, href, de, zh], n) => {
      const done = !!d[key];
      const next = !done && !foundNext;
      if (next) foundNext = true;
      return `<a class="card step ${done ? 'done' : ''} ${next ? 'next' : ''}" href="${href}">
        <span class="step-n">${done ? icon('check', 20) : n + 1}</span>
        <span class="grow"><h3 lang="de">${de}</h3><span class="muted small">${esc(zh)}</span></span>
        ${done ? '<span class="tag good">完成</span>' : ''}
      </a>`;
    }).join('');
    const all = STEPS.every((s) => d[s]);
    const latest = (DATA.dw.episodes || [])[0];
    const dwDone = latest && S.dw[latest.id] && S.dw[latest.id].done;
    const dwCard = latest ? `<a class="card step ${dwDone ? 'done' : ''}" href="#/dw/${esc(latest.id)}">
        <span class="step-n">${dwDone ? icon('check', 20) : icon('play', 20)}</span>
        <span class="grow"><h3 lang="de">Kurz und leicht</h3><span class="muted small">DW ${esc(dwDayLabel(latest.id))}的影片新聞：看影片、讀逐字稿、玩複習遊戲（也算「新聞」這一步）${dwStreak() ? ` · 連續 ${dwStreak()} 天` : ''}</span></span>
        ${dwDone ? '<span class="tag good">完成</span>' : ''}</a>` : '';
    return `${header('Heute', '四步驟，約 15 分鐘，做完就結束')}
      <div class="stack">${html}</div>
      ${dwCard ? `<h2>每日影片新聞</h2><div class="stack">${dwCard}</div>` : ''}
      <div class="card night"><h3>${all ? '今天完成了' : '每步 10 XP，四步全完成再加 20 XP'}</h3>
      <p class="muted small">${all ? '明天見。地圖上的其他區域隨時可以再逛。' : '完成的步驟會打勾，進度只存在這支手機的瀏覽器裡。'}</p></div>`;
  }

  function zoneView(id) {
    const z = DATA.life.find((x) => x.id === id);
    if (!z) return notFound();
    const prompt = `Wir machen ein Rollenspiel. Du bist ${z.role_de}. Beginne das Gespräch und reagiere natürlich auf das, was ich sage.\n\nIch möchte diese Sätze üben. Schaffe Situationen, in denen ich sie benutzen kann:\n${z.phrases.map((p) => `- ${p[0]}`).join('\n')}\n\n${TEACHER}`;
    return `${header(z.de, `${z.zh} · ${z.tagline}`, '#/')}
      <button class="btn ghost" data-act="zone-quiz" data-id="${esc(z.id)}">聽力小測驗 · ${Math.min(5, z.phrases.length)} 題</button>
      <div class="stack">${z.phrases.map((p) => phraseCard(p[0], p[1], p[2], z.zh)).join('')}</div>
      ${promptCard('魔王關 · 角色扮演', '複製提示詞，貼進 ChatGPT 後切到語音模式。', prompt)}`;
  }
  function listenItems(pairs, count, rand = Math.random) {
    const chosen = shuffle(pairs, rand).slice(0, count);
    return chosen.map((p) => {
      const wrong = shuffle(pairs.filter((x) => x[1] !== p[1]), rand).slice(0, 3);
      return {
        say: p[0], reveal: p[0],
        opts: shuffle([{ t: p[1], ok: true }, ...wrong.map((w) => ({ t: w[1], ok: false }))], rand),
      };
    });
  }

  function newsView() {
    const groups = DATA.news.groups || [];
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const updated = DATA.news.updated ? new Date(DATA.news.updated).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const body = groups.map((g) => {
      const items = g.items.map((it) => {
        const s = put({ de: it.title });
        const prompt = `Ich habe heute diese Nachricht gelesen: „${it.title}“${it.teaser ? ` – ${it.teaser}` : ''} (Quelle: ${it.source}).\n\nErkläre mir die Nachricht zuerst kurz in einfachem Deutsch und nenne fünf wichtige Wörter daraus. Frage mich danach nach meiner Meinung und stelle zwei Nachfragen.\n\n${TEACHER}`;
        const p = put({ text: prompt });
        const when = it.published ? new Date(it.published).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) : '';
        const copied = ui.copied === p;
        return `<div class="card">
          <div class="row"><span class="tag">${esc(it.source)}</span><span class="muted small">${esc(when)}</span></div>
          <p class="news-title" lang="de">${esc(it.title)}</p>
          ${it.teaser ? `<p class="muted" lang="de">${esc(it.teaser)}</p>` : ''}
          <div class="row">
            <button class="icon-btn" data-act="say" data-i="${s}" aria-label="播放標題發音">${icon('sound', 20)}</button>
            <a class="btn ghost grow" href="${esc(it.url)}" target="_blank" rel="noopener" data-act="news-open">閱讀原文</a>
            <button class="btn warm grow" data-act="copy" data-i="${p}">${copied ? (ui.copyState === 'ok' ? '已複製' : '請手動複製') : '和 ChatGPT 聊'}</button>
          </div>
        </div>`;
      }).join('');
      const empty = `<div class="card"><p class="muted">今天還沒有抓到這一區的新聞。</p>${g.fallback_url ? `<a class="btn ghost" href="${esc(g.fallback_url)}" target="_blank" rel="noopener" data-act="news-open">直接開啟新聞網站</a>` : ''}</div>`;
      return `<h2>${esc(g.zh)}</h2><div class="stack">${items || empty}</div>`;
    }).join('');
    const none = `<div class="card"><p>新聞每天清晨由 GitHub 自動更新。現在還沒有資料，網站部署後第一次更新就會出現。</p>
      <a class="btn ghost" href="https://www.tagesschau.de/" target="_blank" rel="noopener" data-act="news-open">tagesschau</a>
      <a class="btn ghost" href="https://www.nachrichtenleicht.de/" target="_blank" rel="noopener" data-act="news-open">nachrichtenleicht（簡易德語）</a></div>`;
    const dwLatest = (DATA.dw.episodes || [])[0];
    const dwLink = dwLatest ? `<a class="card step" href="#/dw/${esc(dwLatest.id)}"><span class="step-n">${icon('play', 20)}</span>
        <span class="grow"><h3 lang="de">Kurz und leicht</h3><span class="muted small">DW ${esc(dwDayLabel(dwLatest.id))}的 A2 影片新聞，附逐字稿和複習遊戲</span></span>${icon('next', 18)}</a>` : '';
    return `${header('Nachrichten', updated ? `更新於 ${updated} · 共 ${total} 則` : '德國與慕尼黑每日新聞')}
      ${dwLink}
      <p class="muted small">這裡只顯示標題和摘要，全文請到原網站閱讀。「和 ChatGPT 聊」會複製一段提示詞，讓它用簡單德語解釋並問你看法。</p>
      ${groups.length ? body : none}`;
  }

  function friendsView() {
    const eps = DATA.friends.episodes;
    if (!eps.length) return `${header('Central Perk', 'Friends 追劇夥伴', '#/')}<div class="card"><p>還沒有載入集數資料。請先執行 <code>python tools/build_site.py</code>，或等 GitHub 自動部署完成。</p></div>`;
    const nx = nextEpisode();
    const lessons = DATA.friends.lessons || {};
    const subtitled = new Set(DATA.friends.subtitled || []);
    const lessonEps = eps.filter((e) => lessons[e.episode_id]);
    const nextLesson = lessonEps.find((e) => !S.watched[e.episode_id]);
    if (ui.season === undefined) ui.season = lessonEps.length ? 0 : (nx ? nx.season : 1); // 0 = episodes with a full lesson
    const seasons = [...new Set(eps.map((e) => e.season))];
    const shown = ui.season === 0 ? lessonEps : eps.filter((e) => e.season === ui.season);
    const list = shown.map((e) => {
      const tags = [];
      if (lessons[e.episode_id]) tags.push('<span class="tag">字幕教案</span>');
      else if (subtitled.has(e.episode_id)) tags.push('<span class="tag">字幕已匯入</span>');
      if (DATA.cards.episodes[e.episode_id]) tags.push('<span class="tag">金句卡</span>');
      if (S.watched[e.episode_id]) tags.push('<span class="tag good">已看</span>');
      return `<a class="card ep" href="#/friends/${e.episode_id}">
        <span class="ep-code">${ui.season === 0 ? `${e.season}·${pad2(e.episode)}` : `E${pad2(e.episode)}`}</span>
        <span class="grow"><strong lang="de">${esc(e.title_de)}</strong><br><span class="muted small">${esc(e.theme_zh || '')}</span>
        ${tags.length ? `<div class="tags" style="margin-top:6px">${tags.join('')}</div>` : ''}</span>
        ${icon('next', 18)}
      </a>`;
    }).join('');
    return `${header('Central Perk', `Friends 追劇夥伴 · 已看 ${eps.filter((e) => S.watched[e.episode_id]).length} 集 · 完整教案 ${lessonEps.length} 集`, '#/')}
      ${nextLesson ? `<a class="btn" href="#/friends/${nextLesson.episode_id}">下一集有完整教案：${nextLesson.episode_id}</a>` : ''}
      ${nx ? `<a class="btn ghost" href="#/friends/${nx.episode_id}">照順序接著看 ${nx.episode_id}</a>` : ''}
      <div class="segments" role="group" aria-label="選擇季數">
        ${lessonEps.length ? `<button class="seg" data-act="season" data-s="0" aria-pressed="${ui.season === 0}">教案</button>` : ''}
        ${seasons.map((s) => `<button class="seg" data-act="season" data-s="${s}" aria-pressed="${s === ui.season}">S${s}</button>`).join('')}</div>
      <div class="stack">${list}</div>`;
  }

  function episodeView(id) {
    const e = DATA.friends.episodes.find((x) => x.episode_id === id);
    if (!e) return notFound();
    const lesson = DATA.friends.lessons[id];
    const extra = DATA.cards.episodes[id];
    const dialogue = DATA.friends.dialogues[id];
    const src = `Friends ${id}`;
    const summaryDe = (lesson && lesson.summary_de) || e.summary_de;
    const summaryZh = (lesson && lesson.summary_zh) || e.summary_zh;
    const vocab = (lesson && lesson.vocabulary && lesson.vocabulary.length ? lesson.vocabulary : e.vocabulary || []);
    const questions = lesson && lesson.discussion && lesson.discussion.length
      ? lesson.discussion.map((q) => [q.question_de, q.question_zh, q.level])
      : (e.discussion_de ? [[e.discussion_de, e.discussion_zh, '']] : []);
    const phrases = extra ? extra.cards : [];
    const prompt = `Du bist meine Deutschlehrerin. Wir sprechen über „Friends“, Staffel ${e.season}, Folge ${e.episode} („${e.title_de}“), die ich gerade auf Deutsch gesehen habe.\n\nBitte mich zuerst, die Folge in drei bis fünf Sätzen nachzuerzählen. Stelle mir danach diese Fragen, immer nur eine auf einmal, mit je einer kurzen Nachfrage:\n${questions.map((q, n) => `${n + 1}. ${q[0]}`).join('\n')}\n\nIch möchte diese Wörter und Sätze aktiv benutzen:\n${vocab.map((v) => `- ${v.de}`).concat(phrases.map((p) => `- ${p[0]}`)).join('\n')}\n\n${TEACHER}`;

    const parts = [];
    parts.push(header(`${id} · ${e.title_de}`, `${e.title_en || ''}${e.suggested_level ? ` · ${e.suggested_level}` : ''}`, '#/friends'));
    parts.push(`<div class="card"><div class="tags"><span class="tag">${esc(e.theme_zh || '')}</span>${e.language_focus ? `<span class="tag">${esc(e.language_focus)}</span>` : ''}</div>
      ${ui.summary ? `<p lang="de">${esc(summaryDe)}</p><p class="muted">${esc(summaryZh)}</p>` : '<p class="muted small">劇情摘要有劇透，預設收起。</p>'}
      <button class="btn ghost" data-act="summary">${ui.summary ? '收起摘要' : '顯示劇情摘要'}</button></div>`);
    if (!lesson && (DATA.friends.subtitled || []).includes(id)) parts.push('<div class="card"><p class="small muted">這一集的字幕已匯入，完整教案整理好後會自動出現在這裡。目前先用基本詞彙與討論題。</p></div>');
    if (lesson && lesson.learning_goals_zh) parts.push(`<div class="card"><h3>這集的學習目標</h3>${lesson.learning_goals_zh.map((g) => `<p class="small">· ${esc(g)}</p>`).join('')}</div>`);

    parts.push('<h2>詞彙</h2><div class="stack">' + vocab.map((v) => phraseCard(v.de, v.zh, v.example_de ? `${v.example_de}（${v.example_zh || ''}）` : '', src, v.example_de ? {de: v.example_de, zh: v.example_zh} : null)).join('') + '</div>');
    const epArtBtn = artikelQuizButton(vocab, `${id} · 冠詞練習`, `#/friends/${id}`);
    if (epArtBtn) parts.push(epArtBtn);
    if (phrases.length) {
      parts.push(`<h2>金句卡</h2><p class="muted small">${esc(DATA.cards.notice_zh || '')}</p><div class="stack">${phrases.map((p) => phraseCard(p[0], p[1], p[2], src)).join('')}</div>`);
      parts.push(`<button class="btn ghost" data-act="drill" data-id="${id}">句子填空 · ${extra.drill.length} 題</button>`);
    }
    if (lesson && lesson.grammar && lesson.grammar.length) {
      parts.push('<h2>語法重點</h2><div class="stack">' + lesson.grammar.map((g) => `<div class="card"><h3>${esc(g.focus_zh)}</h3><p class="small">${esc(g.explanation_zh)}</p><p lang="de"><strong>${esc(g.example_de)}</strong></p><p class="muted small">${esc(g.example_zh)}</p></div>`).join('') + '</div>');
    }
    if (questions.length) {
      parts.push('<h2>劇情討論</h2><div class="stack">' + questions.map((q, n) => `<div class="card"><div class="row"><span class="tag">Frage ${n + 1}</span>${q[2] ? `<span class="tag">${esc(q[2])}</span>` : ''}</div><p lang="de"><strong>${esc(q[0])}</strong></p><p class="muted small">${esc(q[1])}</p></div>`).join('') + '</div>');
    }
    if (lesson && lesson.practice && lesson.practice.length) {
      parts.push('<h2>場景練習</h2><div class="stack">' + lesson.practice.map((p, n) => {
        const open = ui.hint && ui.hint[n];
        return `<div class="card"><p lang="de"><strong>${esc(p.task_de)}</strong></p><p class="muted small">${esc(p.task_zh)}</p>
          ${open ? `<p lang="de">${esc(p.answer_hint_de || '')}</p><p class="muted small">${esc(p.answer_hint_zh || '')}</p>` : ''}
          <button class="btn ghost" data-act="hint" data-n="${n}">${open ? '收起提示' : '看參考答案'}</button></div>`;
      }).join('') + '</div>');
    }
    if (dialogue) {
      parts.push(`<h2>原創對話 · ${esc(dialogue.title_zh)}</h2><p class="muted small">${esc(dialogue.notice_zh || '')} ${esc(dialogue.situation_zh || '')}</p>
        <div class="card">${dialogue.turns.map((t) => { const i = put({ de: t.de }); return `<div class="turn"><span class="speaker">${esc(t.speaker)}</span><span class="grow"><span lang="de">${esc(t.de)}</span><br><span class="muted small">${esc(t.zh)}</span></span><button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放這句">${icon('sound', 18)}</button></div>`; }).join('')}</div>`);
    }
    parts.push(promptCard('口說任務 · ChatGPT 語音模式', '複製提示詞，貼進 ChatGPT 後切到語音模式開始對話。', prompt));
    parts.push(S.watched[id]
      ? `<button class="btn ghost" data-act="unwatch" data-id="${id}">已看完 · 點一下取消</button>`
      : `<button class="btn" data-act="watch" data-id="${id}">標記為已看完 · +15 XP</button>`);
    return parts.join('');
  }


  // ---------- movie lessons: original content tied to user-supplied subtitle cues ----------
  function movieTime(ms) {
    const x = Math.floor((ms || 0) / 1000);
    return [Math.floor(x / 3600), Math.floor(x % 3600 / 60), x % 60].map(pad2).join(':');
  }
  function moviesView() {
    const list = DATA.movies.movies || [];
    return header('Filme · 電影學習', '德語電影 · 原創雙語教案', '#/') +
      '<p class="muted small">請搭配你自己的合法影片觀看；課程只提供原創教材，不提供電影字幕全文。</p>' +
      '<div class="stack">' + list.map((m) =>
        '<a class="card ep" href="#/movies/' + encodeURIComponent(m.movie_id) + '">' +
        '<span class="ep-code">' + esc(m.year) + '</span>' +
        '<span class="grow"><strong lang="de">' + esc(m.title) + '</strong><br>' +
        '<span class="muted small">' + esc(m.level) + ' · ' +
        m.chapters.filter((ch) => S.watched[ch.scene_id]).length + ' / ' + m.chapters.length +
        ' 場景完成</span></span>' + icon('next', 18) + '</a>').join('') + '</div>';
  }
  function movieView(id) {
    const m = (DATA.movies.movies || []).find((o) => o.movie_id === id);
    if (!m) return notFound();
    const cards = m.chapters.map((ch, n) =>
      '<a class="card ep" href="#/movies/' + encodeURIComponent(id) + '/' + encodeURIComponent(ch.scene_id) + '">' +
      '<span class="ep-code">' + pad2(n + 1) + '</span><span class="grow">' +
      '<strong lang="de">' + esc(ch.title_de) + '</strong><br><span class="muted small">' +
      esc(ch.title_zh) + ' · ' + movieTime(ch.source_start_ms) + '–' + movieTime(ch.source_end_ms) + '</span>' +
      (S.watched[ch.scene_id] ? '<span class="tag good">已完成</span>' : '') +
      '</span>' + icon('next', 18) + '</a>').join('');
    return header(m.title, esc(m.year) + ' · ' + esc(m.level), '#/movies') +
      '<div class="card"><p lang="de">' + esc(m.summary_de) + '</p><p class="muted">' + esc(m.summary_zh) + '</p></div>' +
      '<p class="muted small">' + esc(m.subtitle_source.notice_zh) + '</p><div class="stack">' + cards + '</div>';
  }
  function movieSceneView(id, sceneId) {
    const m = (DATA.movies.movies || []).find((o) => o.movie_id === id);
    const ch = m && m.chapters.find((c) => c.scene_id === sceneId);
    if (!ch) return notFound();
    const src = m.title + ' · ' + ch.scene_id;
    const prompt = 'Du bist meine Deutschlehrerin. Wir sprechen über den Film ' + m.title +
      ', Szene ' + ch.title_de + '. Bitte mich, die Szene in drei bis fünf eigenen Sätzen nachzuerzählen. ' +
      'Stelle mir dann eine Frage nach der anderen:\n' +
      ch.discussion.map((q, i) => (i + 1) + '. ' + q.question_de).join('\n') +
      '\nHilf mir, diese Wörter zu benutzen:\n' + ch.vocabulary.map((v) => '- ' + v.de).join('\n') + '\n' + TEACHER;
    const result = [];
    result.push(header(ch.title_de, ch.title_zh + ' · ' + movieTime(ch.source_start_ms) + '–' + movieTime(ch.source_end_ms),
      '#/movies/' + encodeURIComponent(id)));
    result.push('<div class="card"><span class="tag">' + esc(m.title) + '</span>' +
      '<p class="muted small">字幕 #'+ ch.source_cue_start + '–#' + ch.source_cue_end + ' · 僅限提供的字幕版本時間碼</p>' +
      (ui.summary ? '<p lang="de">' + esc(ch.summary_de) + '</p><p class="muted">' + esc(ch.summary_zh) + '</p>' :
      '<p class="muted small">劇情摘要有劇透，預設收起。</p>') +
      '<button class="btn ghost" data-act="summary">' + (ui.summary ? '收起摘要' : '顯示劇情摘要') + '</button></div>');
    result.push('<h2>學習目標</h2><div class="card">' +
      ch.learning_goals_zh.map((g) => '<p class="small">· ' + esc(g) + '</p>').join('') + '</div>');
    result.push('<h2>詞彙 · 點擊加入複習</h2><div class="stack">' +
      ch.vocabulary.map((v) => phraseCard(v.de, v.zh,
        v.example_de + '（' + v.example_zh + '） · 字幕 #' + v.source_cue_id, src, {de: v.example_de, zh: v.example_zh})).join('') + '</div>');
    const mvArtBtn = artikelQuizButton(ch.vocabulary, `${ch.title_de} · 冠詞練習`, `#/movies/${encodeURIComponent(id)}/${encodeURIComponent(sceneId)}`);
    if (mvArtBtn) result.push(mvArtBtn);
    result.push('<h2>文法重點</h2><div class="stack">' +
      ch.grammar.map((g) => '<div class="card"><h3>' + esc(g.focus_zh) + '</h3><p class="small">' +
        esc(g.explanation_zh) + '</p><p lang="de"><strong>' + esc(g.example_de) +
        '</strong></p><p class="muted small">' + esc(g.example_zh) + '</p></div>').join('') + '</div>');
    result.push('<h2>電影討論</h2><div class="stack">' +
      ch.discussion.map((q, i) => '<div class="card"><span class="tag">Frage ' + (i + 1) + ' · ' +
        esc(q.level) + '</span><p lang="de"><strong>' + esc(q.question_de) +
        '</strong></p><p class="muted small">' + esc(q.question_zh) + '</p></div>').join('') + '</div>');
    result.push('<h2>場景練習</h2><div class="stack">' +
      ch.practice.map((p, i) => '<div class="card"><p lang="de"><strong>' + esc(p.task_de) +
        '</strong></p><p class="muted small">' + esc(p.task_zh) + '</p>' +
        (ui.hint && ui.hint[i] ? '<p lang="de">' + esc(p.answer_hint_de) +
        '</p><p class="muted small">' + esc(p.answer_hint_zh) + '</p>' : '') +
        '<button class="btn ghost" data-act="hint" data-n="' + i + '">' +
        (ui.hint && ui.hint[i] ? '收起提示' : '看參考答案') + '</button></div>').join('') + '</div>');
    result.push(promptCard('口說任務 · ChatGPT 語音模式', '複製提示詞後，和 ChatGPT 用德語討論這場戲。', prompt));
    result.push('<button class="btn ' + (S.watched[sceneId] ? 'ghost' : '') +
      '" data-act="' + (S.watched[sceneId] ? 'unwatch' : 'watch') + '" data-id="' + esc(sceneId) + '">' +
      (S.watched[sceneId] ? '已完成 · 點一下取消' : '標記這場戲已完成 · +15 XP') + '</button>');
    return result.join('');
  }

  function testView() {
    const t = DATA.test;
    const prompt = `Du bist Sachbearbeiterin in der Einbürgerungsbehörde und führst mit mir ein freundliches Gespräch über die Werte des Grundgesetzes. Stelle mir nacheinander diese Fragen, immer nur eine auf einmal, und frage nach, wenn meine Antwort zu kurz ist:\n1. Was bedeutet Demokratie für Sie?\n2. Was verstehen Sie unter einem Rechtsstaat?\n3. Was bedeutet Gleichberechtigung von Mann und Frau im Alltag?\n4. Warum ist die Meinungsfreiheit wichtig, und wo hat sie Grenzen?\n5. Was bedeutet Religionsfreiheit?\n6. Was würden Sie tun, wenn jemand in Ihrer Umgebung diskriminiert wird?\n\n${TEACHER}`;
    return `${header('Einbürgerungstest', '入籍考試 · 德國價值與憲政體制', '#/')}
      <div class="card"><p class="small">${esc(t.notice_zh || '')}</p>
        <p class="small muted">正式考試：33 題四選一、60 分鐘、答對 17 題通過，其中 3 題是居住邦（巴伐利亞）的題目。</p>
        ${t.official_url ? `<a class="btn ghost" href="${esc(t.official_url)}" target="_blank" rel="noopener">BAMF 官方網站（題庫與線上測驗）</a>` : ''}</div>
      <div class="btn-row">
        <button class="btn" data-act="test" data-mode="daily">今日 5 題</button>
        <button class="btn ghost" data-act="test" data-mode="ten">隨機 10 題</button>
      </div>
      <button class="btn ghost" data-act="test" data-mode="all">全部 ${t.questions.length} 題</button>
      <h2>核心詞彙</h2>
      <div class="stack">${(t.vocab || []).map((v) => phraseCard(v[0], v[1], '', '入籍考試')).join('')}</div>
      ${artikelQuizButton((t.vocab || []).map((v) => ({ de: v[0], zh: v[1] })), 'Einbürgerungstest · 冠詞練習', '#/test')}
      ${promptCard('口說任務 · 用自己的話說明價值', '面談時可能要用自己的話解釋這些概念。複製提示詞到 ChatGPT 語音模式練習。', prompt)}`;
  }
  function testItems(mode) {
    const all = DATA.test.questions;
    const rand = mode === 'daily' ? rng(dayNumber()) : Math.random;
    const count = mode === 'daily' ? 5 : mode === 'ten' ? 10 : all.length;
    return shuffle(all, rand).slice(0, count).map((q) => ({
      q: q.q, qLang: 'de', sub: q.zh, optLang: 'de', why: q.why,
      opts: shuffle(q.opts.map((t, k) => ({ t, ok: k === 0 })), rand),
    }));
  }

  function driveView() {
    const d = DATA.drive;
    const prompt = `Wir üben die praktische Fahrprüfung. Du bist der Fahrprüfer. Gib mir nacheinander typische Anweisungen aus der Prüfung (Abfahrtskontrolle, Abbiegen, Einparken, Autobahn, Gefahrenbremsung), immer nur eine auf einmal. Ich wiederhole die Anweisung mit eigenen Worten und sage, was ich tue. Wenn ich etwas falsch verstehe, erkläre es mir kurz und einfach. Stelle mir zwischendurch auch zwei technische Fragen zum Fahrzeug.\n\n${TEACHER}`;
    return `${header('Fahrprüfung', '路考 · 聽懂考官指令', '#/')}
      <div class="card"><p class="small">${esc(d.notice_zh || '')}</p></div>
      <div class="btn-row">
        <button class="btn" data-act="drive-quiz" data-n="8">聽指令 8 題</button>
        <button class="btn ghost" data-act="drive-quiz" data-n="15">聽指令 15 題</button>
      </div>
      ${d.groups.map((g) => `<h2 lang="de">${esc(g.de)}</h2><p class="muted small">${esc(g.zh)}</p><div class="stack">${g.items.map((it) => phraseCard(it[0], it[1], '', '路考')).join('')}</div>`).join('')}
      ${promptCard('口說任務 · 模擬路考', '複製提示詞到 ChatGPT 語音模式，它會扮演考官下指令。', prompt)}`;
  }

  function reviewView() {
    const total = Object.keys(S.cards).length;
    if (!ui.queue) { ui.queue = shuffle(dueCards()).slice(0, 15); ui.shown = false; ui.reviewed = 0; ui.again = {}; }
    if (!total) {
      return `${header('Wiederholen', '複習')}<div class="card"><p>還沒有卡片。在任何一區點開句子看中文，它就會自動加入複習。</p></div><a class="btn" href="#/">回到地圖</a>`;
    }
    if (!ui.queue.length) {
      markStep('review');
      return `${header('Wiederholen', '複習')}<div class="card flash"><div class="flash-de">${ui.reviewed ? `完成 ${ui.reviewed} 張` : '今天沒有到期的卡片'}</div>
        <p class="muted">共有 ${total} 張卡片，下一批會在到期日回來。</p></div><a class="btn" href="#/heute">回到今日任務</a>`;
    }
    const de = ui.queue[0];
    const c = S.cards[de];
    const examples = c.examples || usageExamples(de, c.zh, '', null);
    const i = put({ de, zh: c.zh, src: c.src, examples });
    const parsed = splitArtikel(de);
    const artAnswered = !!ui.artikelPicked;
    const artVisible = ui.shown || artAnswered;
    const flashDeHtml = parsed
      ? (artVisible ? `${artikelBadge(parsed.art)} ${esc(parsed.rest)}` : `<span class="artikel-blank" aria-label="冠詞空格">____</span> ${esc(parsed.rest)}`)
      : esc(de);
    const artikelControls = parsed ? `<div class="artikel-choices" role="group" aria-label="選擇冠詞 Artikel" data-no-auto-speech>${
      ARTIKEL.map((art) => {
        let cls = 'opt artikel-btn';
        if (artAnswered && art === parsed.art) cls += ' good';
        else if (artAnswered && ui.artikelPicked === art) cls += ' bad';
        return `<button type="button" class="${cls}" data-act="review-artikel" data-art="${art}" lang="de" ${artAnswered ? 'disabled' : ''}>${art}</button>`;
      }).join('')
    }</div>${artAnswered ? `<p class="artikel-feedback ${ui.artikelPicked === parsed.art ? 'good' : 'bad'}">${ui.artikelPicked === parsed.art ? '冠詞答對了' : `正確冠詞是 ${parsed.art}`}</p>` : ''}` : '';
    return `${header('Wiederholen', `還剩 ${ui.queue.length} 張`)}
      <div class="card flash">
        ${c.src ? `<span class="tag" style="align-self:center">${esc(c.src)}</span>` : ''}
        <div class="flash-de" lang="de">${flashDeHtml}</div>
        <button class="icon-btn" style="align-self:center" data-act="say" data-i="${i}" aria-label="播放德文發音">${icon('sound', 20)}</button>
        ${artikelControls}
        ${ui.shown ? `<p>${esc(c.zh)}</p><div class="review-extra">
          <p class="muted small">情境例句</p><p lang="de">${esc(examples[0].de)}</p>
          <button class="btn ghost" data-act="example-say" data-i="${i}">🔊 聽例句</button>
          <button class="btn" data-act="coach" data-i="${i}">開始分步對話</button></div>` : `<p class="muted small">${parsed && !artAnswered ? '先選冠詞（der / die / das），再翻面看中文。' : '先在心裡說出意思，再翻面。'}</p>`}
      </div>
      ${ui.shown
        ? '<div class="btn-row"><button class="btn ghost" data-act="grade" data-ok="0">還不熟</button><button class="btn" data-act="grade" data-ok="1">記得</button></div>'
        : '<button class="btn" data-act="flip">顯示中文</button>'}`;
  }

  // ---------- guided listening, shadowing and two-turn conversation ----------
  // No hidden language model: user responses determine a simple follow-up.
  const COACH_SCENES = [
    {
      name: '朋友聊天', intro: 'Hallo! Schön, dass wir uns sehen. Hör mir bitte zu.',
      question: 'Hallo! Was möchtest du mir heute erzählen?',
      follow: 'Warum ist dir das wichtig? Kannst du ein Beispiel nennen?',
      followReason: 'Und was ist danach passiert? Erzähl mir mehr.'
    },
    {
      name: '日常生活', intro: 'Guten Tag! Ich habe eine kleine Frage an dich.',
      question: 'Kannst du mir die Situation kurz beschreiben?',
      follow: 'Was würdest du in dieser Situation machen?',
      followReason: 'Wie würdest du das Problem lösen?'
    },
    {
      name: '工作與學習', intro: 'Guten Morgen! Wir besprechen heute eine Alltagssituation.',
      question: 'Was ist deiner Meinung nach der wichtigste Punkt?',
      follow: 'Kannst du deinen Gedanken etwas genauer erklären?',
      followReason: 'Welchen nächsten Schritt schlägst du vor?'
    }
  ];
  function coachBack() {
    return '<button type="button" class="btn ghost" data-act="coach-exit">返回單字卡</button>';
  }
  function coachInput(value) {
    return '<div class="coach-input-wrap"><label class="small" for="coach-answer">你的德文回答（可用語音輸入或打字）</label>' +
      '<textarea id="coach-answer" class="coach-input" rows="3" spellcheck="true" lang="de" ' +
      'placeholder="Ich denke, dass …">' + esc(value || '') + '</textarea>' +
      '<div class="coach-controls"><button class="btn ghost" type="button" data-act="coach-mic">' +
      icon('sound', 18) + ' 語音轉文字</button>' +
      '<button class="btn ghost" type="button" data-act="coach-record">' +
      '🎙️ 錄下我的聲音</button>' +
      '<button class="btn ghost" type="button" data-act="coach-record-stop">■ 停止錄音</button>' +
      (ui.coach && ui.coach.recordingUrl ?
        '<audio class="coach-playback" controls preload="none" src="' +
        esc(ui.coach.recordingUrl) + '" aria-label="播放自己的跟讀錄音"></audio>' : '') +
      '<p class="muted small">錄音不會上傳本站，僅保存在這個分頁供你比較發音；語音轉文字若不支援也可以直接打字。</p></div></div>';
  }
  function coachFollowup(c) {
    const s = COACH_SCENES[c.scene || 0];
    return /\b(weil|denn|deshalb|darum)\b/i.test(c.reply1 || '') ? s.followReason : s.follow;
  }
  function coachView() {
    const c = ui.coach;
    if (!c) return notFound();
    const example = c.examples[c.exampleIndex || 0];
    const scene = COACH_SCENES[c.scene || 0];
    const step = c.stage || 0;
    const blocks = [header('Sprechen · 分步對話', c.src + ' · ' + c.de)];
    blocks.push('<div class="card coach-progress"><div class="row">' +
      '<span class="tag">聽力 → 跟讀 → 回答 → 追問</span><span class="tag">' + (step ? Math.min(step, 5) : 0) +
      ' / 5</span></div>' + (step ? '<p class="muted small">每一步都能先聽德語、跟讀，再自己回答。</p>' : '') + '</div>');
    if (!step) {
      blocks.push('<h2>先選一個對話場景</h2><div class="stack">' +
        COACH_SCENES.map((s, n) => '<button class="card coach-choice" data-act="coach-scene" data-n="' +
          n + '"><strong>' + esc(s.name) + '</strong><span lang="de">' +
          esc(s.question) + '</span></button>').join('') + '</div>' +
        '<div class="card"><p class="small">練習詞彙</p><p lang="de"><strong>' + renderDeWithArtikel(c.de) +
        '</strong></p><p class="muted small">' + esc(c.zh) + '</p></div>');
    }
    if (step === 1) {
      blocks.push('<h2>1. 先聽對話開場與情境例句</h2>' +
        '<div class="card"><p class="muted small">' + esc(scene.name) + ' · ' +
        esc(example.scene) + '</p><p lang="de">' + esc(scene.intro) +
        '</p><p lang="de"><strong>' + esc(example.de) +
        '</strong></p><p class="muted small">' + esc(example.zh) + '</p></div>' +
        '<button class="btn" data-act="coach-play-intro">' + icon('sound', 20) +
        ' 連續聽老師與例句</button>' +
        '<button class="btn ghost" data-act="coach-next">已聽懂，下一步：跟讀</button>');
    }
    if (step === 2) {
      blocks.push('<h2>2. 聽完再跟讀（Shadowing）</h2>' +
        '<p class="muted small">先聽、跟著模仿重音和節奏，再試著不看文字。必要時可以重播多次。</p>' +
        '<div class="card"><p lang="de"><strong>' + esc(example.de) + '</strong></p>' +
        '<p class="muted small">' + esc(example.zh) + '</p></div>' +
        '<button class="btn ghost" data-act="coach-play-example">' + icon('sound', 20) +
        ' 重播例句（可調慢速）</button>' +
        coachInput(c.draft || '') +
        '<button class="btn" data-act="coach-next">下一步：自己回答</button>');
    }
    if (step === 3) {
      const question = scene.question + ' Versuche dabei „' + c.de + '“ zu benutzen.';
      blocks.push('<h2>3. 角色問你問題</h2><div class="card"><p lang="de"><strong>' +
        esc(question) + '</strong></p><p class="muted small">請用德語說 1–3 句，試著自然地運用目標詞彙。</p></div>' +
        '<button class="btn ghost" data-act="coach-play-question">' + icon('sound', 20) +
        ' 先聽問題</button>' + coachInput(c.draft || '') +
        (c.error ? '<p class="coach-warning" role="alert">' + esc(c.error) + '</p>' : '') +
        '<button class="btn" data-act="coach-next">送出回答，聽追問</button>');
    }
    if (step === 4) {
      blocks.push('<h2>4. 對方根據你前一句追問</h2>' +
        '<div class="card"><p class="muted small">你剛才回答</p><p lang="de">' + esc(c.reply1) +
        '</p><p class="muted small">追問</p><p lang="de"><strong>' +
        esc(coachFollowup(c)) + '</strong></p></div>' +
        '<button class="btn ghost" data-act="coach-play-question">' + icon('sound', 20) +
        ' 聽追問</button>' + coachInput(c.draft || '') +
        (c.error ? '<p class="coach-warning" role="alert">' + esc(c.error) + '</p>' : '') +
        '<button class="btn" data-act="coach-next">完成這輪對話</button>');
    }
    if (step >= 5) {
      const notes = [
        c.reply1 && c.reply1.trim().split(/\s+/).length < 5 ?
          '第一句稍短，可以試著補充人物、時間或原因。' : '已完成第一輪回答，可以多練幾次讓語句更流暢。',
        /\bweil\b/i.test((c.reply1 || '') + ' ' + (c.reply2 || '')) ?
          '你嘗試用 weil 說明原因，很好；也可以把理由說得更具體。' :
          '下一輪可以試著加上 weil，補充原因，讓對話更自然。'
      ];
      const prompt = 'Wir üben Deutsch. Mein Wort ist: ' + c.de + '. Meine Antworten waren:\n1. ' +
        (c.reply1 || '') + '\n2. ' + (c.reply2 || '') +
        '\nBitte korrigiere meine Antworten, gib mir zwei natürlichere Formulierungen und führe das Gespräch weiter. ' +
        TEACHER;
      blocks.push('<h2>5. 完成！回顧對話</h2><div class="card"><p class="muted small">例句</p>' +
        '<p lang="de">' + esc(example.de) + '</p><p class="muted small">你的第一句</p>' +
        '<p lang="de">' + esc(c.reply1 || '') + '</p><p class="muted small">你的第二句</p>' +
        '<p lang="de">' + esc(c.reply2 || '') + '</p></div>' +
        '<div class="card"><h3>練習建議</h3>' +
        notes.map((n) => '<p class="small">' + esc(n) + '</p>').join('') +
        '<p class="muted small">這是練習提示，不是 AI 語法批改，也不是發音準確度評分。</p></div>' +
        promptCard('進階自由對話 · ChatGPT', '需要真正即時變化、語法回饋時，可複製這段提示詞到 ChatGPT 語音模式。', prompt) +
        '<button class="btn" data-act="coach-other">換個情境再練一次</button>');
    }
    blocks.push(coachBack());
    return blocks.join('');
  }

  // ---------- DW "Kurz und leicht": daily video news, transcript, Glossar and review games ----------
  const DW = window.DQDW;
  const DW_CACHE = {};
  const DW_LOADING = {};
  const DW_PROGRAM_URL = 'https://www.dw.com/kurzundleicht';
  const DW_GAMES = {
    match: { de: 'Glossar-Zuordnung', zh: '把德文詞和德文解釋配對' },
    cloze: { de: 'Lückentext', zh: '新聞原句填空：Glossar 單字、名詞或冠詞' },
    puzzle: { de: 'Satz-Puzzle', zh: '把打亂的字排回新聞原句' },
    truefalse: { de: 'Richtig oder falsch?', zh: '這句話和影片內容一樣嗎？' },
  };
  const CLOZE_KIND = { glossar: 'Glossar 單字', nomen: '名詞', artikel: '冠詞 Artikel' };

  function loadDwEpisode(id) {
    if (DW_CACHE[id] || DW_LOADING[id] || !/^\d{4}-\d{2}-\d{2}$/.test(id)) return;
    DW_LOADING[id] = true;
    getJson(`data/dw/${id}.json`, null).then((ep) => {
      DW_CACHE[id] = ep && ep.id ? ep : { id, error: true };
      delete DW_LOADING[id];
      if (route().startsWith('/dw')) render();
    });
  }
  const dwCurrent = () => DW_CACHE[ui.dwId] && !DW_CACHE[ui.dwId].error ? DW_CACHE[ui.dwId] : null;
  function dwState(id) {
    if (!S.dw[id]) S.dw[id] = { games: {} };
    if (!S.dw[id].games) S.dw[id].games = {};
    return S.dw[id];
  }
  const dwSentences = (ep) => (DW ? DW.sentences(ep) : []);
  function dwLinks(ep) {
    if (!ep._links) Object.defineProperty(ep, '_links', { value: DW.linkGlossary(ep), enumerable: false });
    return ep._links;
  }
  function dwGamesFor(ep) {
    if (!ep._games) Object.defineProperty(ep, '_games', { value: DW.buildGames(ep, ep.id), enumerable: false, writable: true });
    return ep._games;
  }
  function dwProgress(ep) {
    const st = dwState(ep.id);
    const games = dwGamesFor(ep);
    const avail = DW.availableGames(games);
    const need = DW.gamesNeeded(avail);
    const gamesDone = Math.min(avail.filter((g) => st.games[g]).length, need);
    const hasVideo = !!(ep.video && ep.video.youtube_id);
    const hasText = dwSentences(ep).length > 0;
    const video = !hasVideo || !!st.video;
    const text = !hasText || !!st.text;
    const gamesOk = gamesDone >= need;
    return { st, avail, need, gamesDone, hasVideo, hasText, video, text, gamesOk, complete: video && text && gamesOk };
  }
  function dwCheckComplete(ep) {
    const p = dwProgress(ep);
    if (p.complete && !p.st.done) {
      p.st.done = dayKey();
      S.dwDays[dayKey()] = ep.id;
      addXp(20);
    }
    save();
  }
  function dwMark(ep, key) {
    const st = dwState(ep.id);
    if (st[key]) return;
    st[key] = dayKey();
    addXp(10);
    markStep('news'); // a DW news video counts as today's news step
    dwCheckComplete(ep);
  }
  const dwStreak = () => (DW ? DW.streak(S.dwDays || {}, dayKey()) : 0);
  function dwTodayOpen() {
    const latest = (DATA.dw.episodes || [])[0];
    return !!latest && latest.id === dayKey() && !(S.dw[latest.id] && S.dw[latest.id].done);
  }
  function dwDayLabel(id) {
    if (id === dayKey()) return '今天';
    if (id === addDays(-1)) return '昨天';
    const d = new Date(`${id}T12:00:00`);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function dwLongDate(id) {
    return new Date(`${id}T12:00:00`).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
  }
  const dwCleanTerm = (term) => String(term || '').split(',')[0].trim();
  function dwArtikelIndex() {
    const list = [];
    Object.values(DATA.friends.lessons || {}).forEach((l) => (l.vocabulary || []).forEach((v) => list.push(v.de)));
    (DATA.friends.episodes || []).forEach((e) => (e.vocabulary || []).forEach((v) => list.push(v.de)));
    (DATA.movies.movies || []).forEach((m) => m.chapters.forEach((ch) => (ch.vocabulary || []).forEach((v) => list.push(v.de))));
    (DATA.test.vocab || []).forEach((v) => list.push(v[0]));
    Object.keys(S.cards).forEach((k) => list.push(k));
    Object.values(DW_CACHE).forEach((ep) => (ep.glossary || []).forEach((g) => list.push(g.term)));
    return DW.buildArtikelIndex(list);
  }
  function dwExampleSentence(ep, g) {
    const link = dwLinks(ep).byGloss[g.id];
    const s = link && dwSentences(ep).find((x) => x.id === link.sid);
    return s ? s.de : '';
  }
  function dwGlossExamples(ep, g) {
    const sentence = dwExampleSentence(ep, g);
    const list = [];
    if (sentence) list.push({ scene: 'DW 新聞原句', de: sentence, zh: g.definition });
    list.push({ scene: 'Glossar 解釋', de: g.definition, zh: dwCleanTerm(g.term) });
    return list;
  }

  function dwView(idArg) {
    if (!DW) return `${header('Kurz und leicht', 'DW 每日影片新聞', '#/')}<div class="card"><p>遊戲模組沒有載入，請重新整理頁面。</p></div>`;
    const index = DATA.dw.episodes || [];
    if (!index.length) {
      return `${header('Kurz und leicht', 'DW 每日 A2 影片新聞', '#/')}
        <div class="card"><p>還沒有 DW 集數。GitHub Actions 每天中午與傍晚會自動抓取 DW《Kurz und leicht》：影片、逐字稿（Manuskript）和單字表（Glossar）。</p>
        <p class="muted small">第一次部署後就會出現。也可以到 GitHub 的 Actions 頁面手動執行「Build and deploy learning site」。</p>
        <a class="btn ghost" href="${DW_PROGRAM_URL}" target="_blank" rel="noopener">開啟 DW Kurz und leicht</a></div>`;
    }
    const id = idArg && index.some((e) => e.id === idArg) ? idArg : index[0].id;
    ui.dwId = id;
    const parts = [header('Kurz und leicht', `DW 影片新聞 · ${dwLongDate(id)}`, '#/'), dwDayStrip(index, id)];
    const ep = DW_CACHE[id];
    if (!ep) {
      loadDwEpisode(id);
      parts.push('<div class="card"><p class="muted">載入這一集…</p></div>');
      return parts.join('');
    }
    if (ep.error) {
      parts.push(`<div class="card"><p>這一集的資料無法載入。</p><a class="btn ghost" href="${DW_PROGRAM_URL}" target="_blank" rel="noopener">到 DW 網站觀看</a></div>`);
      return parts.join('');
    }
    const p = dwProgress(ep);
    const tab = ui.dwTab || 'watch';
    parts.push(dwTracker(ep, p));
    parts.push(`<div class="segments" role="tablist" aria-label="DW 內容">
      <button class="seg" data-act="dw-tab" data-tab="watch" aria-pressed="${tab === 'watch'}">影片＋逐字稿</button>
      <button class="seg" data-act="dw-tab" data-tab="glossar" aria-pressed="${tab === 'glossar'}">Glossar · ${ep.glossary.length}</button>
      <button class="seg" data-act="dw-tab" data-tab="games" aria-pressed="${tab === 'games'}">遊戲 · ${p.gamesDone}/${p.need}</button></div>`);
    if (tab === 'watch') parts.push(...dwWatchParts(ep, p));
    else if (tab === 'glossar') parts.push(dwGlossarHtml(ep));
    else parts.push(ui.dwGame ? dwGameHtml(ep) : dwGamesListHtml(ep, p));
    const src = ep.source || {};
    parts.push(`<p class="muted small dw-source">影片、逐字稿與 Glossar：${esc(src.copyright || '© Deutsche Welle')} ·
      <a href="${esc(src.url || src.program_url || DW_PROGRAM_URL)}" target="_blank" rel="noopener">DW 原始頁面</a>
      ${ep.video ? ` · <a href="${esc(ep.video.url)}" target="_blank" rel="noopener">YouTube</a>` : ''} · 僅供個人學習。</p>`);
    return parts.join('');
  }

  function dwDayStrip(index, id) {
    const shown = index.slice(0, 21);
    const chips = shown.map((e) => {
      const done = S.dw[e.id] && S.dw[e.id].done;
      return `<a class="seg${done ? ' done' : ''}" href="#/dw/${esc(e.id)}" aria-pressed="${e.id === id}">${esc(dwDayLabel(e.id))}</a>`;
    }).join('');
    const older = index.length > shown.length
      ? `<select class="dw-older" data-dw-pick aria-label="更早的集數"><option value="">更早…</option>${index.slice(shown.length).map((e) => `<option value="${esc(e.id)}"${e.id === id ? ' selected' : ''}>${esc(e.id)}</option>`).join('')}</select>`
      : '';
    return `<div class="segments dw-days" role="group" aria-label="選擇日期">${chips}${older}</div>`;
  }

  function dwTracker(ep, p) {
    const check = (ok, na, label, sub) => `<span class="dw-check${ok ? ' done' : ''}">
      <span class="n">${ok ? icon('check', 20) : esc(sub)}</span><span>${esc(label)}</span>${na ? '<span class="small">（本集無）</span>' : ''}</span>`;
    const streak = dwStreak();
    return `<div class="card night dw-tracker">
      <div class="row"><h3 class="grow">${p.complete ? '這一集完成了！' : '這一集的任務'}</h3><span class="pill">連續 ${streak} 天</span></div>
      <div class="dw-checks">
        ${check(p.video, !p.hasVideo, '看影片', '1')}
        ${check(p.text, !p.hasText, '讀逐字稿', '2')}
        ${check(p.gamesOk, !p.avail.length, `遊戲 ${p.gamesDone}/${p.need}`, '3')}
      </div>
      <p class="muted small">${p.complete ? `+20 XP 已入帳。${ep.id === dayKey() ? '明天見！' : ''}` : '三項都完成 +20 XP，算一天的連續紀錄。週末沒有新集數時，做一集舊的也算。'}</p>
    </div>`;
  }

  function dwWatchParts(ep, p) {
    const out = [];
    if (p.hasVideo) {
      const vid = encodeURIComponent(ep.video.youtube_id);
      out.push(`<div class="dw-video" data-keep="dw-video-${esc(ep.video.youtube_id)}">
        <iframe src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&amp;playsinline=1&amp;cc_load_policy=1&amp;cc_lang_pref=de&amp;hl=de"
          title="${esc(ep.video.title || ep.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`);
      out.push(p.st.video
        ? '<button class="btn ghost" data-act="dw-unmark" data-key="video">✓ 影片已看完 · 點一下取消</button>'
        : '<button class="btn" data-act="dw-mark" data-key="video">影片看完了 · +10 XP</button>');
    } else {
      out.push(`<div class="card"><p>這一集沒有找到 YouTube 影片。</p><a class="btn ghost" href="${esc((ep.source && ep.source.url) || DW_PROGRAM_URL)}" target="_blank" rel="noopener">到 DW 網站觀看</a></div>`);
    }
    if (ep.headlines && ep.headlines.length) {
      out.push(`<div class="card"><h3>今日新聞</h3>${ep.headlines.map((h) => `<p lang="de">· ${esc(h)}</p>`).join('')}</div>`);
    }
    if (!p.hasText) {
      out.push('<div class="card"><p class="muted">這一集還沒有逐字稿。DW 頁面整理好後，下一次自動更新會補上。</p></div>');
      return out;
    }
    const links = dwLinks(ep);
    const idx = S.dwArtikel ? dwArtikelIndex() : null;
    const glossById = {};
    ep.glossary.forEach((g) => { glossById[g.id] = g; });
    out.push(`<div class="row"><h2 class="grow">Manuskript</h2>
      <button class="btn ghost dw-small" data-act="dw-artikel" aria-pressed="${!!S.dwArtikel}">${S.dwArtikel ? '隱藏冠詞顏色' : '顯示冠詞顏色'}</button></div>
      <p class="muted small">點任何一個字查看：<span class="dw-w term">Glossar 單字</span>有 DW 的德文解釋，名詞會顯示 der / die / das。每句右邊的喇叭播放母語發音。</p>`);
    const stories = ep.stories.map((story) => {
      const lines = story.sentences.map((s) => {
        const marks = links.bySentence[s.id] || {};
        const sel = ui.dwLookup && ui.dwLookup.sid === s.id ? ui.dwLookup.k : -1;
        const html = DW.tokenize(s.de).map((t) => {
          if (!t.w) return esc(t.t);
          let cls = 'dw-w';
          if (marks[t.i]) cls += ' term';
          if (t.i === sel) cls += ' sel';
          if (idx) { const art = DW.artikelFor(t.t, idx); if (art) cls += ` a-${art}`; }
          return `<button type="button" class="${cls}" data-act="dw-word" data-s="${esc(s.id)}" data-k="${t.i}">${esc(t.t)}</button>`;
        }).join('');
        const lookup = sel >= 0 ? dwLookupHtml(ep, s, marks[sel] ? glossById[marks[sel]] : null) : '';
        return `<div class="dw-sent"><p class="dw-line" lang="de">${html}</p>
          <button class="icon-btn dw-say" data-act="dw-say" data-s="${esc(s.id)}" aria-label="播放這句">${icon('sound', 18)}</button></div>${lookup}`;
      }).join('');
      return `<div class="card dw-story">${story.heading ? `<h3 lang="de">${esc(story.heading)}</h3>` : ''}${lines}</div>`;
    }).join('');
    out.push(`<div class="stack dw-transcript${idx ? ' dw-art' : ''}" data-no-auto-speech>${stories}</div>`);
    out.push(p.st.text
      ? '<button class="btn ghost" data-act="dw-unmark" data-key="text">✓ 逐字稿已讀 · 點一下取消</button>'
      : '<button class="btn" data-act="dw-mark" data-key="text">逐字稿讀完了 · +10 XP</button>');
    out.push('<button class="btn warm" data-act="dw-tab" data-tab="games">去玩今天的複習遊戲</button>');
    const prompt = `Ich habe heute die DW-Videonachrichten „Kurz und leicht“ vom ${ep.date.split('-').reverse().join('.')} gesehen.${ep.headlines.length ? ` Die Themen waren:\n${ep.headlines.map((h) => `- ${h}`).join('\n')}` : ''}\n\nBitte frage mich zuerst, was ich verstanden habe, und lass mich jede Nachricht in zwei, drei Sätzen nacherzählen. Stelle danach zu jedem Thema eine Meinungsfrage. Ich möchte diese Wörter benutzen:\n${ep.glossary.map((g) => `- ${dwCleanTerm(g.term)}`).join('\n')}\n\n${TEACHER}`;
    out.push(promptCard('口說任務 · 和 ChatGPT 聊今天的新聞', '複製提示詞，貼進 ChatGPT 後切到語音模式。', prompt));
    return out;
  }

  function dwLookupHtml(ep, s, g) {
    const sentenceWords = DW.words(s.de);
    const word = sentenceWords[ui.dwLookup.k] || '';
    let art = g ? (splitArtikel(dwCleanTerm(g.term)) || {}).art || '' : DW.artikelFor(word, dwArtikelIndex());
    // "das Gebiet": a capitalised word right after "das" is a neuter noun (der/die are ambiguous by case).
    const inferred = !art && /^[A-ZÄÖÜ]/.test(word) && ui.dwLookup.k > 0 && sentenceWords[ui.dwLookup.k - 1].toLowerCase() === 'das';
    if (inferred) art = 'das';
    const cardDe = g ? (g.say || dwCleanTerm(g.term)) : (art ? `${art} ${word}` : word);
    const examples = g ? dwGlossExamples(ep, g) : [{ scene: 'DW 新聞原句', de: s.de, zh: '' }];
    const i = put({ de: cardDe, zh: g ? g.definition : `例句：${s.de}`, src: `DW ${dwDayLabel(ep.id)}`, examples, say: g ? g.say : word });
    const added = !!S.cards[cardDe];
    const head = g ? renderDeWithArtikel(dwCleanTerm(g.term)) : (art ? `${artikelBadge(art)} ${esc(word)}` : esc(word));
    const dict = encodeURIComponent(g ? (g.say || '').replace(/^(der|die|das|etwas|sich)\s+/, '') : word);
    const translate = `https://translate.google.com/?sl=de&tl=zh-TW&text=${encodeURIComponent(s.de)}&op=translate`;
    return `<div class="card dw-lookup" data-no-auto-speech>
      <div class="row"><span class="grow dw-lookup-word" lang="de">${head}</span>
        <button class="icon-btn" data-act="dw-say-reg" data-i="${i}" aria-label="播放這個字">${icon('sound', 18)}</button></div>
      ${g ? `<span class="tag">Glossar</span><p lang="de">${esc(g.definition)}</p>${g.term !== dwCleanTerm(g.term) || g.term.includes('|') ? `<p class="muted small" lang="de">${esc(g.term)}</p>` : ''}`
        : `<p class="muted small">${inferred ? '冠詞由句中的 das 推斷。' : art ? '冠詞來自網站上其他教材的單字卡。' : ''}這個字不在今天的 Glossar 裡，可以查字典或翻譯整句。</p>`}
      <div class="phrase-tools">
        <button class="btn${added ? ' ghost' : ''}" data-act="dw-add" data-i="${i}" ${added ? 'disabled' : ''}>${added ? '已在複習卡裡' : '加入複習卡'}</button>
        <a class="btn ghost" href="https://www.dwds.de/wb/${dict}" target="_blank" rel="noopener">DWDS 字典</a>
        <a class="btn ghost" href="${translate}" target="_blank" rel="noopener">翻譯整句</a>
      </div></div>`;
  }

  function dwGlossarHtml(ep) {
    if (!ep.glossary.length) return '<div class="card"><p class="muted">這一集沒有 Glossar。</p></div>';
    const src = `DW ${dwDayLabel(ep.id)}`;
    const cards = ep.glossary.map((g) => {
      const de = g.say || dwCleanTerm(g.term);
      const sentence = dwExampleSentence(ep, g);
      const extra = g.term !== de ? `寫法：${g.term}` : '';
      const note = [extra, sentence ? `新聞原句：${sentence}` : ''].filter(Boolean).join(' · ');
      return phraseCard(de, g.definition, note, src, null, { examples: dwGlossExamples(ep, g), meaningLang: 'de' });
    }).join('');
    const nouns = ep.glossary.map((g) => ({ de: dwCleanTerm(g.term), zh: g.definition, example_de: dwExampleSentence(ep, g) }));
    return `<p class="muted small">DW 的 Glossar 用簡單的德文解釋單字。點卡片看解釋，同時加入間隔複習；「分步對話練習」會用新聞原句帶你跟讀和回答。</p>
      <div class="stack">${cards}</div>
      ${artikelQuizButton(nouns, `${ep.title} · 冠詞練習`, `#/dw/${ep.id}`)}
      <button class="btn warm" data-act="dw-game" data-g="match">玩 Glossar 配對遊戲</button>`;
  }

  function dwGamesListHtml(ep, p) {
    const st = p.st;
    const cards = DW.GAME_IDS.map((gid, n) => {
      const items = dwGamesFor(ep)[gid] || [];
      const count = gid === 'match' ? items.reduce((k, r) => k + r.pairs.length, 0) : items.length;
      const info = DW_GAMES[gid];
      if (!count) {
        return `<div class="card step dw-game-card off"><span class="step-n">${n + 1}</span><span class="grow"><h3>${esc(info.de)}</h3>
          <span class="muted small">這一集的內容不夠產生這個遊戲</span></span></div>`;
      }
      const done = st.games[gid];
      return `<button class="card step dw-game-card${done ? ' done' : ''}" data-act="dw-game" data-g="${gid}">
        <span class="step-n">${done ? icon('check', 20) : n + 1}</span>
        <span class="grow"><h3>${esc(info.de)}</h3><span class="muted small">${esc(info.zh)} · ${count} ${gid === 'match' ? '組' : '題'}</span></span>
        ${done ? `<span class="tag good">${esc(done)}</span>` : ''}</button>`;
    }).join('');
    return `<p class="muted small">遊戲從今天的逐字稿和 Glossar 自動產生，題目一整天不變。完成 ${p.need} 個就算達成；每答對一題 +2 XP，第一次完成一個遊戲再 +5 XP。</p>
      <div class="stack dw-games" data-no-auto-speech>${cards}</div>`;
  }

  function dwNewGame(gid, items) {
    const base = { gid, items, i: 0, score: 0, done: false };
    if (gid === 'match') return Object.assign(base, { r: 0, sel: null, matched: {}, wrong: 0, flash: null, total: items.reduce((n, r) => n + r.pairs.length, 0) });
    if (gid === 'cloze') return Object.assign(base, { picked: null, typed: '', mode: ui.dwClozeMode || 'choice', total: items.length });
    if (gid === 'puzzle') return Object.assign(base, { picked: [], state: '', firstTry: true, total: items.length });
    return Object.assign(base, { picked: null, total: items.length });
  }
  function dwFinishGame(g) {
    const ep = dwCurrent();
    if (!ep || g.done) return;
    g.done = true;
    const st = dwState(ep.id);
    const first = !st.games[g.gid];
    const result = `${Math.max(0, g.score)}/${g.total}`;
    if (first || parseInt(result, 10) >= parseInt(st.games[g.gid], 10)) st.games[g.gid] = result;
    if (first) addXp(5);
    markStep('scene');
    dwCheckComplete(ep);
  }
  function dwGameHtml(ep) {
    const g = ui.dwGame;
    const info = DW_GAMES[g.gid];
    const top = `<div class="row" id="dw-game"><button class="back" data-act="dw-game-exit" aria-label="回到遊戲列表">${icon('back', 20)}</button>
      <div class="grow"><h2>${esc(info.de)}</h2><p class="muted small">${esc(info.zh)}</p></div></div>`;
    if (g.done) {
      const p = dwProgress(ep);
      return `${top}<div class="card flash"><div class="flash-de">${g.score} / ${g.total}</div>
        <p class="muted">${p.complete ? '這一集全部完成，+20 XP！' : `遊戲進度 ${p.gamesDone}/${p.need}`}</p></div>
        <div class="btn-row"><button class="btn ghost" data-act="dw-game-again">再玩一次（新題目）</button><button class="btn" data-act="dw-game-exit">回到遊戲列表</button></div>`;
    }
    if (g.gid === 'match') return top + dwMatchHtml(g);
    if (g.gid === 'cloze') return top + dwClozeHtml(g);
    if (g.gid === 'puzzle') return top + dwPuzzleHtml(g);
    return top + dwTrueFalseHtml(g);
  }
  function dwMatchHtml(g) {
    const round = g.items[g.r];
    const pairOf = (id) => round.pairs.find((x) => x.id === id);
    const chips = round.pairs.map((x) => {
      const cls = g.matched[x.id] ? 'dw-chip good used' : g.sel === x.id ? 'dw-chip sel' : 'dw-chip';
      return `<button class="${cls}" data-act="dw-match-term" data-id="${esc(x.id)}" lang="de" ${g.matched[x.id] ? 'disabled' : ''}>${esc(x.say || x.term)}</button>`;
    }).join('');
    const defs = round.defs.map((id) => {
      const x = pairOf(id);
      if (g.matched[id]) return `<div class="opt good"><strong lang="de">${esc(x.say || x.term)}</strong><br><span lang="de">${esc(x.definition)}</span></div>`;
      const bad = g.flash && g.flash.def === id;
      return `<button class="opt${bad ? ' bad' : ''}" data-act="dw-match-def" data-id="${esc(id)}" lang="de">${esc(x.definition)}</button>`;
    }).join('');
    const roundDone = round.pairs.every((x) => g.matched[x.id]);
    const hint = g.flash && g.flash.hint ? '<p class="coach-warning" role="alert">先點上面的一個德文詞，再選它的解釋。</p>' : '';
    return `<p class="muted small">第 ${g.r + 1} / ${g.items.length} 輪 · 點德文詞（會念出來），再點對應的解釋 · 錯 ${g.wrong} 次</p>
      <div class="dw-chips" data-no-auto-speech>${chips}</div>${hint}
      <div class="stack" data-no-auto-speech>${defs}</div>
      ${roundDone ? `<button class="btn" data-act="dw-match-next">${g.r + 1 < g.items.length ? '下一輪' : '看結果'}</button>` : ''}`;
  }
  function dwClozeHtml(g) {
    const it = g.items[g.i];
    const answered = g.picked !== null;
    const right = answered && g.correct;
    const blank = answered ? `<span class="dw-blank ${right ? 'good' : 'bad'}">${esc(it.answer)}</span>` : '<span class="dw-blank">____</span>';
    const parts = [`<p class="muted small">第 ${g.i + 1} 題，共 ${g.total} 題 · <span class="tag">${esc(CLOZE_KIND[it.kind] || '')}</span></p>`,
      `<p class="quiz-q" lang="de" data-no-auto-speech>${esc(it.before)}${blank}${esc(it.after)}</p>`];
    if (it.hint) parts.push(`<p class="muted small"${it.kind === 'glossar' ? ' lang="de" data-no-auto-speech' : ''}>提示：${esc(it.hint)}</p>`);
    if (!answered) {
      parts.push(`<div class="segments" role="group" aria-label="作答方式">
        <button class="seg" data-act="dw-cloze-mode" data-mode="choice" aria-pressed="${g.mode === 'choice'}">選擇</button>
        <button class="seg" data-act="dw-cloze-mode" data-mode="type" aria-pressed="${g.mode === 'type'}">打字</button></div>`);
      if (g.mode === 'choice') {
        parts.push(`<div class="stack" data-no-auto-speech>${it.options.map((o, k) => `<button class="opt" data-act="dw-cloze-pick" data-k="${k}" lang="de">${esc(o)}</button>`).join('')}</div>`);
      } else {
        parts.push(`<form class="stack" data-dw-submit="cloze"><input id="dw-type" class="dw-input" lang="de" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="輸入缺少的字（ä 可打 ae）" aria-label="缺少的字">
          <div class="btn-row"><button class="btn" type="submit">檢查</button><button class="btn ghost" type="button" data-act="dw-cloze-reveal">看答案</button></div></form>`);
      }
    } else {
      const full = it.before + it.answer + it.after;
      const i = put({ de: full });
      const wrongText = g.picked === '' ? '答案是' : `答錯了：你${g.typed ? '寫' : '選'}的是「${esc(g.picked)}」`;
      parts.push(`<div class="card"><p class="verdict ${right ? 'good' : 'bad'}">${right ? '答對了' : wrongText}</p>
        <div class="row"><p class="grow" lang="de" data-no-auto-speech><strong>${esc(full)}</strong></p>
        <button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放整句">${icon('sound', 18)}</button></div></div>
        <button class="btn" data-act="dw-next">${g.i + 1 < g.total ? '下一題' : '看結果'}</button>`);
    }
    return parts.join('');
  }
  function dwPuzzleHtml(g) {
    const it = g.items[g.i];
    const built = g.picked.map((k, n) => `<button class="dw-chip" data-act="dw-puz-remove" data-n="${n}" lang="de" ${g.state ? 'disabled' : ''}>${esc(it.shuffled[k])}</button>`).join('');
    const pool = it.shuffled.map((w, k) => {
      const used = g.picked.includes(k);
      return `<button class="dw-chip${used ? ' used' : ''}" data-act="dw-puz-add" data-k="${k}" lang="de" ${used || g.state ? 'disabled' : ''}>${esc(w)}</button>`;
    }).join('');
    const i = put({ de: it.words.join(' ') });
    let after = '';
    if (g.state === 'good') {
      after = `<div class="card"><p class="verdict good">${g.firstTry ? '完全正確！' : '排好了！'}</p>
        <div class="row"><p class="grow" lang="de" data-no-auto-speech>${esc(it.words.join(' '))}</p><button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放整句">${icon('sound', 18)}</button></div></div>
        <button class="btn" data-act="dw-next">${g.i + 1 < g.total ? '下一句' : '看結果'}</button>`;
    } else if (g.state === 'bad') {
      after = `<div class="card"><p class="verdict bad">順序還不對</p><p class="muted small">再試一次，或看正確句子後繼續。</p></div>
        <div class="btn-row"><button class="btn ghost" data-act="dw-puz-retry">再試一次</button><button class="btn" data-act="dw-puz-show">看答案</button></div>`;
    } else if (g.state === 'shown') {
      after = `<div class="card"><p class="verdict bad">正確句子</p>
        <div class="row"><p class="grow" lang="de" data-no-auto-speech><strong>${esc(it.words.join(' '))}</strong></p><button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放整句">${icon('sound', 18)}</button></div></div>
        <button class="btn" data-act="dw-next">${g.i + 1 < g.total ? '下一句' : '看結果'}</button>`;
    }
    return `<p class="muted small">第 ${g.i + 1} 句，共 ${g.total} 句 · 依序點字，排成新聞裡的原句；點上面的字可以拿回來。</p>
      <div class="dw-build${g.state === 'good' ? ' good' : g.state === 'bad' ? ' bad' : ''}" data-no-auto-speech>${built || '<span class="muted small">從下面選第一個字</span>'}</div>
      <div class="dw-chips" data-no-auto-speech>${pool}</div>${after}`;
  }
  function dwTrueFalseHtml(g) {
    const it = g.items[g.i];
    const answered = g.picked !== null;
    const right = answered && g.picked === it.truth;
    const i = put({ de: it.statement });
    let after = '';
    if (answered) {
      after = `<div class="card"><p class="verdict ${right ? 'good' : 'bad'}">${right ? '答對了' : '答錯了'} · 這句是${it.truth ? 'richtig（和影片一樣）' : 'falsch（被改過）'}</p>
        ${it.truth ? '' : `<p class="muted small">${esc(it.why)}</p><p class="muted small">影片原句：</p><p lang="de"><strong>${esc(it.original)}</strong></p>`}</div>
        <button class="btn" data-act="dw-next">${g.i + 1 < g.total ? '下一題' : '看結果'}</button>`;
    }
    return `<p class="muted small">第 ${g.i + 1} 題，共 ${g.total} 題 · 回想影片內容：這句話對嗎？</p>
      <div class="card"><div class="row"><p class="quiz-q grow" lang="de" data-no-auto-speech>${esc(it.statement)}</p>
        <button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放這句">${icon('sound', 18)}</button></div></div>
      ${answered ? '' : `<div class="tf-row"><button class="btn" data-act="dw-tf" data-v="1">Richtig ✓</button><button class="btn warm" data-act="dw-tf" data-v="0">Falsch ✗</button></div>`}
      ${after}`;
  }
  function dwScrollToGame() {
    const el = document.getElementById('dw-game');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }

  const notFound = () => `${header('找不到這一頁', '', '#/')}<a class="btn" href="#/">回到地圖</a>`;

  // ---------- routing ----------
  // A direct child of #view marked data-keep="key" survives a re-render when the new HTML has the same key.
  // The DW video iframe uses this, so tapping words in the transcript does not restart the video.
  function swapView(html) {
    const keepOld = view.querySelector(':scope > [data-keep]');
    if (keepOld) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const keepNew = [...tpl.content.children].find((el) => el.dataset.keep === keepOld.dataset.keep);
      if (keepNew) {
        [...view.childNodes].forEach((node) => { if (node !== keepOld) node.remove(); });
        while (tpl.content.firstChild && tpl.content.firstChild !== keepNew) view.insertBefore(tpl.content.firstChild, keepOld);
        keepNew.remove();
        view.append(tpl.content);
        return;
      }
    }
    view.innerHTML = html;
  }
  let currentRoute = null;
  function route() { return (location.hash || '#/').replace(/^#/, '') || '/'; }
  function render() {
    const r = route();
    if (r !== currentRoute) { ui = {}; currentRoute = r; window.scrollTo(0, 0); }
    reg = [];
    const seg = r.split('/').filter(Boolean);
    let html;
    if (ui.coach) html = coachView();
    else if (ui.quiz) html = quizView();
    else if (!seg.length) html = homeView();
    else if (seg[0] === 'heute') html = heuteView();
    else if (seg[0] === 'zone') html = zoneView(seg[1]);
    else if (seg[0] === 'news') html = newsView();
    else if (seg[0] === 'friends') html = seg[1] ? episodeView(seg[1]) : friendsView();
    else if (seg[0] === 'movies') html = seg[2] ? movieSceneView(seg[1], seg[2]) : seg[1] ? movieView(seg[1]) : moviesView();
    else if (seg[0] === 'test') html = testView();
    else if (seg[0] === 'fahren') html = driveView();
    else if (seg[0] === 'review') html = reviewView();
    else if (seg[0] === 'dw') html = dwView(seg[1]);
    else html = notFound();
    swapView(html);
    if (window.DQAudio) window.DQAudio.enhance(view);
    renderTabs(seg[0] || '');
  }
  function renderTabs(top) {
    const due = dueCards().length;
    const tabs = [['', '#/', 'map', '地圖'], ['heute', '#/heute', 'sun', '今天'], ['dw', '#/dw', 'play', 'DW'], ['news', '#/news', 'news', '新聞'], ['review', '#/review', 'cards', '複習']];
    const dwNew = dwTodayOpen();
    tabbar.innerHTML = tabs.map(([key, href, ic, label]) => `<a class="tab" href="${href}" ${top === key ? 'aria-current="page"' : ''}>${icon(ic, 22)}<span>${label}</span>${key === 'review' && due ? `<span class="badge" aria-label="${due} 張到期">${due}</span>` : ''}${key === 'dw' && dwNew ? '<span class="badge" aria-label="今天的 DW 新集數還沒完成">新</span>' : ''}</a>`).join('');
  }

  // ---------- actions ----------
  const actions = {
    reveal(el) {
      const item = reg[el.dataset.i];
      ui.open = ui.open || {};
      ui.open[item.de] = !ui.open[item.de];
      if (ui.open[item.de]) { addCard(item.de, item.zh, item.src, item.examples); markStep('scene'); }
      render();
    },
    say(el) { say(reg[el.dataset.i].de); },
    'example-say'(el) {
      const v = reg[el.dataset.i];
      const n = ((ui.exampleCycle || {})[v.de] || 0) % v.examples.length;
      say(v.examples[n].de);
    },
    'example-next'(el) {
      const v = reg[el.dataset.i];
      ui.exampleCycle = ui.exampleCycle || {};
      ui.exampleCycle[v.de] = ((ui.exampleCycle[v.de] || 0) + 1) % v.examples.length;
      render();
    },
    coach(el) {
      const v = reg[el.dataset.i];
      ui.coach = { de: v.de, zh: v.zh, src: v.src, examples: v.examples,
        exampleIndex: ((ui.exampleCycle || {})[v.de] || 0) % v.examples.length,
        scene: 0, stage: 0, draft: '', error: '', reply1: '', reply2: '' };
      render();
      window.scrollTo(0, 0);
    },
    'coach-scene'(el) {
      ui.coach.scene = Number(el.dataset.n);
      ui.coach.stage = 1;
      ui.coach.error = '';
      render();
      say(COACH_SCENES[ui.coach.scene].intro + ' ' + ui.coach.examples[ui.coach.exampleIndex].de);
    },
    'coach-play-intro'() {
      const c = ui.coach;
      say(COACH_SCENES[c.scene].intro + ' ' + c.examples[c.exampleIndex].de);
    },
    'coach-play-example'() {
      const c = ui.coach;
      say(c.examples[c.exampleIndex].de);
    },
    'coach-play-question'() {
      const c = ui.coach;
      const s = COACH_SCENES[c.scene];
      say(c.stage === 4 ? coachFollowup(c) : s.question + ' Versuche dabei „' + c.de + '“ zu benutzen.');
    },
    'coach-mic'() {
      const c = ui.coach;
      if (!window.DQAudio) return;
      window.DQAudio.listen({
        onText(text) {
          if (ui.coach !== c) return;
          c.draft = text;
          c.error = '';
          render();
        }
      });
    },
    async 'coach-record'() {
      const c = ui.coach;
      if (!c || !window.DQAudio) return;
      await window.DQAudio.startRecording((url) => {
        if (ui.coach !== c) {
          URL.revokeObjectURL(url);
          return;
        }
        if (c.recordingUrl) URL.revokeObjectURL(c.recordingUrl);
        c.recordingUrl = url;
        render();
      });
    },
    'coach-record-stop'() {
      if (window.DQAudio) window.DQAudio.stopRecording();
    },
    'coach-next'() {
      const c = ui.coach;
      if (!c) return;
      const field = view.querySelector('.coach-input');
      if (field) c.draft = field.value.trim();
      c.error = '';
      if (c.stage === 1) {
        c.stage = 2; c.draft = '';
      } else if (c.stage === 2) {
        // Shadowing is optional if this browser has no microphone recognition.
        c.repeatText = c.draft;
        c.stage = 3; c.draft = '';
      } else if (c.stage === 3 || c.stage === 4) {
        if (!c.draft) {
          c.error = '先用德文說一句，或在文字框輸入回答。如果無法使用麥克風，可直接打字。';
          render();
          return;
        }
        if (c.stage === 3) {
          c.reply1 = c.draft;
          c.stage = 4;
          c.draft = '';
          render();
          say(coachFollowup(c));
          window.scrollTo(0, 0);
          return;
        }
        c.reply2 = c.draft;
        c.stage = 5;
        c.draft = '';
        markStep('speak');
      }
      render();
      window.scrollTo(0, 0);
    },
    'coach-other'() {
      const c = ui.coach;
      c.scene = (c.scene + 1) % COACH_SCENES.length;
      c.exampleIndex = (c.exampleIndex + 1) % c.examples.length;
      c.stage = 1;
      c.reply1 = ''; c.reply2 = ''; c.repeatText = ''; c.draft = ''; c.error = '';
      render();
      say(COACH_SCENES[c.scene].intro + ' ' + c.examples[c.exampleIndex].de);
      window.scrollTo(0, 0);
    },
    'coach-exit'() {
      if (window.DQAudio) {
        window.DQAudio.stopRecording();
        window.DQAudio.stop();
      }
      if (ui.coach && ui.coach.recordingUrl) URL.revokeObjectURL(ui.coach.recordingUrl);
      ui.coach = null;
      render();
    },

    copy(el) {
      const i = Number(el.dataset.i);
      const text = reg[i].text;
      const done = (state) => { ui.copied = i; ui.copyState = state; if (state === 'ok') markStep('speak'); render(); };
      try {
        navigator.clipboard.writeText(text).then(() => done('ok'), () => done('fail'));
      } catch (err) { done('fail'); }
    },
    'news-open'() { markStep('news'); renderTabs('news'); },
    season(el) { ui.season = Number(el.dataset.s); render(); },
    summary() { ui.summary = !ui.summary; render(); },
    hint(el) { ui.hint = ui.hint || {}; ui.hint[el.dataset.n] = !ui.hint[el.dataset.n]; render(); },
    watch(el) { S.watched[el.dataset.id] = dayKey(); addXp(15); markStep('scene'); render(); },
    unwatch(el) { delete S.watched[el.dataset.id]; save(); render(); },
    drill(el) {
      const id = el.dataset.id;
      const items = DATA.cards.episodes[id].drill.map((d) => {
        const tail = d[1] === '.' || d[1] === '?' ? d[1] : ` ${d[1]}`;
        return {
          q: `${d[0]} ____${tail}`, qLang: 'de', sub: d[4], optLang: 'de',
          reveal: `${d[0]} ${d[2][d[3]]}${tail}`,
          opts: d[2].map((t, k) => ({ t, ok: k === d[3] })),
        };
      });
      startQuiz(`${id} · 句子填空`, items, `#/friends/${id}`);
    },
    'artikel-quiz'(el) {
      const data = reg[el.dataset.i];
      if (!data) return;
      const items = shuffle(data.nouns).map((v) => {
        const parsed = splitArtikel(v.de);
        return {
          q: `____ ${parsed.rest}`, qLang: 'de', sub: v.zh, optLang: 'de', noAutoSpeech: true,
          reveal: `${parsed.art} ${parsed.rest}`, sayOnPick: true,
          why: v.example_de ? `${v.example_de}${v.example_zh ? `（${v.example_zh}）` : ''}` : '',
          opts: ARTIKEL.map((t) => ({ t, ok: t === parsed.art })),
        };
      });
      startQuiz(data.title, items, data.backHref);
    },
    'zone-quiz'(el) {
      const z = DATA.life.find((x) => x.id === el.dataset.id);
      startQuiz(`${z.de} · 聽力`, listenItems(z.phrases, 5), `#/zone/${z.id}`);
    },
    test(el) {
      const mode = el.dataset.mode;
      startQuiz('Einbürgerungstest', testItems(mode), '#/test', mode === 'all' ? 'test' : '');
    },
    'drive-quiz'(el) {
      const pairs = DATA.drive.groups.filter((g) => g.id !== 'antworten').flatMap((g) => g.items);
      const n = Number(el.dataset.n);
      startQuiz('Fahrprüfung · 聽指令', listenItems(pairs, n), '#/fahren', n >= 15 ? 'drive' : '');
    },
    'quiz-say'() { say(ui.quiz.items[ui.quiz.i].say); },
    'quiz-pick'(el) {
      const q = ui.quiz;
      if (q.picked !== null) return;
      q.picked = Number(el.dataset.k);
      const item = q.items[q.i];
      if (item.opts[q.picked].ok) { q.score += 1; addXp(2); }
      render();
      if (item.sayOnPick && item.reveal) say(item.reveal);
    },
    'quiz-next'() {
      const q = ui.quiz;
      if (q.i + 1 < q.items.length) {
        q.i += 1; q.picked = null; render(); window.scrollTo(0, 0);
        if (q.items[q.i].say) say(q.items[q.i].say);
      } else {
        q.done = true;
        markStep('scene');
        if (q.bestKey) {
          const prev = parseInt(S.best[q.bestKey], 10) || 0;
          if (q.score >= prev) { S.best[q.bestKey] = `${q.score}/${q.items.length}`; save(); }
        }
        render(); window.scrollTo(0, 0);
      }
    },
    'quiz-exit'() { ui.quiz = null; render(); },
    'review-artikel'(el) {
      if (!ui.queue || !ui.queue.length || ui.artikelPicked) return;
      const de = ui.queue[0];
      ui.artikelPicked = el.dataset.art;
      render();
      say(de);
    },
    flip() { ui.shown = true; render(); },
    grade(el) {
      const de = ui.queue.shift();
      const c = S.cards[de];
      if (el.dataset.ok === '1') {
        c.box = Math.min(c.box + 1, INTERVALS.length - 1);
        c.due = addDays(INTERVALS[c.box]);
        addXp(2);
      } else {
        c.box = 0; c.due = dayKey();
        if (!ui.again[de]) { ui.again[de] = true; ui.queue.push(de); } // one more try this session
      }
      ui.reviewed += 1; ui.shown = false; ui.artikelPicked = null; save(); render();
    },

    // ---- DW Kurz und leicht
    'dw-tab'(el) {
      ui.dwTab = el.dataset.tab; ui.dwGame = null; ui.dwLookup = null; render();
      const tabs = view.querySelector('[role="tablist"]');
      if (tabs && tabs.scrollIntoView && el.dataset.tab !== 'watch') tabs.scrollIntoView({ block: 'start' });
    },
    'dw-mark'(el) { const ep = dwCurrent(); if (ep) { dwMark(ep, el.dataset.key); render(); } },
    'dw-unmark'(el) {
      const ep = dwCurrent();
      if (!ep) return;
      const st = dwState(ep.id);
      delete st[el.dataset.key];
      if (st.done && !dwProgress(ep).complete) {
        if (S.dwDays[st.done] === ep.id) delete S.dwDays[st.done];
        delete st.done;
      }
      save(); render();
    },
    'dw-artikel'() { S.dwArtikel = !S.dwArtikel; save(); render(); },
    'dw-word'(el) {
      const k = Number(el.dataset.k);
      const same = ui.dwLookup && ui.dwLookup.sid === el.dataset.s && ui.dwLookup.k === k;
      ui.dwLookup = same ? null : { sid: el.dataset.s, k };
      render();
    },
    'dw-say'(el) {
      const ep = dwCurrent();
      const s = ep && dwSentences(ep).find((x) => x.id === el.dataset.s);
      if (s) say(s.de);
    },
    'dw-say-reg'(el) { const item = reg[el.dataset.i]; if (item) say(item.say || item.de); },
    'dw-add'(el) {
      const item = reg[el.dataset.i];
      if (!item) return;
      addCard(item.de, item.zh, item.src, item.examples);
      markStep('scene');
      render();
    },
    'dw-game'(el) {
      const ep = dwCurrent();
      if (!ep) return;
      const items = dwGamesFor(ep)[el.dataset.g] || [];
      if (!items.length) return;
      ui.dwTab = 'games';
      ui.dwGame = dwNewGame(el.dataset.g, items);
      render(); dwScrollToGame();
    },
    'dw-game-exit'() { ui.dwGame = null; render(); },
    'dw-game-again'() {
      const ep = dwCurrent();
      if (!ep || !ui.dwGame) return;
      const gid = ui.dwGame.gid;
      const fresh = DW.buildGames(ep, `${ep.id}:${Date.now()}`)[gid];
      ui.dwGame = dwNewGame(gid, fresh && fresh.length ? fresh : ui.dwGame.items);
      render(); dwScrollToGame();
    },
    'dw-match-term'(el) {
      const g = ui.dwGame;
      g.sel = el.dataset.id; g.flash = null;
      const pair = g.items[g.r].pairs.find((x) => x.id === g.sel);
      render();
      if (pair) say(pair.say || pair.term);
    },
    'dw-match-def'(el) {
      const g = ui.dwGame;
      if (!g.sel) { g.flash = { hint: true }; render(); return; }
      if (g.sel === el.dataset.id) { g.matched[g.sel] = true; g.score += 1; addXp(2); g.flash = null; }
      else { g.wrong += 1; g.flash = { def: el.dataset.id }; }
      g.sel = null;
      render();
    },
    'dw-match-next'() {
      const g = ui.dwGame;
      if (g.r + 1 < g.items.length) { g.r += 1; g.sel = null; g.flash = null; render(); dwScrollToGame(); return; }
      g.score = Math.max(0, g.total - g.wrong);
      dwFinishGame(g); render(); dwScrollToGame();
    },
    'dw-cloze-mode'(el) { ui.dwClozeMode = el.dataset.mode; ui.dwGame.mode = el.dataset.mode; render(); const f = view.querySelector('#dw-type'); if (f) f.focus(); },
    'dw-cloze-pick'(el) {
      const g = ui.dwGame;
      if (g.picked !== null) return;
      const it = g.items[g.i];
      g.picked = it.options[Number(el.dataset.k)];
      g.typed = false;
      g.correct = g.picked.toLowerCase() === it.answer.toLowerCase();
      if (g.correct) { g.score += 1; addXp(2); }
      render();
      say(it.before + it.answer + it.after);
    },
    'dw-cloze-reveal'() { const g = ui.dwGame; g.picked = ''; g.correct = false; render(); },
    'dw-next'() {
      const g = ui.dwGame;
      if (g.i + 1 < g.items.length) {
        g.i += 1; g.picked = null; g.correct = false; g.state = ''; g.firstTry = true; if (g.gid === 'puzzle') g.picked = [];
        render(); dwScrollToGame();
        if (g.gid === 'cloze' && g.mode === 'type') { const f = view.querySelector('#dw-type'); if (f) f.focus(); }
        return;
      }
      dwFinishGame(g); render(); dwScrollToGame();
    },
    'dw-puz-add'(el) {
      const g = ui.dwGame;
      const it = g.items[g.i];
      const k = Number(el.dataset.k);
      if (g.state || g.picked.includes(k)) return;
      g.picked.push(k);
      if (g.picked.length === it.shuffled.length) {
        const ok = DW.puzzleSolved(it, g.picked.map((n) => it.shuffled[n]));
        g.state = ok ? 'good' : 'bad';
        if (ok) { if (g.firstTry) { g.score += 1; addXp(2); } render(); say(it.words.join(' ')); return; }
      }
      render();
    },
    'dw-puz-remove'(el) { const g = ui.dwGame; if (g.state) return; g.picked.splice(Number(el.dataset.n), 1); render(); },
    'dw-puz-retry'() { const g = ui.dwGame; g.picked = []; g.state = ''; g.firstTry = false; render(); },
    'dw-puz-show'() { const g = ui.dwGame; g.state = 'shown'; g.firstTry = false; render(); say(g.items[g.i].words.join(' ')); },
    'dw-tf'(el) {
      const g = ui.dwGame;
      if (g.picked !== null) return;
      g.picked = el.dataset.v === '1';
      if (g.picked === g.items[g.i].truth) { g.score += 1; addXp(2); }
      render();
    },
  };
  // Typed Lückentext answers (Enter on the phone keyboard submits the form).
  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-dw-submit]');
    if (!form) return;
    ev.preventDefault();
    const g = ui.dwGame;
    if (!g || g.gid !== 'cloze' || g.picked !== null) return;
    const field = form.querySelector('#dw-type');
    const value = field ? field.value.trim() : '';
    if (!value) { if (field) field.focus(); return; }
    const it = g.items[g.i];
    g.picked = value;
    g.typed = true;
    g.correct = DW.checkTyped(value, it.answer);
    if (g.correct) { g.score += 1; addXp(2); }
    render();
    say(it.before + it.answer + it.after);
  });
  // "Older episodes" picker on the DW page.
  document.addEventListener('change', (ev) => {
    if (ev.target.matches && ev.target.matches('[data-dw-pick]') && ev.target.value) location.hash = `#/dw/${ev.target.value}`;
  });
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'A') ev.preventDefault();
    fn(el);
  });
  window.addEventListener('hashchange', render);

  // A back link inside a quiz should leave the quiz, even when the hash does not change.
  document.addEventListener('click', (ev) => {
    if (ui.quiz && ev.target.closest('a.back')) { ui.quiz = null; setTimeout(render, 0); }
  }, true);

  loadData().then(render);
})();
