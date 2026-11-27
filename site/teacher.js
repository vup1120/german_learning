/* Deutsch-Quest · AI teacher: spoken German conversations with Gemini Live, inside the site.
 *
 * The Gemini API key is stored only in this browser (localStorage). It is never part of the
 * repository or the published site. Audio: microphone -> 16 kHz 16-bit PCM -> Live API;
 * the teacher's voice comes back as 24 kHz PCM and is played with Web Audio.
 * Pure helpers are exported for tests/test_teacher.js; the browser uses window.DQTeacher. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DQTeacher = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const STORE_KEY = 'deutschquest.ai.v1';
  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  const REST = 'https://generativelanguage.googleapis.com/v1beta';
  // Preferred Live models, newest first. The key's own model list (testKey) decides when available.
  const LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025'];
  const TEXT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];
  const VOICES = [
    ['Kore', '女聲 · 沉穩'], ['Aoede', '女聲 · 輕快'], ['Leda', '女聲 · 年輕'], ['Zephyr', '女聲 · 明亮'],
    ['Puck', '男聲 · 活潑'], ['Charon', '男聲 · 低沉'], ['Fenrir', '男聲 · 有精神'], ['Orus', '男聲 · 穩重'],
  ];
  const IN_RATE = 16000;
  const OUT_RATE = 24000;
  const SEND_SAMPLES = 1600; // 100 ms per message
  const MAX_SESSION_MS = 14.5 * 60 * 1000; // audio-only Live sessions end after 15 minutes
  const DEFAULTS = { key: '', liveModel: '', textModel: '', voice: 'Kore', pauseMs: 1500, speakerMode: true, shape: '' };

  const BASE_INSTRUCTION = [
    'Du bist eine warmherzige, geduldige Deutschlehrerin und Gesprächspartnerin.',
    'Du sprichst mit einer Person, die in München lebt, Traditionelles Chinesisch als Muttersprache spricht und Deutsch auf B1-Niveau lernt –',
    'vor allem für den Alltag: Nachbarn, Kita und Schule des Kindes, andere Eltern, Behörden und kleine Konflikte.',
    'Regeln:',
    '- Sprich ausschließlich Deutsch, natürlich und in normalem Tempo, aber mit klaren, einfachen Sätzen.',
    '- Halte deine Beiträge kurz (zwei bis drei Sätze) und stelle fast immer eine Frage zurück, damit sie viel spricht.',
    '- Wenn sie etwas nicht versteht oder Chinesisch benutzt, erkläre es einfacher auf Deutsch. Nur im Notfall ein einzelnes chinesisches Wort.',
    '- Unterbrich sie nicht, wenn sie nach Worten sucht.',
    '- Korrigiere nicht jeden Fehler sofort. Nur wenn ein Fehler das Verstehen stört, wiederhole ihren Satz kurz richtig und mach weiter.',
    '- Wenn sie um Feedback bittet oder sich verabschiedet: nenne einen wichtigen Grammatikfehler mit Korrektur, eine natürlichere Formulierung und einen Aussprache-Tipp.',
    '- Beginne selbst mit dem Gespräch, sobald sie „Hallo“ sagt.',
  ].join('\n');
  const KICKOFF = 'Hallo! Ich bin bereit. Bitte fang an.';
  const FEEDBACK = 'Bitte gib mir jetzt Feedback zu meinem Deutsch: einen wichtigen Grammatikfehler mit Korrektur, eine natürlichere Formulierung und einen Aussprache-Tipp. Danach können wir weitersprechen.';

  // ---------- settings (this browser only) ----------
  function storage() {
    try { return root && root.localStorage ? root.localStorage : null; } catch (_) { return null; }
  }
  function loadSettings(store = storage()) {
    try {
      const raw = store && store.getItem(STORE_KEY);
      return Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {});
    } catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(patch, store = storage()) {
    const next = Object.assign(loadSettings(store), patch || {});
    try { if (store) store.setItem(STORE_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
    return next;
  }
  function forgetKey(store = storage()) {
    return saveSettings({ key: '', liveModel: '', textModel: '', shape: '' }, store);
  }
  const instruction = (task) => `${BASE_INSTRUCTION}\n\nThema und Ablauf dieses Gesprächs:\n${task || 'Freies Alltagsgespräch.'}`;

  // ---------- models ----------
  const bare = (name) => String(name || '').replace(/^models\//, '');
  function versionOf(name) {
    const m = bare(name).match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  }
  const isPreview = (name) => /preview|exp/i.test(name);
  /** Newest generally-available Live (audio) model the key can use, or ''. */
  function pickLiveModel(models) {
    const names = (models || [])
      .filter((m) => (m.supportedGenerationMethods || []).some((x) => /bidi/i.test(x)))
      .map((m) => bare(m.name))
      .filter((n) => /live|native-audio/i.test(n) && !/translate|tts/i.test(n));
    if (!names.length) return '';
    names.sort((a, b) => (isPreview(a) - isPreview(b)) || (versionOf(b) - versionOf(a)) || a.localeCompare(b));
    return names[0];
  }
  /** A fast text model for translations: the "flash-latest" alias, else the newest plain Flash model. */
  function pickTextModel(models) {
    const names = (models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => bare(m.name));
    if (names.includes('gemini-flash-latest')) return 'gemini-flash-latest';
    const flash = names.filter((n) => /^gemini-\d+(?:\.\d+)?-flash$/.test(n)).sort((a, b) => versionOf(b) - versionOf(a));
    return flash[0] || '';
  }
  /** Model × message-shape combinations to try, the last working one first. */
  function attempts(settings) {
    const models = [...new Set([settings.liveModel, ...LIVE_MODELS].filter(Boolean))];
    const shapes = settings.shape ? [settings.shape, settings.shape === 'flat' ? 'nested' : 'flat'] : ['nested', 'flat'];
    const list = [];
    for (const model of models) for (const shape of shapes) list.push({ model, shape });
    return list.slice(0, 6);
  }
  /**
   * First message of a session. The API reference nests voice and modality in generationConfig
   * ("nested"); newer guides put them directly in setup ("flat"). Both are tried.
   */
  function setupMessage(model, shape, systemText, settings) {
    const speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice || 'Kore' } } };
    const setup = {
      model: `models/${bare(model)}`,
      systemInstruction: { parts: [{ text: systemText }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          prefixPaddingMs: 200,
          silenceDurationMs: Math.max(500, Number(settings.pauseMs) || 1500), // learners pause to think
        },
      },
    };
    if (shape === 'flat') Object.assign(setup, { responseModalities: ['AUDIO'], speechConfig });
    else setup.generationConfig = { responseModalities: ['AUDIO'], speechConfig };
    return { setup };
  }

  // ---------- audio helpers ----------
  /** Streaming linear resampler (e.g. 48 kHz microphone -> 16 kHz). Keeps state between chunks. */
  function makeResampler(inRate, outRate) {
    const step = inRate / outRate;
    let t = 0;
    let prev = 0;
    return function resample(input) {
      const out = [];
      while (t < input.length - 1) {
        const i = Math.floor(t);
        const a = i < 0 ? prev : input[i];
        const b = input[i + 1];
        out.push(a + (b - a) * (t - i));
        t += step;
      }
      t -= input.length;
      if (input.length) prev = input[input.length - 1];
      return Float32Array.from(out);
    };
  }
  function floatToPcm16(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  }
  function bytesToBase64(bytes) {
    if (typeof Buffer !== 'undefined' && !root.btoa) return Buffer.from(bytes).toString('base64');
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(s);
  }
  function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined' && !root.atob) return new Uint8Array(Buffer.from(b64, 'base64'));
    const s = root.atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function pcm16ToBase64(int16) {
    const bytes = new Uint8Array(int16.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < int16.length; i++) view.setInt16(i * 2, int16[i], true);
    return bytesToBase64(bytes);
  }
  function base64ToFloat(b64) {
    const bytes = base64ToBytes(b64);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(Math.floor(bytes.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
    return out;
  }
  const WORKLET = `class DQCapture extends AudioWorkletProcessor {
    process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
  }
  registerProcessor('dq-capture', DQCapture);`;

  // ---------- conversation log ----------
  /** Add an incremental transcript chunk. Same speaker and open entry: append; otherwise start a new entry. */
  function addTranscript(log, role, text) {
    if (!text) return log;
    const last = log[log.length - 1];
    if (last && last.role === role && !last.done) last.text += text;
    else {
      if (last && !last.done) last.done = true;
      log.push({ role, text, done: false });
    }
    return log;
  }
  function closeEntries(log, role) {
    for (const entry of log) if (!entry.done && (!role || entry.role === role)) entry.done = true;
    return log;
  }
  const tidy = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  // ---------- REST: key check and on-demand translation ----------
  async function errorText(res) {
    try {
      const j = await res.json();
      return (j.error && (j.error.message || j.error.status)) || `HTTP ${res.status}`;
    } catch (_) { return `HTTP ${res.status}`; }
  }
  async function listModels(key, fetchFn = root.fetch && root.fetch.bind(root)) {
    const res = await fetchFn(`${REST}/models?pageSize=1000&key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    return data.models || [];
  }
  /** Check a key and choose models. Resolves {ok, liveModel, textModel, message}. */
  async function testKey(key, fetchFn) {
    const clean = String(key || '').trim();
    if (!clean) return { ok: false, message: '請先貼上 API key。' };
    try {
      const models = await listModels(clean, fetchFn);
      const liveModel = pickLiveModel(models) || LIVE_MODELS[0];
      const textModel = pickTextModel(models) || TEXT_MODELS[0];
      return { ok: true, liveModel, textModel, message: `可以使用了 · 對話模型 ${liveModel}` };
    } catch (err) {
      return { ok: false, message: `這把 key 不能用：${err.message || err}` };
    }
  }
  async function generateJson(prompt, settings, fetchFn = root.fetch && root.fetch.bind(root)) {
    const models = [...new Set([settings.textModel, ...TEXT_MODELS].filter(Boolean))];
    let lastError = '';
    for (const model of models) {
      const res = await fetchFn(`${REST}/models/${model}:generateContent?key=${encodeURIComponent(settings.key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
      });
      if (!res.ok) { lastError = await errorText(res); if (res.status === 404 || res.status === 400) continue; break; }
      const data = await res.json();
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.map((p) => p.text || '').join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return JSON.parse(text);
    }
    throw new Error(lastError || 'no model');
  }
  /** Chinese meaning of one transcript sentence and its words: {zh, words: {index: {l, zh}}}. */
  async function translateSentence(sentence, words, settings = loadSettings(), fetchFn) {
    const numbered = words.map((w, i) => `${i}=${w}`).join(' ');
    const prompt = [
      'Übersetze diesen deutschen Satz aus den DW-Nachrichten natürlich ins Traditionelle Chinesisch (Taiwan, 繁體中文).',
      'Gib außerdem für jedes nummerierte Wort: die Grundform (Nomen mit Artikel im Singular, z. B. „die Waffenruhe“;',
      'Verben im Infinitiv, trennbare Verben mit |, z. B. „aus|fallen“, auch wenn die Teile im Satz getrennt stehen)',
      'und eine kurze chinesische Bedeutung in diesem Satz.',
      'Antworte nur mit JSON: {"zh": "...", "words": [{"i": 0, "lemma": "...", "zh": "..."}]}',
      `Satz: ${sentence}`,
      `Wörter: ${numbered}`,
    ].join('\n');
    const data = await generateJson(prompt, settings, fetchFn);
    const out = { zh: tidy(data.zh), words: {} };
    for (const w of data.words || []) {
      const i = Number(w.i);
      if (Number.isInteger(i) && i >= 0 && i < words.length && w.lemma && w.zh) out.words[i] = { l: tidy(w.lemma), zh: tidy(w.zh) };
    }
    if (!out.zh) throw new Error('empty translation');
    return out;
  }

  // ---------- live session ----------
  function defaultDeps() {
    return {
      WebSocket: root.WebSocket,
      AudioContext: root.AudioContext || root.webkitAudioContext,
      getUserMedia: (c) => root.navigator.mediaDevices.getUserMedia(c),
      setTimeout: (f, ms) => root.setTimeout(f, ms),
      clearTimeout: (id) => root.clearTimeout(id),
      now: () => Date.now(),
      Blob: root.Blob,
      URL: root.URL,
    };
  }

  /**
   * One spoken conversation. Call start() directly inside a click handler (browsers only allow
   * audio and microphone after a user gesture). Events go to onEvent:
   *   {type: 'status', state: 'connecting'|'listening'|'speaking'|'closed'|'error', message}
   *   {type: 'log', log}   {type: 'userTurn', count}   {type: 'connected', model, shape}
   */
  function Session(opts, deps) {
    this.opts = opts || {};
    this.deps = Object.assign(defaultDeps(), deps || {});
    this.settings = Object.assign({}, DEFAULTS, this.opts.settings || loadSettings());
    this.onEvent = this.opts.onEvent || function () {};
    this.log = [];
    this.state = 'idle';
    this.userTurns = 0;
    this.sources = new Set();
    this.playHead = 0;
    this.gateUntil = 0;
    this.pending = [];
    this.pendingCount = 0;
    this.closed = false;
  }
  Session.prototype.emit = function (ev) { try { this.onEvent(ev); } catch (_) { /* UI errors must not stop audio */ } };
  Session.prototype.setState = function (state, message) {
    this.state = state;
    this.emit({ type: 'status', state, message: message || '' });
  };
  Session.prototype.start = function () {
    const D = this.deps;
    if (!this.settings.key) { this.setState('error', '還沒有設定 Gemini API key。'); return this; }
    if (!D.WebSocket) { this.setState('error', '這個瀏覽器不支援即時連線（WebSocket）。'); return this; }
    try {
      this.ctx = D.AudioContext ? new D.AudioContext() : null;
      if (this.ctx && this.ctx.resume) this.ctx.resume();
    } catch (_) { this.ctx = null; }
    this.micPromise = D.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
      .catch((err) => { this.micError = err; return null; });
    this.startedAt = D.now();
    this.setState('connecting', '連線中…');
    this.connect();
    return this;
  };
  Session.prototype.connect = async function () {
    const tries = attempts(this.settings);
    let lastReason = '';
    for (const attempt of tries) {
      if (this.closed) return;
      const result = await this.trySocket(attempt);
      if (result.ok) {
        this.model = attempt.model;
        this.emit({ type: 'connected', model: attempt.model, shape: attempt.shape });
        if (!this.opts.settings) saveSettings({ liveModel: attempt.model, shape: attempt.shape });
        await this.afterSetup();
        return;
      }
      lastReason = result.reason || lastReason;
      if (/api key|permission|unauthenticated|quota|billing|exhausted/i.test(lastReason)) break;
    }
    if (!this.closed) {
      this.setState('error', `連不上 Gemini：${lastReason || '請檢查網路和 API key'}`);
      this.cleanup();
    }
  };
  Session.prototype.trySocket = function (attempt) {
    const D = this.deps;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
      let ws;
      try {
        ws = new D.WebSocket(`${WS_URL}?key=${encodeURIComponent(this.settings.key)}`);
      } catch (err) { finish({ ok: false, reason: String(err && err.message || err) }); return; }
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify(setupMessage(attempt.model, attempt.shape, this.opts.instruction || instruction(''), this.settings)));
      let queue = Promise.resolve();
      ws.onmessage = (ev) => {
        // Binary frames are read asynchronously; chain them so audio chunks keep their order.
        queue = queue.then(() => this.parse(ev.data)).then((msg) => {
          if (!msg || ws !== this.ws) return;
          if (!settled && msg.setupComplete) { finish({ ok: true }); return; }
          if (settled) this.handle(msg);
        });
      };
      ws.onerror = () => { /* the close event carries the reason */ };
      ws.onclose = (ev) => {
        if (!settled) { finish({ ok: false, reason: (ev && ev.reason) || `code ${ev && ev.code}` }); return; }
        if (!this.closed) {
          const reason = ev && ev.reason ? `（${ev.reason}）` : '';
          this.setState('closed', `對話結束了${reason}。按麥克風可以再聊一次。`);
          this.cleanup();
        }
      };
    });
  };
  Session.prototype.parse = async function (data) {
    try {
      if (typeof data === 'string') return JSON.parse(data);
      if (data && typeof data.text === 'function') return JSON.parse(await data.text());
      if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data));
    } catch (_) { return null; }
    return null;
  };
  Session.prototype.afterSetup = async function () {
    const D = this.deps;
    this.timer = D.setTimeout(() => {
      this.setState('closed', '已經聊了將近 15 分鐘（Gemini 單次對話的上限）。按麥克風可以再開一輪。');
      this.stop(true);
    }, MAX_SESSION_MS);
    const stream = await this.micPromise;
    if (this.closed) return;
    if (stream) {
      this.stream = stream;
      try { await this.startCapture(stream); } catch (err) { this.micError = err; }
    }
    this.send({ realtimeInput: { text: this.opts.kickoff || KICKOFF } });
    if (!stream || this.micError) this.setState('listening', '麥克風無法使用：可以在下面打字回答。');
    else this.setState('listening', '老師準備開口…');
  };
  Session.prototype.startCapture = async function (stream) {
    const ctx = this.ctx;
    if (!ctx) throw new Error('no audio');
    const resample = makeResampler(ctx.sampleRate || 48000, IN_RATE);
    const onFrames = (frame) => this.onMic(resample(frame));
    this.micSource = ctx.createMediaStreamSource(stream);
    this.mute = ctx.createGain();
    this.mute.gain.value = 0;
    this.mute.connect(ctx.destination);
    if (ctx.audioWorklet && this.deps.Blob && this.deps.URL) {
      const url = this.deps.URL.createObjectURL(new this.deps.Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      this.capture = new root.AudioWorkletNode(ctx, 'dq-capture');
      this.capture.port.onmessage = (e) => onFrames(e.data);
    } else {
      this.capture = ctx.createScriptProcessor(4096, 1, 1);
      this.capture.onaudioprocess = (e) => onFrames(e.inputBuffer.getChannelData(0).slice(0));
    }
    this.micSource.connect(this.capture);
    this.capture.connect(this.mute);
  };
  /** Microphone samples (16 kHz). With loudspeakers, silence is sent while the teacher talks (no echo). */
  Session.prototype.onMic = function (samples) {
    if (this.closed || !samples.length) return;
    const gated = this.settings.speakerMode && (this.sources.size > 0 || (this.ctx && this.ctx.currentTime < this.gateUntil));
    this.pending.push(gated ? new Float32Array(samples.length) : samples);
    this.pendingCount += samples.length;
    if (this.pendingCount < SEND_SAMPLES) return;
    const all = new Float32Array(this.pendingCount);
    let at = 0;
    for (const part of this.pending) { all.set(part, at); at += part.length; }
    this.pending = [];
    this.pendingCount = 0;
    this.send({ realtimeInput: { audio: { data: pcm16ToBase64(floatToPcm16(all)), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
  };
  Session.prototype.send = function (msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  };
  Session.prototype.handle = function (msg) {
    const sc = msg.serverContent;
    if (sc) {
      if (sc.interrupted) this.stopPlayback();
      if (sc.inputTranscription && sc.inputTranscription.text) {
        addTranscript(this.log, 'me', sc.inputTranscription.text);
        this.emit({ type: 'log', log: this.log });
      }
      const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
      let teacherStarted = false;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data && /audio/i.test(part.inlineData.mimeType || 'audio/pcm')) {
          const rate = Number((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1]) || OUT_RATE;
          this.play(part.inlineData.data, rate);
          teacherStarted = true;
        }
      }
      if (sc.outputTranscription && sc.outputTranscription.text) {
        teacherStarted = true;
        this.finishUserTurn();
        addTranscript(this.log, 'teacher', sc.outputTranscription.text);
        this.emit({ type: 'log', log: this.log });
      }
      if (teacherStarted) this.finishUserTurn();
      if (sc.turnComplete || sc.generationComplete) {
        closeEntries(this.log, 'teacher');
        this.emit({ type: 'log', log: this.log });
      }
    }
    if (msg.goAway) this.setState(this.state, '連線快要結束了，可以請老師給回饋。');
  };
  Session.prototype.finishUserTurn = function () {
    const last = this.log[this.log.length - 1];
    if (last && last.role === 'me' && !last.done) {
      last.done = true;
      if (tidy(last.text)) { this.userTurns += 1; this.emit({ type: 'userTurn', count: this.userTurns }); }
    }
  };
  Session.prototype.play = function (b64, rate) {
    const ctx = this.ctx;
    if (!ctx) return;
    const samples = base64ToFloat(b64);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, rate || OUT_RATE);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime + 0.03, this.playHead);
    src.start(at);
    this.playHead = at + buffer.duration;
    this.sources.add(src);
    if (this.state !== 'speaking') this.setState('speaking', '老師正在說…');
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size && !this.closed) {
        this.gateUntil = ctx.currentTime + 0.35;
        this.setState('listening', '換你說了。');
      }
    };
  };
  Session.prototype.stopPlayback = function () {
    for (const src of this.sources) { try { src.onended = null; src.stop(); } catch (_) { /* already ended */ } }
    this.sources.clear();
    this.playHead = 0;
    if (!this.closed && this.state === 'speaking') this.setState('listening', '換你說了。');
  };
  /** Stop the teacher's current sentence (the model also stops when you start talking with headphones). */
  Session.prototype.interrupt = function () { this.stopPlayback(); };
  Session.prototype.sendText = function (text) {
    const clean = tidy(text);
    if (!clean || this.closed) return false;
    this.stopPlayback();
    closeEntries(this.log);
    this.log.push({ role: 'me', text: clean, done: true, typed: true });
    this.userTurns += 1;
    this.emit({ type: 'log', log: this.log });
    this.emit({ type: 'userTurn', count: this.userTurns });
    this.send({ realtimeInput: { text: clean } });
    return true;
  };
  Session.prototype.askFeedback = function () {
    if (this.closed) return false;
    this.stopPlayback();
    this.send({ realtimeInput: { text: FEEDBACK } });
    return true;
  };
  Session.prototype.cleanup = function () {
    this.closed = true;
    if (this.timer) this.deps.clearTimeout(this.timer);
    this.stopPlayback();
    try { if (this.capture) this.capture.disconnect(); } catch (_) { /* ignore */ }
    try { if (this.micSource) this.micSource.disconnect(); } catch (_) { /* ignore */ }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    else if (this.micPromise) this.micPromise.then((s) => { if (s) s.getTracks().forEach((t) => t.stop()); });
    try { if (this.ctx && this.ctx.close) this.ctx.close(); } catch (_) { /* ignore */ }
    closeEntries(this.log);
  };
  Session.prototype.stop = function (silent) {
    if (this.closed) return;
    this.cleanup();
    try { if (this.ws) this.ws.close(1000, 'done'); } catch (_) { /* ignore */ }
    if (!silent) this.setState('closed', '對話結束。可以往下看對話紀錄，或按麥克風再聊一次。');
  };
  Session.prototype.minutes = function () {
    return this.startedAt ? (this.deps.now() - this.startedAt) / 60000 : 0;
  };

  function start(opts, deps) { return new Session(opts, deps).start(); }

  return {
    STORE_KEY, LIVE_MODELS, TEXT_MODELS, VOICES, KICKOFF, FEEDBACK, IN_RATE, OUT_RATE,
    loadSettings, saveSettings, forgetKey, instruction, pickLiveModel, pickTextModel, attempts, setupMessage,
    makeResampler, floatToPcm16, pcm16ToBase64, base64ToFloat, addTranscript, closeEntries, tidy,
    listModels, testKey, generateJson, translateSentence, Session, start,
  };
});
