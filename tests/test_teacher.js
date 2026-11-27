// AI teacher (site/teacher.js): model choice, Live API messages and a full session against a fake socket.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../site/teacher.js');

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(); }

function fakeDeps() {
  class FakeWS {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeWS.all.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen(); }
    recv(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
    shut(code, reason) { this.readyState = 3; this.onclose({ code, reason }); }
  }
  FakeWS.all = [];
  const sources = [];
  const ctx = {
    sampleRate: 48000, currentTime: 0, destination: {},
    resume() {}, close() { this.closed = true; },
    createBuffer(ch, n, rate) { const data = new Float32Array(n); return { duration: n / rate, sampleRate: rate, getChannelData: () => data }; },
    createBufferSource() { const s = { connect() {}, start(t) { this.at = t; }, stop() { this.stopped = true; } }; sources.push(s); return s; },
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; },
    createGain() { return { gain: { value: 1 }, connect() {} }; },
    createScriptProcessor() { ctx.processor = { connect() {}, disconnect() {} }; return ctx.processor; },
  };
  const track = { stopped: false, stop() { this.stopped = true; } };
  const deps = {
    WebSocket: FakeWS,
    AudioContext: function () { return ctx; },
    getUserMedia: () => Promise.resolve({ getTracks: () => [track] }),
    setTimeout: () => 1, clearTimeout() {}, now: () => 0,
  };
  return { deps, FakeWS, ctx, sources, track };
}
const pcm = (n) => T.pcm16ToBase64(T.floatToPcm16(new Float32Array(n).fill(0.25)));

test('the newest GA Live model is chosen from the key\'s model list', () => {
  const models = [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
    { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent', 'countTokens'] },
    { name: 'models/gemini-3.5-live-translate-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
  ];
  assert.equal(T.pickLiveModel(models), 'gemini-3.8-live');
  assert.equal(T.pickLiveModel(models.slice(0, 2)), 'gemini-3.1-flash-live-preview');
  assert.equal(T.pickLiveModel([]), '');
  assert.equal(T.pickTextModel(models), 'gemini-2.5-flash');
  assert.equal(T.pickTextModel(models.concat({ name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] })), 'gemini-flash-latest');
});

test('setup message: model, German teacher instructions, transcription, patient pause detection, both shapes', () => {
  const settings = { voice: 'Aoede', pauseMs: 2500 };
  const nested = T.setupMessage('gemini-3.8-live', 'nested', T.instruction('Thema X'), settings).setup;
  assert.equal(nested.model, 'models/gemini-3.8-live');
  assert.deepEqual(nested.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(nested.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Aoede');
  assert.match(nested.systemInstruction.parts[0].text, /Deutschlehrerin[\s\S]*Thema X/);
  assert.deepEqual(nested.inputAudioTranscription, {});
  assert.deepEqual(nested.outputAudioTranscription, {});
  assert.equal(nested.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 2500);
  const flat = T.setupMessage('models/gemini-3.8-live', 'flat', 'x', settings).setup;
  assert.equal(flat.model, 'models/gemini-3.8-live');
  assert.deepEqual(flat.responseModalities, ['AUDIO']);
  assert.equal(flat.generationConfig, undefined);
  assert.deepEqual(T.attempts({ liveModel: 'gemini-3.8-live', shape: 'flat' }).slice(0, 2),
    [{ model: 'gemini-3.8-live', shape: 'flat' }, { model: 'gemini-3.8-live', shape: 'nested' }]);
});

test('microphone audio is resampled to 16 kHz and PCM survives a round trip', () => {
  const resample = T.makeResampler(48000, 16000);
  let out = 0;
  for (let i = 0; i < 10; i++) out += resample(new Float32Array(480).fill(0.5)).length;
  assert.ok(Math.abs(out - 1600) <= 1, `got ${out}`);
  const back = T.base64ToFloat(T.pcm16ToBase64(T.floatToPcm16(Float32Array.from([0, 0.5, -0.5, 1, -1]))));
  [0, 0.5, -0.5, 1, -1].forEach((v, i) => assert.ok(Math.abs(back[i] - v) < 0.001));
});

test('a full conversation: shape fallback, kickoff, audio, transcripts, interruption, typing, stop', async () => {
  const { deps, FakeWS, ctx, sources, track } = fakeDeps();
  const events = [];
  const session = new T.Session({ instruction: 'Thema', settings: { key: 'k ey', voice: 'Kore', speakerMode: true },
    onEvent: (e) => events.push(e) }, deps).start();
  assert.equal(session.state, 'connecting');

  const first = FakeWS.all[0];
  assert.ok(first.url.endsWith('BidiGenerateContent?key=k%20ey'));
  first.open();
  assert.equal(first.sent[0].setup.model, 'models/gemini-3.8-live');
  assert.ok(first.sent[0].setup.generationConfig);
  first.shut(1007, 'Invalid JSON payload received. Unknown name "generationConfig"');
  await settle();

  const ws = FakeWS.all[1];
  ws.open();
  assert.deepEqual(ws.sent[0].setup.responseModalities, ['AUDIO']);
  ws.recv({ setupComplete: {} });
  await settle();
  assert.deepEqual(events.find((e) => e.type === 'connected'), { type: 'connected', model: 'gemini-3.8-live', shape: 'flat' });
  assert.deepEqual(ws.sent[1], { realtimeInput: { text: T.KICKOFF } });

  ws.recv({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm(2400) } }] },
    outputTranscription: { text: 'Hallo! Wie war ' } } });
  ws.recv({ serverContent: { outputTranscription: { text: 'dein Tag?' }, turnComplete: true } });
  await settle();
  assert.equal(session.state, 'speaking');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].at, 0.03);
  assert.deepEqual(session.log, [{ role: 'teacher', text: 'Hallo! Wie war dein Tag?', done: true }]);

  // While the teacher talks through the loudspeaker the microphone sends silence (no echo).
  ctx.processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4800).fill(0.9) } });
  const audioMsg = ws.sent.find((m) => m.realtimeInput && m.realtimeInput.audio);
  assert.equal(audioMsg.realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  assert.ok(T.base64ToFloat(audioMsg.realtimeInput.audio.data).every((v) => v === 0));

  sources[0].onended();
  assert.equal(session.state, 'listening');
  ws.recv({ serverContent: { inputTranscription: { text: 'Gut, ich war' } } });
  ws.recv({ serverContent: { inputTranscription: { text: ' im Park.' } } });
  ws.recv({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm(2400) } }] },
    outputTranscription: { text: 'Schön!' } } });
  await settle();
  assert.equal(session.log[1].text, 'Gut, ich war im Park.');
  assert.equal(session.log[1].done, true);
  assert.equal(events.filter((e) => e.type === 'userTurn').length, 1);

  ws.recv({ serverContent: { interrupted: true } });
  await settle();
  assert.ok(sources[1].stopped);
  assert.equal(session.state, 'listening');

  assert.equal(session.sendText('  Und du? '), true);
  assert.deepEqual(ws.sent[ws.sent.length - 1], { realtimeInput: { text: 'Und du?' } });
  assert.equal(events.filter((e) => e.type === 'userTurn').pop().count, 2);
  assert.equal(session.askFeedback(), true);
  assert.deepEqual(ws.sent[ws.sent.length - 1], { realtimeInput: { text: T.FEEDBACK } });

  session.stop();
  assert.equal(session.state, 'closed');
  assert.ok(track.stopped && ctx.closed);
  assert.equal(session.sendText('noch was'), false);
});

