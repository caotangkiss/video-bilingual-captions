const {test} = require('node:test');
const assert = require('node:assert/strict');
const {CaptionTranslator, CAPTION_SETTINGS, recordingIndex} = require('../assets/translation-runtime.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferredTranslator() {
  const calls = [];
  const translator = new CaptionTranslator((text, signal) => new Promise((resolve, reject) => calls.push({text, signal, resolve, reject})));
  return {translator, calls};
}

test('seeking replaces queue; late results cannot overwrite a newer request', async () => {
  const {translator, calls} = deferredTranslator();
  translator.setWanted(['old', 'prefetch', 'queued']);
  await flush();
  assert.equal(calls.length, CAPTION_SETTINGS.concurrency);
  translator.setWanted(['new']);
  await flush();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, true);
  calls[0].resolve('过期');
  calls[2].resolve('新字幕');
  await flush();
  assert.equal(translator.get('old'), undefined);
  assert.equal(translator.get('new').zh, '新字幕');
  assert.equal(calls.some(c => c.text === 'queued'), false);
});

test('duplicate captions share requests; failures require explicit retry', async () => {
  const {translator, calls} = deferredTranslator();
  translator.setWanted(['A', 'A']);
  await flush();
  assert.equal(calls.length, 1);
  calls[0].reject(new Error('offline'));
  await flush();
  translator.setWanted(['A']);
  await flush();
  assert.equal(calls.length, 1);
  translator.retry();
  await flush();
  calls[1].resolve('甲');
  await flush();
  translator.setWanted(['A']);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(translator.get('A').zh, '甲');
});

test('closing cancels work; reopening ignores late responses from old session', async () => {
  const {translator, calls} = deferredTranslator();
  translator.setWanted(['A']); await flush();
  translator.setWanted([]);
  translator.setWanted(['A']); await flush();
  calls[1].resolve('新的'); await flush();
  calls[0].resolve('旧的'); await flush();
  assert.equal(translator.get('A').zh, '新的');
});

test('live history stays bounded across a long session', async () => {
  const translator = new CaptionTranslator(async text => '译' + text);
  for (let i = 0; i < CAPTION_SETTINGS.cacheSize + 20; i++) {
    translator.setWanted(['line-' + i]);
    await flush();
  }
  assert.ok(translator.records.size <= CAPTION_SETTINGS.cacheSize + 1);
});

test('timeline lookup follows seeks and time before the first cue', () => {
  const cues = [{start: 1}, {start: 5}, {start: 10}];
  assert.equal(recordingIndex(cues, 0), -1);
  assert.equal(recordingIndex(cues, 9), 1);
  assert.equal(recordingIndex(cues, 1), 0);
});
