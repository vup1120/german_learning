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
  };
  const icon = (name, size = 24) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

  // ---------- saved progress ----------
  const STORE_KEY = 'deutschquest.v1';
  const INTERVALS = [0, 1, 3, 7, 14, 30]; // days until a card comes back, by box
  const STEPS = ['review', 'news', 'scene', 'speak'];
  function load() {
    const blank = { xp: 0, streak: 0, lastDay: '', days: {}, cards: {}, watched: {}, best: {} };
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
  function addCard(de, zh, src) {
    if (!de || S.cards[de]) return;
    S.cards[de] = { zh: zh || '', src: src || '', box: 0, due: dayKey() };
    save();
  }
  const dueCards = () => Object.keys(S.cards).filter((de) => S.cards[de].due <= dayKey());

  // ---------- speech ----------
  function say(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE';
      u.rate = 0.9;
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('de'));
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    } catch (err) { /* no voice available */ }
  }

  // ---------- data ----------
  const DATA = { life: [], test: { questions: [], vocab: [] }, drive: { groups: [] }, cards: { episodes: {} }, friends: { episodes: [], lessons: {}, dialogues: {}, subtitled: [] }, news: { groups: [], updated: '' } };
  async function getJson(path, fallback) {
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (err) { return fallback; }
  }
  async function loadData() {
    const [life, test, drive, cards, friends, news] = await Promise.all([
      getJson('content/life.json', DATA.life),
      getJson('content/einbuergerung.json', DATA.test),
      getJson('content/fahrpruefung.json', DATA.drive),
      getJson('content/friends_cards.json', DATA.cards),
      getJson('data/friends.json', DATA.friends),
      getJson('data/news.json', DATA.news),
    ]);
    Object.assign(DATA, { life, test, drive, cards, friends, news });
  }

  // ---------- per-render registry (keeps data out of HTML attributes) ----------
  let reg = [];
  const put = (value) => reg.push(value) - 1;
  let ui = {}; // state of the current screen; cleared when the route changes

  // ---------- shared pieces ----------
  function header(title, sub, backHref) {
    return `<div class="topbar">
      ${backHref ? `<a class="back" href="${backHref}" aria-label="返回">${icon('back', 20)}</a>` : ''}
      <div class="grow"><h1>${esc(title)}</h1>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}</div>
    </div>`;
  }
  function phraseCard(de, zh, note, src) {
    const open = !!(ui.open && ui.open[de]);
    const i = put({ de, zh, src });
    return `<div class="card phrase"><div class="phrase-wrap">
      <button class="phrase-main grow" data-act="reveal" data-i="${i}" aria-expanded="${open}">
        <span class="grow">
          <span class="phrase-de" lang="de">${esc(de)}</span>
          ${open ? `<div class="phrase-zh">${esc(zh)}</div>${note ? `<div class="phrase-note">${esc(note)}</div>` : ''}`
                 : '<div class="phrase-hint">點一下看中文，並加入複習</div>'}
        </span>
      </button>
      <div class="phrase-side"><button class="icon-btn" data-act="say" data-i="${i}" aria-label="播放德文發音">${icon('sound', 20)}</button></div>
    </div></div>`;
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
      return `<button class="${cls}" data-act="quiz-pick" data-k="${k}" ${answered ? 'disabled' : ''} ${it.optLang ? `lang="${it.optLang}"` : ''}>${esc(o.t)}</button>`;
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
    const watched = Object.keys(S.watched).length;
    const nx = nextEpisode();
    return `<div class="row"><div class="grow"><h1 lang="de">Deutsch-Quest</h1><p class="muted small">等級 ${level} · 共 ${S.xp} XP</p></div>
        <span class="pill">連續 ${S.streak} 天</span></div>
      <div class="xp"><div class="xp-track"><div class="xp-fill" style="width:${Math.max(4, inLevel)}%"></div></div><span class="muted small">${inLevel} / 100</span></div>
      <a class="btn" href="#/heute">開始今天的任務 · 約 15 分鐘</a>
      <h2>生活地圖</h2>
      <div class="stack">${life}</div>
      <h2>支線與考試</h2>
      <div class="stack">
        ${zone('#/friends', 'cup', 'Central Perk', `Friends 追劇 · 完整教案 ${Object.keys(DATA.friends.lessons || {}).length} 集`, `${watched} / ${DATA.friends.episodes.length || 236}`, 'night')}
        ${zone('#/news', 'news', 'Nachrichten', '德國與慕尼黑每日新聞', '每日更新')}
        ${zone('#/test', 'scale', 'Einbürgerungstest', '入籍考試 · 價值與憲政', S.best.test ? `最佳 ${S.best.test}` : `${DATA.test.questions.length} 題`)}
        ${zone('#/fahren', 'car', 'Fahrprüfung', '路考 · 聽懂考官指令', S.best.drive ? `最佳 ${S.best.drive}` : '聽力練習')}
      </div>`;
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
    return `${header('Heute', '四步驟，約 15 分鐘，做完就結束')}
      <div class="stack">${html}</div>
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
    return `${header('Nachrichten', updated ? `更新於 ${updated} · 共 ${total} 則` : '德國與慕尼黑每日新聞')}
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
    return `${header('Central Perk', `Friends 追劇夥伴 · 已看 ${Object.keys(S.watched).length} 集 · 完整教案 ${lessonEps.length} 集`, '#/')}
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

    parts.push('<h2>詞彙</h2><div class="stack">' + vocab.map((v) => phraseCard(v.de, v.zh, v.example_de ? `${v.example_de}（${v.example_zh || ''}）` : '', src)).join('') + '</div>');
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
    const i = put({ de });
    return `${header('Wiederholen', `還剩 ${ui.queue.length} 張`)}
      <div class="card flash">
        ${c.src ? `<span class="tag" style="align-self:center">${esc(c.src)}</span>` : ''}
        <div class="flash-de" lang="de">${esc(de)}</div>
        <button class="icon-btn" style="align-self:center" data-act="say" data-i="${i}" aria-label="播放德文發音">${icon('sound', 20)}</button>
        ${ui.shown ? `<p>${esc(c.zh)}</p>` : '<p class="muted small">先在心裡說出意思，再翻面。</p>'}
      </div>
      ${ui.shown
        ? '<div class="btn-row"><button class="btn ghost" data-act="grade" data-ok="0">還不熟</button><button class="btn" data-act="grade" data-ok="1">記得</button></div>'
        : '<button class="btn" data-act="flip">顯示中文</button>'}`;
  }

  const notFound = () => `${header('找不到這一頁', '', '#/')}<a class="btn" href="#/">回到地圖</a>`;

  // ---------- routing ----------
  let currentRoute = null;
  function route() { return (location.hash || '#/').replace(/^#/, '') || '/'; }
  function render() {
    const r = route();
    if (r !== currentRoute) { ui = {}; currentRoute = r; window.scrollTo(0, 0); }
    reg = [];
    const seg = r.split('/').filter(Boolean);
    let html;
    if (ui.quiz) html = quizView();
    else if (!seg.length) html = homeView();
    else if (seg[0] === 'heute') html = heuteView();
    else if (seg[0] === 'zone') html = zoneView(seg[1]);
    else if (seg[0] === 'news') html = newsView();
    else if (seg[0] === 'friends') html = seg[1] ? episodeView(seg[1]) : friendsView();
    else if (seg[0] === 'test') html = testView();
    else if (seg[0] === 'fahren') html = driveView();
    else if (seg[0] === 'review') html = reviewView();
    else html = notFound();
    view.innerHTML = html;
    renderTabs(seg[0] || '');
  }
  function renderTabs(top) {
    const due = dueCards().length;
    const tabs = [['', '#/', 'map', '地圖'], ['heute', '#/heute', 'sun', '今天'], ['news', '#/news', 'news', '新聞'], ['review', '#/review', 'cards', '複習']];
    tabbar.innerHTML = tabs.map(([key, href, ic, label]) => `<a class="tab" href="${href}" ${top === key ? 'aria-current="page"' : ''}>${icon(ic, 22)}<span>${label}</span>${key === 'review' && due ? `<span class="badge" aria-label="${due} 張到期">${due}</span>` : ''}</a>`).join('');
  }

  // ---------- actions ----------
  const actions = {
    reveal(el) {
      const item = reg[el.dataset.i];
      ui.open = ui.open || {};
      ui.open[item.de] = !ui.open[item.de];
      if (ui.open[item.de]) { addCard(item.de, item.zh, item.src); markStep('scene'); }
      render();
    },
    say(el) { say(reg[el.dataset.i].de); },
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
      if (q.items[q.i].opts[q.picked].ok) { q.score += 1; addXp(2); }
      render();
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
      ui.reviewed += 1; ui.shown = false; save(); render();
    },
  };
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
