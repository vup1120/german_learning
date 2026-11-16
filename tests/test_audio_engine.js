const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../site/speech.js'), 'utf8');

function makeEnvironment({ supported = true, voices = [{lang: 'de-DE', name: 'German Voice', localService: true}] } = {}) {
  const spoken = [];
  class Utterance {
    constructor(text) { this.text = text; }
  }
  const synth = supported ? {
    speaking: false,
    cancel() { this.speaking = false; },
    getVoices() { return voices; },
    addEventListener() {},
    speak(utter) {
      spoken.push(utter);
      this.speaking = true;
      if (utter.onstart) utter.onstart();
      this.speaking = false;
      if (utter.onend) utter.onend();
    }
  } : undefined;
  const body = {
    addEventListener() {},
    getElementById() { return null; },
  };
  const window = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: supported ? Utterance : undefined,
    setTimeout() {}
  };
  const sandbox = {
    window, document: body, navigator: {},
    localStorage: {getItem: () => null, setItem() {} },
    URL, Blob, console
  };
  vm.runInNewContext(source, sandbox, {filename: 'speech.js'});
  return {api: window.DQAudio, spoken};
}

test('test click starts German speech with the right voice and pace', () => {
  const {api, spoken} = makeEnvironment();
  assert.equal(spoken.length, 0, 'no audio before a click');
  assert.equal(api.play('Guten Tag. Wie geht es dir?'), true);
  assert.ok(spoken.length);
  assert.equal(spoken[0].lang, 'de-DE');
  assert.equal(spoken[0].rate, 0.85);
  assert.equal(spoken[0].voice.name, 'German Voice');
});

test('long German passages are split before synthesizing', () => {
  const {api, spoken} = makeEnvironment();
  const text = ('Heute lernen wir eine neue Geschichte. ').repeat(30);
  assert.ok(api.chop(text).length > 1);
  assert.equal(api.play(text), true);
  assert.equal(spoken.length, api.chop(text).length);
  assert.ok(spoken.every((u) => u.text.length <= 180));
});

test('missing speech engine returns explicit failure instead of silently succeeding', () => {
  const {api, spoken} = makeEnvironment({supported: false});
  assert.equal(api.isSpeechAvailable(), false);
  assert.equal(api.play('Guten Tag!'), false);
  assert.equal(spoken.length, 0);
});

test('no German voices still attempts language-tagged synthesis', () => {
  const {api, spoken} = makeEnvironment({voices: [{lang: 'en-US', name: 'English'}]});
  assert.equal(api.getGermanVoice(), null);
  assert.equal(api.play('Ich übe Deutsch.'), true);
  assert.equal(spoken[0].lang, 'de-DE');
  assert.equal(spoken[0].voice, undefined);
});

test('microphone recognition gracefully falls back when unsupported', () => {
  const {api} = makeEnvironment();
  assert.equal(api.isRecognitionAvailable(), false);
  let error = '';
  assert.equal(api.listen({onError(code) {error = code;}}), false);
  assert.equal(error, 'unsupported');
});
