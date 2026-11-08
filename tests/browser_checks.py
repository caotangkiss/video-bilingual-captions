#!/usr/bin/env python3
"""Exercise generated userscripts in an isolated headless Chrome profile (no real API)."""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_userscript import ASSETS, build

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TEMPLATE = (ASSETS / 'player.user.js').read_text()
TIMELINE = {'cues': [
    {'start': 0, 'end': 5, 'en': 'Hello'},
    {'start': 5, 'end': 10, 'en': 'Welcome'},
    {'start': 60, 'end': 70, 'en': 'After seek'},
]}
SETUP = '''
const v = document.querySelector('video');
let playTime = 0;
Object.defineProperty(v, 'currentTime', {get: () => playTime});
const track = {language: 'en', kind: 'captions', mode: 'showing', activeCues: []};
Object.defineProperty(v, 'textTracks', {get: () => [track]});
const liveNode = document.createElement('div'); liveNode.id = 'live-source'; document.body.append(liveNode);
const calls = [];
window.GM_xmlhttpRequest = options => {
  const call = {text: JSON.parse(options.data).text, aborted: false};
  call.reply = zh => options.onload({status: 200, responseText: JSON.stringify({zh})});
  call.fail = () => options.onerror();
  calls.push(call);
  return {abort() {call.aborted = true; options.onabort();}};
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
function check(ok, message) {if (!ok) throw new Error(message);}
'''
COMMON = '''
const panel = document.getElementById('pai-bilingual-panel');
const header = panel.firstElementChild;
const grid = header.nextElementSibling;
const [en, zh] = grid.children;
const mode = panel.querySelector('select');
const buttons = [...panel.querySelectorAll('button')];
'''
SPEECH_SETUP = '''
let videoPaused = true;
Object.defineProperty(v, 'paused', {get: () => videoPaused});
v.volume = 0.8;
const speech = new EventTarget();
Object.assign(speech, {
  paused: false, spoken: [], current: null,
  getVoices: () => [{lang: 'zh-CN', voiceURI: 'test-local', name: 'Test voice', localService: true}],
  speak(u) {this.spoken.push(u); this.current = u; u.onstart();},
  cancel() {this.current = null;},
  pause() {this.paused = true;}, resume() {this.paused = false;},
});
Object.defineProperty(window, 'speechSynthesis', {value: speech});
window.SpeechSynthesisUtterance = function(text) {this.text = text;};
'''
CASES = {
    'stream': '''
await sleep(50);
check(!document.getElementById('pai-voice-controls'), 'Caption-only build has no speech controls');
check(en.textContent === 'Hello' && zh.textContent === '', 'English is immediate');
check(calls.map(c => c.text).join(',') === 'Hello,Welcome', 'Bounded lookahead');
calls[0].reply('你好'); calls[1].reply('欢迎'); await sleep(30);
check(zh.textContent === '你好', 'First pair');
playTime = 5; await sleep(300);
check(en.textContent === 'Welcome' && zh.textContent === '欢迎', 'Second pair');
playTime = 60; await sleep(300);
check(en.textContent === 'After seek' && zh.textContent === '', 'Seek clears previous Chinese');
check(calls[2].text === 'After seek', 'Seek prioritizes new cue');
playTime = 0; await sleep(300);
check(calls[2].aborted, 'Obsolete request aborted');
calls[2].reply('迟到的译文'); await sleep(30);
check(zh.textContent === '你好', 'Late reply cannot overwrite current pair');
buttons.find(b => b.textContent.includes('切换透明')).click();
check(panel.style.background === 'transparent', 'Transparency kept');
buttons.find(b => b.textContent.includes('关闭翻译')).click();
check(getComputedStyle(panel).display === 'none', 'Close hides panel');
[...document.querySelectorAll('button')].find(b => b.textContent === '开启双语字幕').click();
check(getComputedStyle(panel).display !== 'none', 'Reopen works');
check(track.mode === 'showing', 'Native CC untouched');
''',
    'full': '''
await sleep(50);
check(en.textContent.includes('准备完整'), 'Full mode waits');
calls[0].reply('你好'); await sleep(50);
check(en.textContent.includes('准备完整'), 'Partial result stays hidden');
mode.value = 'stream'; mode.dispatchEvent(new Event('change')); await sleep(50);
check(en.textContent === 'Hello' && zh.textContent === '你好', 'Switch uses completed cache');
check(calls[2].aborted, 'Switch cancels far future work');
mode.value = 'full'; mode.dispatchEvent(new Event('change')); await sleep(50);
calls[1].reply('欢迎'); calls[3].reply('跳转之后'); await sleep(50);
check(en.textContent === 'Hello' && zh.textContent === '你好', 'Full mode starts after all ready');
''',
    'speech': '''
await sleep(50);
const voiceButton = document.getElementById('pai-voice-toggle');
check(voiceButton && speech.spoken.length === 0, 'Speech is optional and off by default');
voiceButton.click();
check(speech.spoken.length === 0, 'Paused video stays silent');
videoPaused = false; v.dispatchEvent(new Event('playing'));
check(speech.current.text === '你好' && Math.abs(v.volume - 0.16) < 0.001, 'First spoken cue and ducking');
buttons.find(b => b.textContent.includes('关闭翻译')).click();
check(getComputedStyle(panel).display === 'none' && speech.current, 'Closing captions leaves speech active');
videoPaused = true; v.dispatchEvent(new Event('pause'));
check(speech.paused && v.volume === 0.8, 'Pause restores original audio');
videoPaused = false; v.dispatchEvent(new Event('playing'));
check(!speech.paused && speech.spoken.length === 1, 'Resume continues the same cue');
playTime = 5; await sleep(300);
check(speech.current.text === '欢迎', 'Second cue follows video with captions hidden');
voiceButton.click(); check(!speech.current && v.volume === 0.8, 'Off stops speech and restores volume');
[...document.querySelectorAll('button')].find(b => b.textContent === '开启双语字幕').click();
await sleep(300);
check(en.textContent === 'Welcome' && zh.textContent === '欢迎', 'Captions still work with speech off');
check(track.mode === 'showing', 'Speech leaves native CC unchanged');
''',
    'live': '''
check(mode.querySelector('option[value="full"]').disabled, 'Full mode unavailable for live');
track.activeCues = [{text: 'Hello'}]; await sleep(850);
check(en.textContent === 'Hello' && calls[0].text === 'Hello', 'Live cue read and translated');
track.activeCues = [{text: 'Hello there'}]; await sleep(300);
check(calls[0].aborted && zh.textContent === '', 'Partial revision cancels old work');
calls[0].reply('旧译文'); await sleep(550);
check(zh.textContent === '' && calls[1].text === 'Hello there', 'Late partial stays hidden');
calls[1].reply('你们好'); await sleep(50);
check(en.textContent === 'Hello there' && zh.textContent === '你们好', 'First live pair');
track.activeCues = [{text: 'Welcome'}]; await sleep(850);
calls[2].reply('欢迎'); await sleep(50);
check(en.textContent === 'Welcome' && zh.textContent === '欢迎', 'Second live pair');
track.activeCues = []; await sleep(300);
check(zh.textContent === '', 'Live silence clears Chinese');
check(track.mode === 'showing', 'Live adapter leaves native CC unchanged');
''',
    'dom': '''
liveNode.textContent = 'Hello'; await sleep(850);
check(calls[0].text === 'Hello', 'DOM subtitle read');
calls[0].reply('你好'); await sleep(50);
check(zh.textContent === '你好', 'DOM translated');
liveNode.style.display = 'none'; await sleep(300);
check(zh.textContent === '' && en.textContent.includes('等待'), 'Hidden source cleared');
liveNode.style.display = 'block'; liveNode.textContent = 'Welcome'; await sleep(850);
calls[1].reply('欢迎'); await sleep(50);
check(zh.textContent === '欢迎', 'DOM replacement resumes translation');
''',
    'failure': '''
await sleep(3500);
check(panel.lastElementChild.textContent.includes('延迟较高'), 'Slow provider status');
check(en.textContent === 'Hello' && zh.textContent === '', 'Slow response keeps source');
calls[0].fail(); await sleep(50);
check(panel.lastElementChild.textContent.includes('不可用'), 'Provider error visible');
const retry = buttons.find(b => b.textContent === '重试翻译');
check(!retry.hidden, 'Retry available'); retry.click(); await sleep(50);
calls[2].reply('你好'); await sleep(50);
check(zh.textContent === '你好', 'Retry recovers');
window.dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
playTime = 60; window.dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
await sleep(300);
check(en.textContent === 'After seek', 'Back-forward cache resumes polling');
''',
}