test('a wrong key stops after one try and reports the reason', async () => {
  const { deps, FakeWS } = fakeDeps();
  const events = [];
  new T.Session({ settings: { key: 'bad' }, onEvent: (e) => events.push(e) }, deps).start();
  FakeWS.all[0].open();
  FakeWS.all[0].shut(1008, 'API key not valid. Please pass a valid API key.');
  await settle();
  assert.equal(FakeWS.all.length, 1);
  const last = events.filter((e) => e.type === 'status').pop();
  assert.equal(last.state, 'error');
  assert.match(last.message, /API key not valid/);
});

test('no key: the session explains instead of connecting', () => {
  const { deps, FakeWS } = fakeDeps();
  const session = new T.Session({ settings: { key: '' } }, deps).start();
  assert.equal(session.state, 'error');
  assert.equal(FakeWS.all.length, 0);
});

test('key check and on-demand sentence translation use the REST API', async () => {
  const calls = [];
  const fetchOk = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/models?')) {
      return { ok: true, json: async () => ({ models: [
        { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] },
        { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] }] }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text:
      '```json\n{"zh": "停火延長了。", "words": [{"i": 1, "lemma": "die Waffenruhe", "zh": "停火"}, {"i": 9, "lemma": "x", "zh": "y"}]}\n```' }] } }] }) };
  };
  const res = await T.testKey(' AIza ', fetchOk);
  assert.deepEqual(res, { ok: true, liveModel: 'gemini-3.8-live', textModel: 'gemini-flash-latest', message: '可以使用了 · 對話模型 gemini-3.8-live' });
  assert.ok(calls[0].url.endsWith('key=AIza'));
  const zh = await T.translateSentence('Die Waffenruhe wird verlängert.', ['Die', 'Waffenruhe', 'wird', 'verlängert'],
    { key: 'AIza', textModel: 'gemini-flash-latest' }, fetchOk);
  assert.deepEqual(zh, { zh: '停火延長了。', words: { 1: { l: 'die Waffenruhe', zh: '停火' } } });
  assert.match(calls[1].url, /models\/gemini-flash-latest:generateContent\?key=AIza$/);

  const fetchBad = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid.' } }) });
  const bad = await T.testKey('x', fetchBad);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /API key not valid/);
});

test('settings stay in this browser and the key can be removed', () => {
  const mem = {};
  const store = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(T.loadSettings(store).voice, 'Kore');
  T.saveSettings({ key: 'abc', voice: 'Puck', liveModel: 'gemini-3.8-live' }, store);
  assert.equal(T.loadSettings(store).voice, 'Puck');
  T.forgetKey(store);
  assert.deepEqual([T.loadSettings(store).key, T.loadSettings(store).liveModel, T.loadSettings(store).voice], ['', '', 'Puck']);
});

test('transcript chunks merge per speaker', () => {
  const log = [];
  T.addTranscript(log, 'teacher', 'Hallo ');
  T.addTranscript(log, 'teacher', 'du!');
  T.addTranscript(log, 'me', 'Hi');
  assert.deepEqual(log, [{ role: 'teacher', text: 'Hallo du!', done: true }, { role: 'me', text: 'Hi', done: false }]);
});
