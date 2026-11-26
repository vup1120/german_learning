/* Deutsch-Quest audio accessibility layer.
 * No third-party TTS service, API keys, or uploaded recordings.
 * Browser Web Speech support varies by device/installed language packs.
 */
(() => {
  'use strict';
  const synth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;
  const Utterance = window.SpeechSynthesisUtterance;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const texts = new WeakMap();
  let sequence = 0;
  let recording = null;
  let state = { message: '', kind: '' };
  const RATE_KEY = 'deutschquest.audio.rate.v2';
  const VOICE_KEY = 'deutschquest.audio.voice.v1';
  const PREFERRED_VOICE_RE = /google deutsch|conrad|amala|katja|hedda|petra|yannick|markus|helena|martin|vicki|natural|neural|online/i;
  let rate = 1;
  let preferredVoiceName = '';
  let activeAudio = null;
  let localTtsOk = false;
  let localTtsLabel = '本機德語音檔';
  let localTtsVoices = [];
  let localTtsVoice = '';
  let staticAudioMap = {};
  let staticAudioVoice = '';
  try {
    const saved = Number(localStorage.getItem(RATE_KEY));
    if ([0.65, 0.85, 1, 1.15].includes(saved)) rate = saved;
    preferredVoiceName = localStorage.getItem(VOICE_KEY) || '';
  } catch (_) { /* private browsing can disable storage */ }

  if (typeof window.fetch === 'function' && typeof window.Audio === 'function') {
    window.fetch('audio/manifest.json').then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (data && data.files) {
        staticAudioMap = data.files;
        staticAudioVoice = data.voice || 'de-DE-ConradNeural';
        refreshVoiceSelect();
        if (!localTtsOk) status('已載入德語母語音檔 · ' + staticAudioVoice, 'success');
      }
    }).catch(() => {});
    window.fetch('/api/tts?ping=1').then((r) => (r.ok ? r.json() : null)).then((info) => {
      if (info && info.ok) {
        localTtsOk = true;
        localTtsVoices = Array.isArray(info.voices) && info.voices.length ? info.voices : (info.voice ? [info.voice] : []);
        localTtsVoice = localTtsVoices.includes(preferredVoiceName) ? preferredVoiceName : (info.voice || localTtsVoices[0] || '');
        localTtsLabel = localTtsVoice ? '母語音檔 · ' + localTtsVoice : '本機德語音檔';
        refreshVoiceSelect();
        status('已連線：' + localTtsLabel, 'success');
      }
    }).catch(() => {});
  }

  let toolsOpen = false;
  function status(message, kind = '') {
    state = { message, kind };
    const el = document.getElementById('dq-audio-status');
    if (el) {
      el.textContent = message;
      el.className = 'dq-audio-status' + (kind ? ' ' + kind : '');
    }
    // The toolbar stays folded to one line; open it when something needs attention.
    if (kind === 'error') {
      toolsOpen = true;
      const tools = document.getElementById('dq-audio-tools');
      if (tools) tools.open = true;
    }
  }
  function summaryText() {
    return '速度 ' + rate + '×';
  }
  function voices() {
    if (!synth || typeof synth.getVoices !== 'function') return [];
    try { return synth.getVoices() || []; } catch (_) { return []; }
  }
  function germanVoices() {
    return voices().filter((voice) => /^de([-_]|$)/i.test(voice.lang || '') && !/^anna\b/i.test(voice.name || '')).sort((a, b) => {
      const score = (v) => {
        let s = /^de[-_]DE$/i.test(v.lang || '') ? 10 : 0;
        if (PREFERRED_VOICE_RE.test(v.name || '')) s += 5;
        if (!v.localService && PREFERRED_VOICE_RE.test(v.name || '')) s += 3;
        else if (v.localService) s += 1;
        return s;
      };
      return score(b) - score(a);
    });
  }
  function germanVoice() {
    const list = germanVoices();
    if (!list.length) return null;
    if (preferredVoiceName) {
      const chosen = list.find((v) => v.name === preferredVoiceName);
      if (chosen) return chosen;
    }
    return list[0];
  }
  function chop(text) {
    const parts = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?;:]+[.!?;:]?/g) || [];
    const result = [];
    let chunk = '';
    function push() { if (chunk.trim()) result.push(chunk.trim()); chunk = ''; }
    for (const original of parts) {
      const sentence = original.trim();
      if (!sentence) continue;
      if (sentence.length > 180) {
        push();
        const words = sentence.split(/\s+/);
        for (const word of words) {
          if (chunk.length + word.length + 1 > 180) push();
          chunk += (chunk ? ' ' : '') + word;
        }
        push();
      } else if (chunk.length + sentence.length + 1 > 180) {
        push();
        chunk = sentence;
      } else {
        chunk += (chunk ? ' ' : '') + sentence;
      }
    }
    push();
    return result;
  }
  function clearActiveAudio() {
    if (!activeAudio) return;
    const prev = activeAudio;
    activeAudio = null;
    prev.onplay = null;
    prev.onended = null;
    prev.onerror = null;
    try { prev.pause(); prev.removeAttribute('src'); prev.load(); } catch (_) { /* ignored */ }
  }
  function stop() {
    sequence += 1;
    clearActiveAudio();
    if (synth) {
      try { synth.cancel(); } catch (_) { /* ignored */ }
    }
    status('已停止朗讀');
  }
  function playAudioUrl(url, id) {
    if (typeof window.Audio !== 'function') return false;
    try {
      const audio = new window.Audio(url);
      audio.playbackRate = rate;
      activeAudio = audio;
      audio.onplay = () => {
        if (id !== sequence || activeAudio !== audio) return;
        status('正在播放德文母語音檔 · ' + rate + '×', 'success');
      };
      audio.onended = () => {
        if (activeAudio === audio) activeAudio = null;
        if (id === sequence) status('朗讀完成', 'success');
      };
      audio.onerror = () => {
        if (activeAudio !== audio || id !== sequence) return;
        activeAudio = null;
        status('德文音檔暫時無法載入，請再試一次。', 'error');
      };
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { if (activeAudio === audio) activeAudio = null; });
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  function playLocalAudio(text, id) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const staticFile = staticAudioMap[clean];
    if (staticFile && playAudioUrl('audio/' + staticFile, id)) return true;
    if (!localTtsOk) return false;
    const vParam = localTtsVoice ? '&voice=' + encodeURIComponent(localTtsVoice) : '';
    return playAudioUrl('/api/tts?text=' + encodeURIComponent(clean) + vParam, id);
  }
  function play(text) {
    const chunks = chop(text);
    if (!chunks.length) { status('這裡沒有可朗讀的德文。', 'error'); return false; }
    sequence += 1;
    const id = sequence;
    clearActiveAudio();
    if (synth) {
      try { synth.cancel(); } catch (_) { /* ignored */ }
    }
    if (playLocalAudio(chunks.join(' '), id)) {
      status('正在載入德文母語音檔…');
      return true;
    }
    if (!synth || typeof Utterance !== 'function') {
      status('瀏覽器不支援語音朗讀。請使用支援 Web Speech 的瀏覽器並檢查裝置語音設定。', 'error');
      return false;
    }
    const voice = germanVoice();
    let index = 0;
    let started = false;
    const next = () => {
      if (id !== sequence) return;
      if (index >= chunks.length) { status('朗讀完成', 'success'); return; }
      const utter = new Utterance(chunks[index++]);
      utter.lang = 'de-DE';
      utter.rate = rate;
      utter.pitch = 1;
      if (voice) utter.voice = voice;
      utter.onstart = () => {
        if (id !== sequence) return;
        started = true;
        status('正在播放德文 · ' + rate + '×' + (voice ? ' · ' + voice.name : ' · 系統預設語音（未偵測到德語聲）'), voice ? 'success' : 'error');
      };
      utter.onend = () => { if (id === sequence) next(); };
      utter.onerror = (event) => {
        if (id !== sequence) return;
        if (event.error === 'canceled' || event.error === 'interrupted') return;
        status('朗讀失敗（' + (event.error || '未知原因') +
               '）。請按「測試聲音」，確認手機有德文語音與媒體音量。', 'error');
      };
      try {
        synth.speak(utter); // Must execute synchronously inside the user's click on iOS.
      } catch (error) {
        status('無法啟動朗讀：' + (error.message || String(error)), 'error');
      }
    };
    status('正在啟動德文語音…' + (voice ? '' : '（尚未偵測到德語語音包）'));
    next();
    window.setTimeout(() => {
      if (sequence !== id || started) return;
      if (synth && !synth.speaking) {
        status('尚未確認語音有開始播放。請檢查音量、德文語音包及瀏覽器支援；可按「測試聲音」重試。', 'error');
      }
    }, 2200);
    return true;
  }
  function listen({ onText, onError, onEnd } = {}) {
    if (!Rec) {
      status('目前瀏覽器不支援語音辨識；你可以直接打字完成練習。', 'error');
      if (onError) onError('unsupported');
      return false;
    }
    if (recording) {
      try { recording.abort(); } catch (_) { /* ignored */ }
    }
    if (synth) { sequence += 1; try { synth.cancel(); } catch (_) { /* ignored */ } }
    try {
      const recognition = new Rec();
      recording = recognition;
      recognition.lang = 'de-DE';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        const transcript = event.results && event.results[0] && event.results[0][0]
          ? event.results[0][0].transcript.trim() : '';
        if (transcript && onText) onText(transcript);
        status(transcript ? '已辨識德文回答（請自行確認文字）。' : '沒有辨識到文字。', transcript ? 'success' : 'error');
      };
      recognition.onerror = (event) => {
        const code = event.error || 'unknown';
        const advice = code === 'not-allowed' || code === 'service-not-allowed'
          ? '請在瀏覽器允許麥克風權限，或改用文字輸入。'
          : code === 'no-speech' ? '沒有聽見聲音，可再試一次或改打字。'
          : '語音辨識無法使用，請改用文字輸入。';
        status('麥克風：' + advice + '（' + code + '）', 'error');
        if (onError) onError(code);
      };
      recognition.onend = () => {
        if (recording === recognition) recording = null;
        if (onEnd) onEnd();
      };
      recognition.start(); // Directly from a click, and only on explicit request.
      status('正在聽你說德文…說完後請稍候；也可以改用打字。');
      return true;
    } catch (error) {
      recording = null;
      status('麥克風無法啟動：' + (error.message || String(error)), 'error');
      if (onError) onError('start-failed');
      return false;
    }
  }
  // Optional local recording: supports shadowing on devices without speech recognition.
  // Audio stays in this browser tab and is never sent to our server.
  let mediaRecorder = null;
  let recordingStream = null;
  async function startRecording(onReady) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ||
        typeof window.MediaRecorder !== 'function') {
      status('這個瀏覽器不支援本機錄音。可使用麥克風轉文字或直接口頭跟讀。', 'error');
      return false;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      status('正在錄音；請先按「停止錄音」。');
      return false;
    }
    try {
      status('請允許瀏覽器使用麥克風，錄音只保存在這個分頁。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStream = stream;
      const rec = new window.MediaRecorder(stream);
      mediaRecorder = rec;
      const pieces = [];
      rec.ondataavailable = (event) => { if (event.data && event.data.size) pieces.push(event.data); };
      rec.onerror = (event) => status('錄音失敗：' + (event.error?.message || '裝置無法錄製音訊'), 'error');
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordingStream === stream) recordingStream = null;
        if (mediaRecorder === rec) mediaRecorder = null;
        if (!pieces.length) {
          status('沒有錄到音訊，請確認麥克風可用。', 'error');
          return;
        }
        const blob = new Blob(pieces, { type: rec.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        status('錄音完成，可以按播放比較自己的發音和德文示範。', 'success');
        if (onReady) onReady(url); else URL.revokeObjectURL(url);
      };
      rec.start();
      status('錄音中…請念出德文，然後按「停止錄音」。');
      return true;
    } catch (error) {
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
        recordingStream = null;
      }
      mediaRecorder = null;
      status('錄音無法啟動：' + (error.message || String(error)) +
             '。請檢查麥克風權限，或改用文字輸入。', 'error');
      return false;
    }
  }
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return true;
    }
    status('目前沒有正在進行的錄音。');
    return false;
  }
  function speaker(text, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dq-speak';
    btn.setAttribute('aria-label', label || '播放德文朗讀');
    btn.title = label || '播放德文';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M4 10v4h4l5 4V6l-5 4z"/>' +
      '<path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
    texts.set(btn, text);
    return btn;
  }
  function addSpeakers(root) {
    const nodes = Array.from(root.querySelectorAll('[lang="de"],[lang^="de-"],[data-speak-text]'));
    for (const el of nodes) {
      if (el.closest('.dq-audio-tools, .phrase, .dq-audio-link, [data-no-auto-speech]')) continue;
      if (el.matches('textarea, input, select, option') || el.isContentEditable) continue;
      if (el.matches('.flash-de') && el.closest('.flash')?.querySelector('[data-act="say"]')) continue;
      if (el.matches('.news-title') && el.closest('.card')?.querySelector('[data-act="say"]')) continue;
      if (el.querySelector('[lang="de"],[lang^="de-"],[data-speak-text]')) continue;
      const text = (el.getAttribute('data-speak-text') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 2) continue;
      const button = speaker(text, '播放這段德文');
      const interactive = el.closest('a, button');
      if (interactive) {
        if (!interactive.parentNode || interactive.closest('.phrase')) continue;
        const wrap = document.createElement('div');
        wrap.className = 'dq-audio-link';
        interactive.parentNode.insertBefore(wrap, interactive);
        wrap.appendChild(interactive);
        wrap.appendChild(button);
      } else {
        el.appendChild(button);
      }
    }
  }
  function pageGerman(root) {
    const list = Array.from(root.querySelectorAll('[lang="de"],[lang^="de-"],[data-speak-text]'))
      .filter((el) => !el.closest('.dq-audio-tools'))
      .filter((el) => !el.querySelector('[lang="de"],[lang^="de-"]'))
      .map((el) => (el.getAttribute('data-speak-text') || el.textContent || '').trim())
      .filter(Boolean);
    return list.slice(0, 80).join('. ');
  }
  function enhance(root) {
    if (!root) return;
    const bar = document.createElement('details');
    bar.className = 'dq-audio-tools';
    bar.id = 'dq-audio-tools';
    bar.setAttribute('aria-label', '聽力控制');
    bar.open = toolsOpen;
    bar.addEventListener('toggle', () => { toolsOpen = bar.open; });
    bar.innerHTML = '<summary class="dq-audio-summary">' +
      '<span class="dq-audio-summary-label">🔊 語音設定</span>' +
      '<span class="dq-audio-summary-rate" id="dq-audio-summary-rate">' + summaryText() + '</span></summary>' +
      '<div class="dq-audio-controls">' +
      '<button type="button" data-dq-audio="test">🔊 測試德語</button>' +
      '<button type="button" data-dq-audio="page">朗讀本頁</button>' +
      '<button type="button" data-dq-audio="stop">停止</button>' +
      '<label>速度 <select id="dq-audio-rate" aria-label="德文語音速度">' +
      '<option value="0.65">0.65×</option><option value="0.85">0.85×</option>' +
      '<option value="1">1×</option><option value="1.15">1.15×</option>' +
      '</select></label>' +
      '<label>語音 <select id="dq-audio-voice" aria-label="德文語音選擇"></select></label></div>' +
      '<p id="dq-audio-status" class="dq-audio-status" role="status" aria-live="polite"></p>' +
      '<details class="dq-audio-help"><summary>聽不到德文？</summary>' +
      '<p>先按「測試德語」並調高媒體音量。若沒有聲音，請確認瀏覽器支援語音朗讀，並在裝置的語音／語言設定安裝德語聲音。' +
      '部分手機瀏覽器不支援德語聲音或麥克風辨識；可改用桌面 Chrome／Edge。本站不提供外部音訊檔。</p></details>';
    root.append(bar);
    bar.querySelector('#dq-audio-rate').value = String(rate);
    refreshVoiceSelect();
    status(state.message || (synth ? '點小喇叭或「測試德語」開始；速度可調。' :
      '此瀏覽器不支援 Web Speech 朗讀。'), state.kind);
    addSpeakers(root);
  }
  function refreshVoiceSelect() {
    const sel = document.getElementById('dq-audio-voice');
    if (!sel) return;
    if (localTtsOk) {
      const opts = localTtsVoices.length ? localTtsVoices : [localTtsVoice || 'local'];
      sel.innerHTML = opts.map((v) => '<option value="' + v.replace(/"/g, '&quot;') + '">母語音檔 · ' + v + '</option>').join('');
      if (localTtsVoice) sel.value = localTtsVoice;
      return;
    }
    if (staticAudioVoice) {
      sel.innerHTML = '<option value="__local__">母語音檔 · ' + staticAudioVoice + '</option>';
      return;
    }
    const list = germanVoices();
    if (!list.length) {
      sel.innerHTML = '<option value="">未偵測到德語聲</option>';
      return;
    }
    const current = germanVoice();
    sel.innerHTML = list.map((v) => '<option value="' + v.name.replace(/"/g, '&quot;') + '">' + v.name + '</option>').join('');
    if (current) sel.value = current.name;
  }
  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', refreshVoiceSelect);
  }
  document.addEventListener('click', (event) => {
    const speakerButton = event.target.closest('.dq-speak');
    if (speakerButton) {
      event.preventDefault();
      event.stopPropagation();
      play(texts.get(speakerButton));
      return;
    }
    const tool = event.target.closest('[data-dq-audio]');
    if (!tool) return;
    event.preventDefault();
    if (tool.dataset.dqAudio === 'stop') stop();
    if (tool.dataset.dqAudio === 'test') play('Guten Tag! Ich lerne Deutsch. Heute übe ich Hören und Sprechen.');
    if (tool.dataset.dqAudio === 'page') play(pageGerman(document.getElementById('view')));
  });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'dq-audio-voice') {
      preferredVoiceName = event.target.value || '';
      if (localTtsOk && localTtsVoices.includes(preferredVoiceName)) {
        localTtsVoice = preferredVoiceName;
        localTtsLabel = '母語音檔 · ' + localTtsVoice;
        status('已切換：' + localTtsLabel, 'success');
      }
      try { localStorage.setItem(VOICE_KEY, preferredVoiceName); } catch (_) { /* ignored */ }
      return;
    }
    if (event.target.id !== 'dq-audio-rate') return;
    const next = Number(event.target.value);
    if (![0.65, 0.85, 1, 1.15].includes(next)) return;
    rate = next;
    const summaryRate = document.getElementById('dq-audio-summary-rate');
    if (summaryRate) summaryRate.textContent = summaryText();
    try { localStorage.setItem(RATE_KEY, String(rate)); } catch (_) { /* optional */ }
    status('速度已設為 ' + rate + '×；請再點小喇叭播放。');
  });
  if (synth && typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', () => {
      if (!state.message || state.message.includes('尚未偵測')) {
        const voice = germanVoice();
        status(voice ? '德語語音可用：' + voice.name : '尚未偵測到德語語音包；可試用「測試德語」。');
      }
    });
  }
  window.DQAudio = { play, stop, listen, startRecording, stopRecording, enhance, chop, getRate: () => rate,
    getGermanVoice: germanVoice, isSpeechAvailable: () => !!(synth && Utterance),
    isRecognitionAvailable: () => !!Rec };
})();