def main():
    with tempfile.TemporaryDirectory(prefix='bilingual-browser-') as tmp:
        for name, checks in CASES.items():
            live = name in ('live', 'dom')
            data = {} if live else TIMELINE
            if name == 'speech':
                data = {'cues': [dict(c, zh=zh) for c, zh in zip(TIMELINE['cues'], ['你好', '欢迎', '跳转之后'])]}
            script = build(data, 'https://example.com/watch/test', TEMPLATE,
                           live=live, mode='full' if name == 'full' else 'stream',
                           source_selector='#live-source' if name == 'dom' else '',
                           speech=name == 'speech',
                           translation_url='http://127.0.0.1:8766/translate')
            path = Path(tmp) / (name + '.html')
            checks = COMMON + checks
            html = '<!doctype html><meta charset="UTF-8"><video style="width:640px;height:360px"></video><pre id="result">RUNNING</pre>'
            html += '<script>' + SETUP + (SPEECH_SETUP if name == 'speech' else '') + '</script><script>' + script + '</script><script>'
            html += '(async()=>{try{' + checks + '\ndocument.getElementById("result").textContent="PASS";}catch(e){document.getElementById("result").textContent="FAIL: "+e.message;}})();</script>'
            path.write_text(html)
            result = subprocess.run([CHROME, '--headless', '--no-first-run', '--no-default-browser-check',
                '--disable-background-networking', '--disable-extensions', '--disable-sync',
                '--user-data-dir=' + str(Path(tmp) / ('profile-' + name)),
                '--virtual-time-budget=8000', '--dump-dom', path.as_uri()], capture_output=True, text=True, timeout=30)
            if '<pre id="result">PASS</pre>' not in result.stdout:
                import re
                message = re.search(r'<pre id="result">(.*?)</pre>', result.stdout)
                raise RuntimeError(name + ': ' + (message.group(1) if message else result.stderr[-2000:]))
            print(name + ': PASS')


if __name__ == '__main__':
    main()
