/* Chinese speech is independent of the existing caption panel and its controls. */
function installChineseInterpretation(cues, {videoSelector = ''} = {}) {
  if (document.getElementById('pai-voice-controls')) return;
  const synth = window.speechSynthesis;
  const LABEL = {title: '中文语音同传', voice: '中文声音', on: '开启中文同传', off: '关闭中文同传', idle: '中文语音同传已关闭', waiting: '同传已开启 · 等待下一句'};
  const DUCK = 0.2;
  const box = document.createElement('section');
  box.id = 'pai-voice-controls';
  box.setAttribute('aria-label', LABEL.title);
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;width:300px;max-width:calc(100vw - 36px);z-index:2147483647;padding:14px;background:#fff;color:#172033;border:1px solid #d3dce8;border-radius:12px;box-shadow:0 4px 18px #0002;font:14px/1.5 system-ui;box-sizing:border-box';
  box.innerHTML = `<strong>${LABEL.title}</strong><button type="button" id="pai-voice-toggle" aria-pressed="false"></button><div id="pai-voice-status" role="status"></div><label style="display:block;margin-top:8px"><input id="pai-voice-duck" type="checkbox" checked> 同传时降低英文原声</label><details style="margin-top:8px"><summary style="cursor:pointer">声音设置</summary><label>${LABEL.voice} <select id="pai-voice-select" style="max-width:100%" aria-label="${LABEL.voice}"></select></label><p style="margin:6px 0 0;color:#596579">按本视频译文同步朗读；暂停、跳转时跟随视频。语音与字幕可分别开关。</p></details>`;
  document.body.append(box);
  const button = box.querySelector('#pai-voice-toggle');
  button.style.cssText = 'display:block;width:100%;margin:9px 0;padding:9px;border:0;border-radius:7px;background:#17664d;color:white;font:600 15px system-ui;cursor:pointer';
  const status = box.querySelector('#pai-voice-status');
  const duck = box.querySelector('#pai-voice-duck');
  const select = box.querySelector('#pai-voice-select');
  let active = false, video = null, utterance = null, current = -1, serial = 0;
  let voices = [], blocked = false, originalVolume = null, appliedVolume = null;
  let waiting = false, charsPerSecond = 5.5, spokenAt = 0;
  button.textContent = LABEL.on;
  status.textContent = LABEL.idle;
  // Short utterances prevent long synthesis stalls; times are interpolated within each cue.
  const segments = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const end = Math.min(cue.end, cues[i + 1]?.start ?? cue.end);
    const parts = (cue.zh.match(/[^。！？；]+[。！？；]?/gu) || []).flatMap(s => s.match(/.{1,64}(?:[，、：]|$)|.{1,64}/gu) || []);
    const length = parts.reduce((n, s) => n + s.length, 0);
    let used = 0;
    for (const text of parts) {
      const start = cue.start + (end - cue.start) * used / length;
      used += text.length;
      segments.push({start, end: cue.start + (end - cue.start) * used / length, text});
    }
  }
  function findSegment(t) {
    let lo = 0, hi = segments.length - 1, result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= t) { result = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return result >= 0 && t < segments[result].end ? result : -1;
  }
  function restoreVolume() {
    if (video && originalVolume !== null && Math.abs(video.volume - appliedVolume) < 0.001) video.volume = originalVolume;
    originalVolume = appliedVolume = null;
  }
  function lowerVolume() {
    if (!video || !duck.checked || originalVolume !== null) return;
    originalVolume = video.volume;
    appliedVolume = originalVolume * DUCK;
    video.volume = appliedVolume;
  }
  function cancel() {
    serial++;
    if (utterance) synth.cancel();
    utterance = null;
    if (blocked) { synth.resume(); blocked = false; }
    restoreVolume();
  }
  function reset() { cancel(); current = -1; }
  function setActive(value) {
    active = value;
    button.textContent = active ? LABEL.off : LABEL.on;
    button.setAttribute('aria-pressed', String(active));
    if (!active) { reset(); restoreVolume(); status.textContent = LABEL.idle; }
    else { attach(); tick(); }
  }
  function refreshVoices() {
    if (!synth) return;
    const previous = select.value;
    voices = synth.getVoices().filter(v => /^zh[-_](CN|TW)|^cmn/i.test(v.lang));
    voices.sort((a,b) => Number(b.localService) - Number(a.localService) || Number(/CN/i.test(b.lang)) - Number(/CN/i.test(a.lang)));
    select.replaceChildren(...voices.map(v => {
      const option = document.createElement('option'); option.value = v.voiceURI;
      option.textContent = v.name + (v.localService ? ' · 本机' : ' · 在线'); return option;
    }));
    if (voices.some(v => v.voiceURI === previous)) select.value = previous;
    button.disabled = !voices.length;
    if (!voices.length) {
      setActive(false);
      status.textContent = '未找到普通话声音，请在系统中添加中文语音后重试。';
    }
  }
  function speak(index) {
    const segment = segments[index];
    cancel();
    current = index;
    const token = serial;
    const u = new SpeechSynthesisUtterance(segment.text);
    u.voice = voices.find(v => v.voiceURI === select.value) || voices[0];
    u.lang = u.voice.lang;
    const seconds = Math.max(0.5, (segment.end - video.currentTime) / video.playbackRate);
    u.rate = Math.min(2.5, Math.max(1, segment.text.length / (charsPerSecond * seconds)));
    u.volume = 1;
    utterance = u;
    status.textContent = '准备播报中文…';
    box.dataset.segment = String(index);
    u.onstart = () => {
      if (token !== serial) return;
      spokenAt = performance.now();
      lowerVolume();
      status.textContent = '正在播报中文';
      box.dataset.started = String(Number(box.dataset.started || 0) + 1);
    };
    u.onend = () => {
      if (token !== serial) return;
      const seconds = (performance.now() - spokenAt) / 1000;
      if (seconds > 0.5) charsPerSecond = Math.max(3, Math.min(9, charsPerSecond * 0.8 + segment.text.length / seconds / u.rate * 0.2));
      utterance = null;
      restoreVolume();
      status.textContent = LABEL.waiting;
      box.dataset.completed = String(Number(box.dataset.completed || 0) + 1);
    };
    u.onerror = e => {
      if (token !== serial || ['interrupted','canceled'].includes(e.error)) return;
      setActive(false);
      status.textContent = '中文播报未成功（' + e.error + '），请重新开启或选择另一声音。';
    };
    synth.speak(u);
  }
  function tick() {
    if (!active) return;
    if (!video) { status.textContent = '同传已开启 · 等待视频'; return; }
    if (video.ended) { reset(); restoreVolume(); status.textContent = '视频已结束'; return; }
    if (video.paused || video.seeking || waiting) {
      if (utterance && !synth.paused) { synth.pause(); blocked = true; }
      restoreVolume();
      status.textContent = video.seeking ? '正在同步播放位置…' : '同传已开启 · 随视频暂停';
      return;
    }
    const index = findSegment(video.currentTime);
    if (index !== current) { reset(); current = index; }
    if (blocked) {
      blocked = false; synth.resume();
      // Exclude time spent paused from rate calibration.
      spokenAt = performance.now();
      if (utterance) { lowerVolume(); status.textContent = '正在播报中文'; }
    }
    if (index < 0) { restoreVolume(); status.textContent = LABEL.waiting; return; }
    if (!utterance && box.dataset.spoken !== String(index)) {
      box.dataset.spoken = String(index);
      speak(index);
    }
  }
  function seek() { reset(); delete box.dataset.spoken; }
  function play() { waiting = false; tick(); }
  function buffering() { waiting = true; tick(); }
  function rateChange() { seek(); tick(); }
  const events = {pause:tick, playing:play, seeking:seek, seeked:tick, waiting:buffering, ended:tick, ratechange:rateChange};
  function attach() {
    const candidates = [...document.querySelectorAll(videoSelector || 'video')];
    const next = candidates.find(v => v.offsetWidth > 0) || candidates[0] || null;
    if (next === video) return;
    reset(); restoreVolume();
    if (video) for (const [name, handler] of Object.entries(events)) video.removeEventListener(name, handler);
    video = next; waiting = false; delete box.dataset.spoken;
    if (video) for (const [name, handler] of Object.entries(events)) video.addEventListener(name, handler);
  }
  button.onclick = () => { delete box.dataset.spoken; setActive(!active); };
  duck.onchange = () => { if (!duck.checked) restoreVolume(); else if (active && utterance && !video.paused) lowerVolume(); };
  select.onchange = () => { seek(); tick(); };
  if (!synth || !window.SpeechSynthesisUtterance) {
    button.disabled = true; status.textContent = '当前浏览器不支持中文语音，请使用 Chrome。'; return;
  }
  synth.addEventListener('voiceschanged', refreshVoices);
  refreshVoices(); attach();
  const poll = () => { attach(); tick(); };
  const POLL_MS = 200;
  let timer = setInterval(poll, POLL_MS);
  window.addEventListener('pagehide', () => { setActive(false); clearInterval(timer); timer = null; });
  window.addEventListener('pageshow', () => {
    if (timer === null) { attach(); timer = setInterval(poll, POLL_MS); }
  });
}
