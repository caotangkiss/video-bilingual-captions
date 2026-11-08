#!/usr/bin/env python3
"""Build a video-specific userscript for prepared, incremental, or live captions."""
import argparse
import json
import math
import re
from pathlib import Path
from urllib.parse import urlsplit

ASSETS = Path(__file__).resolve().parents[1] / 'assets'


def build(data, match, template, *, mode=None, live=False,
          translation_url='', token='', source_selector='', video_selector='', speech=False):
    if not isinstance(data, dict) or not isinstance(data.get('cues', []), list):
        raise ValueError('Expected a JSON object with a cues array')
    cues = data.get('cues', [])
    mode = mode or ('stream' if live else 'full')
    if mode not in ('full', 'stream') or (live and mode != 'stream'):
        raise ValueError('Live captions require stream mode')
    if live and cues:
        raise ValueError('Live captions must not contain a recording timeline')
    if not live and not cues:
        raise ValueError('No subtitle cues')
    for cue in cues:
        if not isinstance(cue, dict):
            raise ValueError('Each cue must be an object')
        if not all(type(cue.get(k)) in (int, float) and math.isfinite(cue[k]) for k in ('start', 'end')) or not 0 <= cue['start'] < cue['end']:
            raise ValueError('Invalid cue timestamps')
        if not isinstance(cue.get('en'), str) or not cue['en'].strip():
            raise ValueError('Each cue needs English text')
        if 'zh' in cue and not isinstance(cue['zh'], str):
            raise ValueError('Chinese text must be a string')
    cues = [dict(c, en=c['en'].strip(), zh=c.get('zh', '').strip()) for c in cues]
    if speech and (live or any(not c['zh'] for c in cues)):
        raise ValueError('--speech requires a recording with complete Chinese translations; live/incremental speech is not supported')
    url = urlsplit(match)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or '*' in url.netloc or url.path in ('', '/', '/*')
            or any(c.isspace() for c in match) or url.fragment):
        raise ValueError('Use a specific HTTPS video page match')
    if (live or any(not c.get('zh', '').strip() for c in cues)) and not translation_url:
        raise ValueError('Untranslated/live captions need --translation-url')
    if source_selector and not live:
        raise ValueError('--source-selector is only used with --live')
    endpoint = urlsplit(translation_url)
    if translation_url and (not endpoint.hostname or '*' in endpoint.netloc or endpoint.username or endpoint.password
            or endpoint.fragment or any(c.isspace() for c in translation_url)
            or not (endpoint.scheme == 'https' or (endpoint.scheme == 'http' and endpoint.hostname in ('127.0.0.1', 'localhost', '::1')))):
        raise ValueError('Translation URL must use HTTPS or loopback HTTP')
    config = dict(mode=mode, live=live, translationUrl=translation_url, token=token,
                  sourceSelector=source_selector, videoSelector=video_selector)
    result = template
    for marker, value in [('cues', sorted(cues, key=lambda c: c['start'])), ('config', config)]:
        result, count = re.subn(r'^const ' + marker + r' = .*?;$',
                               lambda _: 'const ' + marker + ' = ' + json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + ';',
                               result, count=1, flags=re.M)
        if count != 1:
            raise ValueError(f'Maintained template {marker} marker missing')
    for marker, filename in [('TRANSLATION_RUNTIME', 'translation-runtime.js'), ('CAPTION_CONTROLLER', 'caption-controller.js')]:
        placeholder = '/* ' + marker + ' */'
        if result.count(placeholder) != 1:
            raise ValueError(f'Maintained template {marker} marker missing')
        result = result.replace(placeholder, (ASSETS / filename).read_text(encoding='utf-8'))
    placeholder = '/* OPTIONAL_SPEECH */'
    if result.count(placeholder) != 1:
        raise ValueError('Maintained template OPTIONAL_SPEECH marker missing')
    speech_code = ''
    if speech:
        speech_code = (ASSETS / 'chinese-interpretation.js').read_text(encoding='utf-8')
        speech_code += '\ninstallChineseInterpretation(cues, {videoSelector: config.videoSelector});'
    result = result.replace(placeholder, speech_code)
    result = re.sub(r'^// @match\s+.*$', lambda _: '// @match        ' + match, result, flags=re.M)
    result = re.sub(r'^// @name\s+.*$', lambda _: '// @name         视频双语字幕 ' + url.path[-40:], result, flags=re.M)
    if translation_url:
        result = result.replace('// @grant        none', '// @grant        GM_xmlhttpRequest\n// @connect      ' + endpoint.hostname)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, help='Recording cues; zh may be omitted with a translator')
    parser.add_argument('--match', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--mode', choices=['full', 'stream'])
    parser.add_argument('--live', action='store_true', help='Read active English TextTrack cues or a caption DOM selector')
    parser.add_argument('--speech', action='store_true', help='Add an independent Chinese speech toggle (fully translated recording only)')
    parser.add_argument('--source-selector', default='')
    parser.add_argument('--video-selector', default='')
    parser.add_argument('--translation-url', default='')
    parser.add_argument('--token-file', type=Path, help='Local bridge token, not a provider API key')
    args = parser.parse_args()
    try:
        data = json.loads(args.data.read_text(encoding='utf-8')) if args.data else {}
        result = build(data, args.match, (ASSETS / 'player.user.js').read_text(encoding='utf-8'),
                       mode=args.mode, live=args.live, translation_url=args.translation_url,
                       token=args.token_file.read_text().strip() if args.token_file else '',
                       source_selector=args.source_selector, video_selector=args.video_selector, speech=args.speech)
    except (ValueError, KeyError, TypeError) as exc:
        parser.error(str(exc))
    args.output.write_text(result, encoding='utf-8')
    print(f'Built {args.output}')


if __name__ == '__main__':
    main()
