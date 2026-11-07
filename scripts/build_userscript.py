#!/usr/bin/env python3
"""Build a video-specific bilingual userscript using the maintained local UI."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlsplit


def build(data, match, template):
    cues = data['cues']
    if not cues:
        raise ValueError('No subtitle cues')
    for cue in cues:
        if not (isinstance(cue['start'], (int, float)) and isinstance(cue['end'], (int, float)) and 0 <= cue['start'] < cue['end']):
            raise ValueError('Invalid cue timestamps')
        if not all(isinstance(cue[k], str) and cue[k].strip() for k in ('en', 'zh')):
            raise ValueError('Each cue needs English and Chinese text')
    cues = sorted(cues, key=lambda c: c['start'])
    url = urlsplit(match)
    if url.scheme != 'https' or not url.netloc or url.path in ('', '/', '/*') or '\n' in match:
        raise ValueError('Use a specific HTTPS video page match')
    encoded = json.dumps(cues, ensure_ascii=False, separators=(',', ':'))
    result, count = re.subn(r'^const cues = .*?;\s*$', lambda _: 'const cues = ' + encoded + ';', template, count=1, flags=re.M)
    if count != 1:
        raise ValueError('Maintained template cue marker missing')
    result = re.sub(r'^// @match\s+.*$', lambda _: '// @match        ' + match, result, flags=re.M)
    result = re.sub(r'^// @name\s+.*$', lambda _: '// @name         视频双语字幕 ' + url.path[-40:], result, flags=re.M)
    begin = result.index('function time(){')
    end = result.index('\nsetInterval', begin)
    result = result[:begin] + "function time(){const vs=[...document.querySelectorAll('video')];const v=vs.find(v=>v.offsetWidth>0)||vs[0];return v&&Number.isFinite(v.currentTime)?v.currentTime:-1;}" + result[end:]
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True, type=Path)
    parser.add_argument('--match', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / 'assets' / 'player.user.js'
    result = build(json.loads(args.data.read_text()), args.match, source.read_text())
    args.output.write_text(result)
    print(f'Built {args.output}')


if __name__ == '__main__':
    main()
