// Bundled by build_userscript.py. Also importable by the Node regression tests.
const CAPTION_SETTINGS = Object.freeze({
  tickMs: 250, lookAheadSeconds: 15, stableMs: 350, maxLatencyMs: 3000,
  requestTimeoutMs: 12000, concurrency: 2, cacheSize: 500,
  modes: {full: '1. 全部翻译完，但起步慢', stream: '2. 同步翻译，略微延迟'},
});

class CaptionTranslator {
  constructor(request, onChange = () => {}, now = () => Date.now()) {
    this.request = request;
    this.onChange = onChange;
    this.now = now;
    this.records = new Map();
    this.active = new Map();
    this.wanted = [];
  }
  get(text) { return this.records.get(text); }
  setWanted(texts) {
    this.wanted = [...new Set(texts.filter(Boolean))];
    const wanted = new Set(this.wanted);
    for (const [text, job] of this.active) {
      if (!wanted.has(text)) {
        this.active.delete(text);
        this.records.delete(text);
        job.abort();
      }
    }
    // Bound live-session history without evicting the recording's requested work.
    for (const [text] of this.records) {
      if (this.records.size <= CAPTION_SETTINGS.cacheSize) break;
      if (!wanted.has(text)) this.records.delete(text);
    }
    this.pump();
  }
  retry() {
    for (const [text, record] of this.records) if (record.error) this.records.delete(text);
    this.pump();
  }
  pump() {
    for (const text of this.wanted) {
      if (this.active.size >= CAPTION_SETTINGS.concurrency) break;
      if (this.records.has(text)) continue;
      const record = {started: this.now(), zh: '', error: ''};
      this.records.set(text, record);
      const aborter = new AbortController();
      this.active.set(text, aborter);
      Promise.resolve().then(() => this.request(text, aborter.signal)).then(zh => {
        if (this.records.get(text) !== record) return;
        if (typeof zh !== 'string' || !zh.trim()) throw new Error('翻译服务返回空译文');
        record.zh = zh.trim();
      }).catch(error => {
        if (this.records.get(text) === record) record.error = error.message || '翻译失败';
      }).finally(() => {
        if (this.active.get(text) === aborter) this.active.delete(text);
        this.onChange();
        this.pump();
      });
    }
  }
}

function recordingIndex(cues, time) {
  let lo = 0, hi = cues.length - 1, index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) { index = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return index;
}

function requestTranslation(text, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('已取消')); return; }
    if (typeof GM_xmlhttpRequest !== 'function') { reject(new Error('请通过用户脚本管理器启用翻译权限')); return; }
    const headers = {'Content-Type': 'application/json'};
    if (config.token) headers.Authorization = 'Bearer ' + config.token;
    const finish = callback => value => { signal.removeEventListener('abort', abort); callback(value); };
    let request;
    const abort = () => { if (request) request.abort(); };
    signal.addEventListener('abort', abort, {once: true});
    request = GM_xmlhttpRequest({
      method: 'POST', url: config.translationUrl, headers, anonymous: true,
      data: JSON.stringify({text, source: 'en', target: 'zh'}),
      timeout: CAPTION_SETTINGS.requestTimeoutMs,
      onload: finish(response => {
        if (response.status < 200 || response.status >= 300) { reject(new Error('翻译服务错误（' + response.status + '）')); return; }
        try { resolve(JSON.parse(response.responseText).zh); }
        catch (_) { reject(new Error('翻译服务返回格式错误')); }
      }),
      onerror: finish(() => reject(new Error('翻译服务不可用，请检查连接'))),
      ontimeout: finish(() => reject(new Error('翻译超时，可重试'))),
      onabort: finish(() => reject(new Error('已取消'))),
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {CAPTION_SETTINGS, CaptionTranslator, recordingIndex};
}
