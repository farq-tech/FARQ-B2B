#!/usr/bin/env python3
"""Compare every number shown on a screen before vs after a UI change.

Usage: scripts/numbers-diff.py before.html after.html [label]
Inputs are `chrome --dump-dom` captures of the dev harness. Extracts each visible
text node that contains a digit, normalises bidi isolates, and compares
(a) the multiset of text nodes with numbers and (b) the multiset of numeric tokens.
Exit code 1 when they differ.
"""
import re, sys
from collections import Counter
from html.parser import HTMLParser

ISOLATES = dict.fromkeys(map(ord, '⁦⁧⁨⁩‎‏؜'), None)
NUM = re.compile(r'[+\-]?\d[\d,]*(?:\.\d+)?%?')

class Texts(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.inroot = False; self.depth = 0; self.out = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'svg', 'title'): self.skip += 1
        if dict(attrs).get('id') == 'root': self.inroot = True
    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'svg', 'title'): self.skip -= 1
    def handle_data(self, data):
        t = ' '.join(data.translate(ISOLATES).split())
        if self.inroot and not self.skip and t and any(c.isdigit() for c in t): self.out.append(t)

def load(path):
    p = Texts(); p.feed(open(path, encoding='utf-8').read()); return p.out

def main():
    a, b = load(sys.argv[1]), load(sys.argv[2])
    label = sys.argv[3] if len(sys.argv) > 3 else ''
    ta, tb = Counter(a), Counter(b)
    na = Counter(n for t in a for n in NUM.findall(t)); nb = Counter(n for t in b for n in NUM.findall(t))
    print(f'## {label}\n')
    print(f'| | قبل | بعد |\n|---|---|---|\n| نصوص فيها أرقام | {sum(ta.values())} | {sum(tb.values())} |\n| أرقام منفردة | {sum(na.values())} | {sum(nb.values())} |\n')
    only_a, only_b = ta - tb, tb - ta
    num_a, num_b = na - nb, nb - na
    ok = not num_a and not num_b
    print(f'**الأرقام: {"متطابقة" if ok else "غير متطابقة"}**\n')
    if only_a or only_b:
        print('نصوص اختلفت صياغتها (الأرقام داخلها تُقارن في السطر أعلاه):\n')
        for t, c in sorted(only_a.items()): print(f'- قبل ×{c}: `{t}`')
        for t, c in sorted(only_b.items()): print(f'- بعد ×{c}: `{t}`')
        print()
    if num_a or num_b: print(f'أرقام في قبل فقط: {dict(num_a)}\n\nأرقام في بعد فقط: {dict(num_b)}\n')
    print('<details><summary>كل النصوص الرقمية (بعد)</summary>\n')
    for t, c in sorted(tb.items()): print(f'- ×{c} `{t}`')
    print('\n</details>\n')
    return 0 if ok else 1

sys.exit(main())
