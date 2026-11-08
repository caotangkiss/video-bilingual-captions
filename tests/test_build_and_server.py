import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_userscript import ASSETS, build
from translation_server import make_handler, translate

TEMPLATE = (ASSETS / 'player.user.js').read_text()
MATCH = 'https://example.com/watch/lesson-1'
ENDPOINT = 'http://127.0.0.1:8766/translate'


class BuilderTests(unittest.TestCase):
    def test_existing_pretranslated_input_stays_offline(self):
        result = build({'cues': [{'start': 0, 'end': 3, 'en': 'Hello', 'zh': '你好'}]}, MATCH, TEMPLATE)
        self.assertIn('// @grant        none', result)
        self.assertIn('"mode":"full"', result)
        self.assertNotIn('/* CAPTION_CONTROLLER */', result)
        self.assertNotIn('installChineseInterpretation', result)

    def test_optional_speech_uses_recording_translations_and_video_selector(self):
        data = {'cues': [{'start': 0, 'end': 3, 'en': 'Hello', 'zh': '你好'}]}
        result = build(data, MATCH, TEMPLATE, speech=True, video_selector='#lesson')
        self.assertIn('installChineseInterpretation(cues, {videoSelector: config.videoSelector})', result)
        self.assertIn('"videoSelector":"#lesson"', result)
        self.assertNotIn('/* OPTIONAL_SPEECH */', result)
        self.assertIn('// @grant        none', result)

    def test_speech_rejects_live_and_incomplete_translations(self):
        for data, live in [({}, True), ({'cues': [{'start': 0, 'end': 3, 'en': 'Hello'}]}, False)]:
            with self.subTest(live=live), self.assertRaisesRegex(ValueError, '--speech requires'):
                build(data, MATCH, TEMPLATE, live=live, translation_url=ENDPOINT, speech=True)

    def test_incremental_and_live_inputs(self):
        for live in [False, True]:
            with self.subTest(live=live):
                data = {} if live else {'cues': [{'start': 0, 'end': 2, 'en': 'Hello'}]}
                result = build(data, MATCH, TEMPLATE, mode='stream', live=live, translation_url=ENDPOINT)
                self.assertIn('// @connect      127.0.0.1', result)
                self.assertIn('"mode":"stream"', result)
                self.assertIn('"live":' + str(live).lower(), result)

    def test_rejects_missing_translation_source_and_invalid_live_modes(self):
        for options in [{}, {'live': True}, {'live': True, 'mode': 'full', 'translation_url': ENDPOINT}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                build({}, MATCH, TEMPLATE, **options)

    def test_rejects_bad_timestamps_and_endpoints(self):
        for start in [float('nan'), float('inf'), True, -1]:
            with self.subTest(start=start), self.assertRaises(ValueError):
                build({'cues': [{'start': start, 'end': 5, 'en': 'Hi', 'zh': '你好'}]}, MATCH, TEMPLATE)
        for endpoint in ['http://external.example/translate', 'https://a.example/\n// @grant none']:
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                build({}, MATCH, TEMPLATE, live=True, translation_url=endpoint)

    def test_partial_cues_normalize_whitespace_without_mutating_input(self):
        data = {'cues': [{'start': 0, 'end': 3, 'en': ' Hello ', 'zh': ' '}]}
        result = build(data, MATCH, TEMPLATE, translation_url=ENDPOINT)
        self.assertIn('"en":"Hello","zh":""', result)
        self.assertEqual(data['cues'][0]['zh'], ' ')
        for data in [[], None, {'cues': 'bad'}, {'cues': ['bad']}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                build(data, MATCH, TEMPLATE)


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        def translator(text):
            self.calls.append(text)
            if text == 'fail':
                raise ValueError('private provider details')
            return '你好'
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler('local-test', translator))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.endpoint = f'http://127.0.0.1:{self.server.server_port}/translate'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, payload, token='local-test'):
        request = Request(self.endpoint, data=json.dumps(payload).encode(), headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, json.load(response)

    def test_auth_validation_and_translation(self):
        self.assertEqual(self.post({'text': 'Hello'}, 'wrong')[0], 401)
        self.assertEqual(self.post({'text': ''})[0], 400)
        self.assertEqual(self.post(['bad'])[0], 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.post({'text': 'Hello'}), (200, {'zh': '你好'}))
        code, data = self.post({'text': 'fail'})
        self.assertEqual(code, 502)
        self.assertNotIn('private', json.dumps(data))

    def test_provider_contract(self):
        captured = []
        class Provider(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                captured.append((self.headers.get('Authorization'), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'choices': [{'message': {'content': '你好'}}]}).encode())
        provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
        thread = threading.Thread(target=provider.serve_forever, daemon=True)
        thread.start()
        try:
            result = translate('Hello', f'http://127.0.0.1:{provider.server_port}/chat/completions', 'test-model', 'test-key')
            self.assertEqual(result, '你好')
            self.assertEqual(captured[0][0], 'Bearer test-key')
            self.assertEqual(captured[0][1]['messages'][-1], {'role': 'user', 'content': 'Hello'})
        finally:
            provider.shutdown()
            provider.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
