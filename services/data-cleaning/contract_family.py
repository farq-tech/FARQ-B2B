"""A third level (product family) for contractors, from Farq Bina's procurement ontology (src/lib/procurementOntology.data.json).

Only rows whose merged sub is `contract.*` are read. The family is a new column with its source and evidence; it never
changes the main or the sub, and a row with no evidence stays «غير متاح».

The ontology was built for bill-of-quantities lines, not company names, so only its decisive evidence is used:
- a strong term decides, matched as a whole word (an Arabic proclitic such as «لل» or «وال» is allowed) or as a phrase.
  Substring matching is not used: a short term inside an unrelated word («الن» in «النابغة») is the main error it causes;
- a term guard drops a match when none of its `require_any` words is present, any of its `block_any` words is, or one
  of its `blocked_by_head` words comes before the term («عزل ارضيات» is insulation, «لاصق بلاط» an adhesive);
- a family's `negative_terms`, and its sector's (inherited, as mergeRules does), drop it;
- weak terms alone never decide, so they are not read;
- two surviving families in hard conflict, a best match whose evidence another surviving family also carries (a
  strong term shared by two families, such as «دش طوارئ»), or two families tied on evidence length, leave the row
  ambiguous, with no family. `hard_conflicts` name supplier
  archetypes (inherited from the sector, less the family's `hard_conflict_exceptions`), so two families conflict when
  one vetoes an archetype the other prefers, as in procurementOntology.ts.
Family ids and the ontology version are read from the file, never copied, because the ontology splits families over time.

Reads its inputs read-only; writes a new parquet, a report and a review sample next to it. Never writes over a file.

    python3 contract_family.py --merged classification_merged.parquet --ontology procurementOntology.data.json --out contract_family.parquet
"""
import argparse
import collections
import json
import os
import pathlib
import re
import sys

import duckdb
import pyarrow as pa

DIAC = re.compile('[ؐ-ًؚ-ٰٟۖ-ۭـ]')
FOLD = str.maketrans('إأآىة', 'ااايه')
CLITICS = ('وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ك', 'ل')


def norm(s):
    """Lower case, no diacritics, folded alef/ya/ta marbuta, punctuation as spaces, padded with one space each side."""
    s = DIAC.sub('', (s or '').lower()).translate(FOLD)
    return ' ' + re.sub(r'\s+', ' ', re.sub(r'[^\w؀-ۿ]+', ' ', s)).strip() + ' '


def bases(token):
    """The token and the token without each Arabic proclitic, so «للتكييف» also reads as «تكييف»."""
    out = {token}
    for p in CLITICS:
        if token.startswith(p) and len(token) > len(p) + 1:
            out.add(token[len(p):])
    return out


