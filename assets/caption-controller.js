const modePicker = document.createElement('select');
modePicker.setAttribute('aria-label', '翻译模式');
for (const [value, title] of Object.entries(CAPTION_SETTINGS.modes)) {
  const option = document.createElement('option');
  option.value = value; option.textContent = title;
  option.disabled = config.live && value === 'full';
  modePicker.append(option);
}
header.style.flexWrap = 'wrap';
header.style.gap = '6px';
header.insertBefore(modePicker, close);
const status = document.createElement('div');
status.style.cssText = 'font-size:12px;margin-top:6px';
status.setAttribute('role', 'status');
const retry = document.createElement('button');
retry.type = 'button'; retry.textContent = '重试翻译'; retry.hidden = true;
header.insertBefore(retry, close);
panel.append(status);
const modeKey = 'pai-bilingual-mode:' + location.pathname + location.search;
let mode = config.mode;
try {
  const saved = localStorage.getItem(modeKey);
  if (!config.live && Object.hasOwn(CAPTION_SETTINGS.modes, saved)) mode = saved;
} catch (_) {}
modePicker.value = mode;
modePicker.title = config.live ? '直播没有完整时间轴，只能同步翻译' : '可随时切换；已完成的译文会复用';
const translator = new CaptionTranslator(requestTranslation, () => { if (enabled) render(); });
let liveText = '', liveSince = 0, liveVideo = null, liveTime = -1;
let sourceError = '', sourceHint = '';

function video() {
  if (config.videoSelector) return document.querySelector(config.videoSelector);
  const videos = [...document.querySelectorAll('video')];
  return videos.find(v => v.offsetWidth > 0) || videos[0];
}
function readLive(v) {
  sourceHint = '';
  if (config.sourceSelector) {
    const nodes = [...document.querySelectorAll(config.sourceSelector)]
      .filter(node => !panel.contains(node) && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    if (!nodes.length) sourceHint = '等待直播字幕；请确认平台字幕已开启';
    return nodes.map(node => node.innerText || node.textContent).join('\n').trim();
  }
  const tracks = v ? [...v.textTracks] : [];
  const track = tracks.find(t => /^(en|eng)(-|$)/i.test(t.language) && ['captions', 'subtitles'].includes(t.kind) && t.mode !== 'disabled');
  if (!track) { sourceHint = '未读到英文实时字幕轨；请开启平台英文 CC 或适配字幕选择器'; return ''; }
  // Read-only: never change the platform's track mode or CC handlers.
  return [...(track.activeCues || [])].map(cue => {
    const fragment = typeof cue.getCueAsHTML === 'function' ? cue.getCueAsHTML() : null;
    return fragment ? fragment.textContent : cue.text;
  }).join('\n').trim();
}
function translated(cue) { return cue.zh || translator.get(cue.en)?.zh || ''; }
function saveRecordingResults() {
  for (const cue of cues) if (!cue.zh) cue.zh = translator.get(cue.en)?.zh || '';
}
function currentRecording(v) {
  const time = v && Number.isFinite(v.currentTime) ? v.currentTime : -1;
  const index = recordingIndex(cues, time);
  // Preserve prepared-caption behavior: hold the last line until the next cue.
  const current = index < 0 ? null : (mode === 'full' || time < cues[index].end ? cues[index] : null);
  return {time, index, current};
}
function tick() {
  if (!enabled) return;
  try {
    sourceError = '';
    const v = video();
    if (config.live) {
      const text = readLive(v);
      const time = v?.currentTime ?? -1;
      if (text !== liveText || v !== liveVideo || Math.abs(time - liveTime) > 2) {
        liveText = text; liveSince = Date.now(); liveVideo = v;
        translator.setWanted([]);
      }
      liveTime = time;
      // Wait briefly for partial speech-recognition captions to settle.
      if (liveText && Date.now() - liveSince >= CAPTION_SETTINGS.stableMs) translator.setWanted([liveText]);
    } else {
      saveRecordingResults();
      if (mode === 'full') translator.setWanted(cues.filter(c => !c.zh).map(c => c.en));
      else {
        const {time, index, current} = currentRecording(v);
        const upcoming = [];
        if (current && !current.zh) upcoming.push(current.en);
        // A seek replaces the queue; old work cannot delay the new position.
        if (time >= 0) for (let i = index + 1; i < cues.length && cues[i].start <= time + CAPTION_SETTINGS.lookAheadSeconds; i++) {
          if (!cues[i].zh) upcoming.push(cues[i].en);
        }
        translator.setWanted(upcoming);
      }
    }
    render();
  } catch (_) {
    sourceError = '字幕源配置无效或不可访问，请检查视频/字幕选择器';
    translator.setWanted([]);
    en.textContent = ''; zh.textContent = ''; status.textContent = sourceError;
  }
}
function render() {
  if (!enabled || sourceError) return;
  const v = video();
  saveRecordingResults();
  retry.hidden = ![...translator.records.values()].some(record => record.error);
  if (!config.live && mode === 'full') {
    const done = cues.filter(c => c.zh).length;
    if (done < cues.length) {
      en.textContent = '正在准备完整译文…'; zh.textContent = '';
      status.textContent = '已翻译 ' + done + '/' + cues.length + (retry.hidden ? '；可切换同步翻译' : '；翻译失败，请重试或切换同步翻译');
      return;
    }
  }
  const cue = config.live ? {en: liveText} : currentRecording(v).current;
  if (!cue?.en) {
    en.textContent = config.live ? '等待直播字幕…' : '等待课程字幕…'; zh.textContent = '';
    status.textContent = config.live ? sourceHint || '直播 · 同步翻译' : '';
    return;
  }
  en.textContent = cue.en;
  const record = translator.get(cue.en);
  zh.textContent = translated(cue);
  if (zh.textContent) status.textContent = config.live ? '直播 · 同步翻译' : '';
  else if (record?.error) status.textContent = record.error;
  else if (Date.now() - (config.live ? liveSince : record?.started ?? Date.now()) > CAPTION_SETTINGS.maxLatencyMs) status.textContent = '翻译延迟较高，先显示原文';
  else status.textContent = '翻译中…';
}
modePicker.onchange = () => {
  mode = config.live ? 'stream' : modePicker.value;
  modePicker.value = mode;
  try { localStorage.setItem(modeKey, mode); } catch (_) {}
  tick();
};
retry.onclick = () => { translator.retry(); tick(); };
controller = {setEnabled(value) {
  if (value) tick();
  else { saveRecordingResults(); translator.setWanted([]); }
}};
let captionTimer = setInterval(tick, CAPTION_SETTINGS.tickMs);
window.addEventListener('pagehide', () => {
  clearInterval(captionTimer); captionTimer = null; translator.setWanted([]);
});
window.addEventListener('pageshow', () => {
  if (captionTimer === null) { captionTimer = setInterval(tick, CAPTION_SETTINGS.tickMs); tick(); }
});
tick();