class Tagger:
    def __init__(self, onto):
        self.version = onto['version']
        self.families = onto['families']
        nt = lambda terms: [t for t in (norm(x).strip() for x in terms or []) if t]
        sectors = onto.get('sectors') or {}
        self.hard, self.pref = {}, {}
        for f in self.families:
            veto = set((sectors.get(f.get('sector')) or {}).get('hard_conflicts') or []) | set(f.get('hard_conflicts') or [])
            self.hard[f['id']] = veto - set(f.get('hard_conflict_exceptions') or [])
            self.pref[f['id']] = set(f.get('preferred_archetypes') or [])
        self.fam, self.single, self.multi = [], collections.defaultdict(list), collections.defaultdict(list)
        for i, f in enumerate(self.families):
            strong = set(nt(f.get('strong_terms')))
            self.fam.append({'id': f['id'], 'label': f.get('label_ar'), 'sector': f.get('sector'), 'strong': strong,
                             'neg': nt((sectors.get(f.get('sector')) or {}).get('negative_terms')) + nt(f.get('negative_terms')),
                             'guards': [{'terms': set(nt(g.get('terms'))), 'require': nt(g.get('require_any')),
                                         'block': nt(g.get('block_any')), 'head': nt(g.get('blocked_by_head'))}
                                        for g in f.get('term_guards') or []]})
            for t in strong:
                (self.multi if ' ' in t else self.single)[t].append(i)
        self.by_first = collections.defaultdict(list)   # phrases by their first word, so a name checks only its own
        for t in self.multi:
            self.by_first[t.split()[0]].append(t)

    @staticmethod
    def _words(name):
        return {b for w in name.split() for b in bases(w)}

    def _present(self, term, toks, words):
        """The term is in the name: a word with or without a proclitic, or a phrase whose first word may carry one."""
        return term in words if ' ' not in term else self._at(term, toks) is not None

    @staticmethod
    def _at(term, toks):
        """Index of the first token where the term starts (a word with or without a proclitic, or a phrase), else None."""
        parts = term.split()
        for i in range(len(toks) - len(parts) + 1):
            if parts[0] in bases(toks[i]) and toks[i + 1:i + len(parts)] == parts[1:]:
                return i
        return None

    def _allowed(self, t, g, words, toks):
        """A guard on term t lets it decide (procurementOntology.ts guardAllows)."""
        if t not in g['terms']:
            return True
        if g['require'] and not any(self._present(r, toks, words) for r in g['require']):
            return False
        if any(self._present(b, toks, words) for b in g['block']):
            return False
        at = self._at(t, toks)
        for h in g['head']:   # a head word before the term makes the term the object, not the product
            hat = self._at(h, toks)
            if hat is not None and (at is None or hat < at):
                return False
        return True

    def tag(self, raw):
        """(family or None, status, evidence terms or conflicting ids) for one raw name."""
        name = norm(raw)
        words, toks = self._words(name), name.split()
        hits = {t for t in words if t in self.single} | {
            t for w in words for t in self.by_first.get(w, ()) if self._at(t, toks) is not None}
        if not hits:
            return None, 'no_strong_term', []
        cands = []
        for i in sorted({i for t in hits for i in self.single.get(t, []) + self.multi.get(t, [])}):
            f = self.fam[i]
            if any(self._present(n, toks, words) for n in f['neg']):
                continue
            ok = [t for t in sorted(f['strong'] & hits) if all(self._allowed(t, g, words, toks) for g in f['guards'])]
            if ok:
                cands.append((f, ok))
        if not cands:
            return None, 'guarded_out', []
        ids = [f['id'] for f, _ in cands]
        if any(self.hard[x] & self.pref[y] for x in ids for y in ids if x != y):
            return None, 'ambiguous_conflict', ids
        score = lambda e: sum(len(t) for t in e)
        best, ev = max(cands, key=lambda c: score(c[1]))   # the longest evidence wins
        # another family has all the same evidence, or as much of its own: nothing tells them apart, and the ontology's
        # order must not decide
        shared = [f['id'] for f, e in cands if f is not best and (set(ev) <= set(e) or score(e) == score(ev))]
        if shared:
            return None, 'ambiguous_shared_term', [best['id']] + shared
        return best, 'strong_term', ev


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--merged', required=True, help='merge_classification.py output (poi_key, name_ar, name_en, final_sub)')
    p.add_argument('--ontology', required=True, help='procurementOntology.data.json')
    p.add_argument('--out', required=True)
    a = p.parse_args(argv)
    out = pathlib.Path(a.out)
    side = [out, out.with_suffix('.report.json'), out.with_name(out.stem + '_review_sample.csv')]
    for f in side:
        if f.exists() or os.path.abspath(f) in {os.path.abspath(a.merged), os.path.abspath(a.ontology)}:
            sys.exit(f'refusing to overwrite {f}')

    tagger = Tagger(json.load(open(a.ontology, encoding='utf-8')))
    source = f'procurement_ontology:{tagger.version}'
    db = duckdb.connect()
    rows = db.execute(f"""select poi_key, name_ar, name_en, final_sub from read_parquet('{a.merged}')
                          where final_sub like 'contract.%' order by poi_key""").fetchall()
    cols = collections.defaultdict(list)
    status_n, fam_n = collections.Counter(), collections.Counter()
    for key, na, ne, sub in rows:
        fam, status, ev = tagger.tag(f'{na or ""} | {ne or ""}')
        status_n[status] += 1
        if fam:
            fam_n[fam['id']] += 1
        for c, v in (('poi_key', key), ('name_ar', na), ('name_en', ne), ('final_sub', sub),
                     ('family_id', fam and fam['id']), ('family_label_ar', fam and fam['label']),
                     ('family_sector', fam and fam['sector']), ('family_source', source if fam else None),
                     ('family_status', status), ('family_evidence', ' ; '.join(ev) or None)):
            cols[c].append(v)
    db.register('t', pa.table(cols) if rows else pa.table({c: pa.array([], pa.string()) for c in (
        'poi_key', 'name_ar', 'name_en', 'final_sub', 'family_id', 'family_label_ar', 'family_sector',
        'family_source', 'family_status', 'family_evidence')}))
    db.execute(f"copy t to '{out}' (format parquet, compression zstd)")

    label = {f['id']: f.get('label_ar') for f in tagger.families}
    rep = {'ontology_version': tagger.version, 'families_in_ontology': len(tagger.families), 'contract_rows': len(rows),
           'tagged': sum(fam_n.values()), 'tagged_pct': round(sum(fam_n.values()) / len(rows), 4) if rows else 0,
           'by_status': dict(status_n), 'by_family': {f'{k} ({label.get(k, "")})': v for k, v in fam_n.most_common()}}
    side[1].write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    db.execute(f"""copy (
      (select family_id, family_label_ar, name_ar, name_en, final_sub, family_evidence from t
         where family_id is not null order by hash(poi_key) limit 160)
      union all (select '(ambiguous)', null, name_ar, name_en, final_sub, family_evidence from t
         where family_status like 'ambiguous%' order by hash(poi_key) limit 40)
    ) to '{side[2]}' (header, delimiter ',')""")
    side[2].write_bytes(b'\xef\xbb\xbf' + side[2].read_bytes())
    print(json.dumps({k: rep[k] for k in ('ontology_version', 'contract_rows', 'tagged', 'tagged_pct', 'by_status')},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
