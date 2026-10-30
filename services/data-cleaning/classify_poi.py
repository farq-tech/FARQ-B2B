"""Two-level POI classifier (estimate layer) from the HudHud surveyor-verified categories.

A place's name tells its activity for the common cases, but a third of the taxonomy's sub-categories have no training
example and many names are not descriptive («شركة التجارية», «هايبر ماركت»), so a name model plateaus at the sub level.
This step classifies in two levels and never writes a guess as truth:
- MAIN category (25 in farq_taxonomy.json): a name model reaches it reliably (~86% held-out).
- SUB category (431): kept only where the model is confident; below the gate the row stays at main level or «غير متاح».

It trains on `crs_latest.parquet` (places a surveyor classified, high/medium confidence), reports its own held-out
accuracy, then scores a directory snapshot. Every output row is an ESTIMATE with its confidence and `cls_estimate_source`;
nothing is filled where the model is unsure. The golden build reads this as the lowest-priority layer, under every
surveyor, rule and official source, and shows it as «تقدير», never overriding «غير متاح» (docs/atlas-classification-policy.md).

Reads the labels, the taxonomy and the snapshot (read-only); writes a new parquet and a report next to it. Never writes
over its inputs or an existing file.

    python3 classify_poi.py --labels crs_latest.parquet --targets targets.parquet --taxonomy farq_taxonomy.json --out poi_estimates.parquet
"""
import argparse
import json
import os
import sys

import duckdb
import numpy as np
import pyarrow as pa
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import accuracy_score, top_k_accuracy_score
from sklearn.model_selection import train_test_split

MAIN_MIN, SUB_MIN = 0.60, 0.80   # a label is kept only at or above its gate; everything below stays unclassified
# Rule classifications in the snapshot that also train the model. The exact QGIS-category mapping labels a licence
# place from its licence category, not its name, so its names are an independent label of the same kind of place as
# the unclassified rows (licence-only, no surveyor). A fifth of them (by poi_key) is held out to measure the model.
TRAIN_METHODS = ('exact_qgis_category_to_rubricator',)


# A field holding one of these says nothing about the activity: an export artefact («NULL», «False») or a state of the
# premises («محل مغلق», «For Rent»). Such a field is read as empty, so a row named only that is never given a category
# (a place named «False» was estimated a restaurant, «محل مغلق» a shop).
PLACEHOLDERS = ('null', 'none', 'nan', 'false', 'true', 'n/a', 'na', '-', '.', '0', 'without', 'untapped', 'unknown',
                'غير معروف', 'بدون', 'بدون اسم', 'لا يوجد', 'لايوجد')
STATES = ('closed', 'closed store', 'closed stores', 'closed shop', 'for rent', 'a rent store', 'rent store',
          'under construction', 'vacant', 'empty', 'محل مغلق', 'محلات مغلقة', 'مغلق', 'مقفل', 'محل مقفل', 'للإيجار',
          'للايجار', 'محل للإيجار', 'محل للايجار', 'تحت الإنشاء', 'تحت الانشاء', 'فارغ', 'شاغر')
NON_DESCRIPTIVE = PLACEHOLDERS + STATES
# a Latin or Arabic letter; the Arabic block's digits (٠-٩, ۰-۹) and punctuation (، ؛ ؟ ٪ ۔) are not letters
LETTER = '[A-Za-z\u0621-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06EE-\u06EF\u06FA-\u06FC]'


def field(c, width=None):
    """One text column as SQL, empty when it holds a non-descriptive value or no letter at all."""
    v = f"substr({c},1,{width})" if width else c
    words = ', '.join("'" + w.replace("'", "''") + "'" for w in NON_DESCRIPTIVE)
    return (f"case when {c} is null or lower(trim({c})) in ({words}) "
            f"or not regexp_matches({c}, '{LETTER}') then '' else {v} end")


def text_expr(db, path):
    """A name/text SQL expression over whichever of the text columns this parquet carries (a snapshot may lack
    `tradename` or a description), so the same features train and score across files. Empty when no column says
    anything about the activity, and then the row is not scored."""
    have = {r[0] for r in db.execute(f"describe select * from read_parquet('{path}')").fetchall()}
    # source_license_name is the Arabic name a licence file carries; licence-only places have no name_ar and an
    # «NULL» or machine-translated name_en, so without it most of them have nothing to read.
    parts = [field(c) for c in ('name_ar', 'name_en', 'tradename', 'source_license_name') if c in have]
    if 'description_ar' in have:
        parts.append(field('description_ar', 200))
    return "trim(" + " || ' | ' || ".join(parts) + ", ' |')"


def features(fit, texts, vecs=None):
    """Char (2-5) and word (1-2) TF-IDF, fit on the training texts then reused. Char n-grams carry Arabic spelling
    variants; the pair beats either alone and far beats dense multilingual embeddings on short POI names."""
    if fit:
        cv = TfidfVectorizer(analyzer='char_wb', ngram_range=(2, 5), min_df=2, max_features=300000, sublinear_tf=True)
        wv = TfidfVectorizer(analyzer='word', ngram_range=(1, 2), min_df=2, max_features=200000, sublinear_tf=True,
                             token_pattern=r'[^\s|]+')
        return hstack([cv.fit_transform(texts), wv.fit_transform(texts)]).tocsr(), (cv, wv)
    cv, wv = vecs
    return hstack([cv.transform(texts), wv.transform(texts)]).tocsr()


def model():
    return SGDClassifier(loss='log_loss', alpha=3e-6, max_iter=80, n_jobs=-1, random_state=0)


def top(clf, X):
    """The argmax label and its probability for every row."""
    p = clf.predict_proba(X)
    return clf.classes_[p.argmax(1)], p.max(1), p


def held_out(texts, y, labels):
    """Train/test split accuracy, reported so the estimate's quality is on record. Returns {} when a split is not
    possible (too few rows, as in a unit test)."""
    if len(set(y)) < 2 or len(y) < 20:
        return {}
    itr, ite = train_test_split(np.arange(len(y)), test_size=0.2, random_state=42,
                                stratify=y if min(np.unique(y, return_counts=True)[1]) >= 2 else None)
    Xtr, vecs = features(True, [texts[i] for i in itr])
    Xte = features(False, [texts[i] for i in ite], vecs)
    clf = model().fit(Xtr, y[itr])
    pred, _, proba = top(clf, Xte)
    acc = accuracy_score(y[ite], pred)
    t3 = top_k_accuracy_score(y[ite], proba, k=3, labels=clf.classes_) if len(clf.classes_) >= 3 else None
    return {'rows': len(y), 'classes': len(set(y)), 'top1': round(acc, 4), 'top3': round(t3, 4) if t3 else None}


def rule_rows(db, targets, methods):
    """(train, held-out) rows of (text, sub_id) from the snapshot's high-confidence rule classifications by `methods`;
    empty when the snapshot does not carry its classification or no method is given."""
    have = {r[0] for r in db.execute(f"describe select * from read_parquet('{targets}')").fetchall()}
    if not methods or not {'sub_id', 'classification_method', 'cls_confidence'} <= have:
        return [], []
    ms = ', '.join("'" + m.replace("'", "''") + "'" for m in methods)
    rows = db.execute(f"""select feat, sub_id, hash(poi_key) % 5 = 0 from (select {text_expr(db, targets)} feat, sub_id,
        poi_key, classification_method, cls_confidence from read_parquet('{targets}'))
        where classification_method in ({ms}) and cls_confidence = 'high' and sub_id is not null and length(feat) >= 2
        order by poi_key""").fetchall()
    return [(t, s) for t, s, h in rows if not h], [(t, s) for t, s, h in rows if h]


def gated(clf, vecs, rows, sub_main, gates=(0.6, 0.7, 0.8, 0.9)):
    """Coverage and main accuracy at each gate on held-out rows whose text never appeared in training (a repeated
    chain name would otherwise be a free hit)."""
    if not rows:
        return {}
    X = features(False, [t for t, _ in rows], vecs)
    pred, conf, _ = top(clf, X)
    gold = np.array([sub_main.get(s) for _, s in rows])
    out = {'rows': len(rows)}
    for g in gates:
        k = conf >= g
        out[f'{g:.1f}'] = {'coverage_pct': round(100 * float(k.mean()), 1),
                           'accuracy_pct': round(100 * float((pred[k] == gold[k]).mean()), 1) if k.any() else None}
    return out


def effect(db, targets, out, sub_main, trained_methods=()):
    """What the layer would add to the snapshot, and a check it never trained on. A snapshot that carries the current
    classification (`sub_id`, `classification_method`, `cls_confidence`) is measured twice:
    - `unclassified`: rows with no `sub_id` today (the only rows the lowest-priority layer can fill), and how many get
      a main or a sub estimate.
    - `agreement_with_rules`: on rows a rule classified with high confidence (not the surveyor rows the model learned
      from, nor a method it trained on), how often the emitted main matches the main of the rule's sub."""
    have = {r[0] for r in db.execute(f"describe select * from read_parquet('{targets}')").fetchall()}
    if not {'sub_id', 'classification_method', 'cls_confidence'} <= have:
        return {}
    db.execute('create or replace temp table sub_main as select * from (values ' +
               ', '.join("('" + k.replace("'", "''") + "', '" + v.replace("'", "''") + "')" for k, v in sub_main.items()) +
               ') v(sub_id, main_ar)' if sub_main else 'create or replace temp table sub_main(sub_id varchar, main_ar varchar)')
    j = f"read_parquet('{targets}') t join read_parquet('{out}') e using (poi_key)"
    u = db.execute(f"""select count(*), count(e.cls_main_estimate), count(e.cls_sub_estimate)
        from {j} where t.sub_id is null""").fetchone()
    g = db.execute(f"""select count(*), sum((e.cls_main_estimate = m.main_ar)::int)
        from {j} join sub_main m on m.sub_id = t.sub_id
        where t.classification_method is not null and t.cls_confidence = 'high' and e.cls_main_estimate is not null
        and t.classification_method not in (select unnest(?::varchar[]))""", [list(trained_methods)]).fetchone()
    return {'unclassified': {'rows': u[0], 'kept_main': u[1], 'kept_sub': u[2]},
            'agreement_with_rules': {'rows': g[0], 'agree_pct': round(100 * g[1] / g[0], 1) if g[0] else None}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--labels', required=True, help='crs_latest.parquet (surveyor-verified categories) for training')
    ap.add_argument('--targets', required=True, help='directory snapshot to score (poi_key + name columns)')
    ap.add_argument('--taxonomy', required=True, help='farq_taxonomy.json (maps sub_id to its main category)')
    ap.add_argument('--out', required=True, help='new parquet; the report is written beside it as .report.json')
    ap.add_argument('--main-min', type=float, default=MAIN_MIN, help=f'keep a main-category estimate at this confidence (default {MAIN_MIN})')
    ap.add_argument('--train-methods', default=','.join(TRAIN_METHODS),
                    help='comma list of snapshot classification methods whose high-confidence rows also train the model; '
                         f'empty for surveyor labels only (default {",".join(TRAIN_METHODS)})')
    ap.add_argument('--sub-min', type=float, default=SUB_MIN, help=f'keep a sub-category estimate at this confidence (default {SUB_MIN})')
    a = ap.parse_args(argv)
    report_path = os.path.splitext(a.out)[0] + '.report.json'
    inputs = {os.path.realpath(p) for p in (a.labels, a.targets, a.taxonomy)}
    for path in (a.out, report_path):
        if os.path.realpath(path) in inputs:
            sys.exit(f'refusing to write over an input: {path}')
        if os.path.exists(path):
            sys.exit(f'refusing to overwrite {path}')

    sub_main = {s['sub_id']: s['main_ar'] for s in json.load(open(a.taxonomy, encoding='utf-8'))['subs']}
    db = duckdb.connect()
    db.execute('SET threads=8')
    LTEXT = text_expr(db, a.labels)
    train = db.execute(f"""select feat, sub_id from (select {LTEXT} feat, sub_id, deleted, sub_confidence
        from read_parquet('{a.labels}')) where not deleted and sub_id is not null and sub_confidence in ('high','medium')
        and length(feat) >= 2""").fetchall()
    methods = tuple(m for m in a.train_methods.split(',') if m)
    rules_train, rules_test = rule_rows(db, a.targets, methods)
    surveyor_rows = len(train)
    train = train + rules_train
    texts = [r[0] for r in train]
    sub = np.array([r[1] for r in train])
    mains = np.array([sub_main.get(s, 'غير مصنّف') for s in sub])
    # a sub label needs a few examples to be learnable and to split; the main level keeps every row
    import collections
    keep = {k for k, c in collections.Counter(sub).items() if c >= 5}
    smask = np.array([s in keep for s in sub])

    report = {'labels': os.path.abspath(a.labels), 'targets': os.path.abspath(a.targets),
              'training_rows': len(texts), 'training_surveyor_rows': surveyor_rows,
              'training_rule_rows': len(rules_train), 'train_methods': list(methods), 'held_out_main': held_out(texts, mains, None),
              'held_out_sub': held_out([t for t, k in zip(texts, smask) if k], sub[smask], None),
              'gates': {'main_min': a.main_min, 'sub_min': a.sub_min}}

    Xtr, vecs = features(True, texts)
    main_clf = model().fit(Xtr, mains)
    sub_clf = model().fit(features(False, [t for t, k in zip(texts, smask) if k], vecs), sub[smask])

    seen = set(texts)
    report['held_out_rules'] = gated(main_clf, vecs, [r for r in rules_test if r[0] not in seen], sub_main)

    main_col = {c: i for i, c in enumerate(main_clf.classes_)}
    # gate: a label below its confidence is dropped, so an unsure row stays unclassified rather than guessed.
    # the two models are independent, so a kept sub could sit under a different main — an impossible pair. A kept sub
    # fixes its taxonomy parent as the main (dropped if that parent is unknown or below the main gate), so the two
    # levels never disagree, and cls_main_confidence is always the main model's own probability of the main it emits.
    # The snapshot is streamed and scored in batches: materializing every target's features and a dense proba
    # (1.9M × 431 subs ≈ 6.6 GiB) would exhaust a data-cleaning host; each batch builds its own features and keeps
    # only each row's top label and probability.
    # A row with no descriptive text is written with no estimate and no confidence: it was not scored, not scored low.
    keys, main_out, sub_out, main_conf_out, sub_conf_out = [], [], [], [], []
    skipped = 0
    BATCH = 50000
    cur = db.execute(f"select poi_key, {text_expr(db, a.targets)} feat from read_parquet('{a.targets}')")
    while batch := cur.fetchmany(BATCH):
        blank = [row for row in batch if len(row[1]) < 2]
        for row in blank:
            keys.append(row[0])
            main_out.append(None); sub_out.append(None); main_conf_out.append(None); sub_conf_out.append(None)
        skipped += len(blank)
        batch = [row for row in batch if len(row[1]) >= 2]
        if not batch:
            continue
        keys.extend(row[0] for row in batch)
        Xc = features(False, [row[1] for row in batch], vecs)
        main_pred, main_conf, main_proba = top(main_clf, Xc)
        sub_pred, sub_conf, _ = top(sub_clf, Xc)   # the batch's features and sub proba are freed each iteration
        for r, (mp, mc, sp, sc) in enumerate(zip(main_pred, main_conf, sub_pred, sub_conf)):
            parent = sub_main.get(sp)
            j = main_col.get(parent)
            parent_conf = float(main_proba[r, j]) if j is not None else 0.0
            # a kept sub needs both gates: its own, and its parent main clearing main_min — so neither level is ever
            # emitted below its threshold. When the parent main is too weak, the sub is dropped and the gated main used.
            if sc >= a.sub_min and parent is not None and parent_conf >= a.main_min:
                sub_out.append(sp)
                main_out.append(parent)
                main_conf_out.append(parent_conf)
            else:
                sub_out.append(None)
                main_out.append(mp if mc >= a.main_min else None)
                main_conf_out.append(float(mc))   # the top main's confidence, recorded even when below the gate
            sub_conf_out.append(float(sc))

    # explicit types so the schema is stable even when every estimate is gated out (all-None stays a string column)
    out = db.from_arrow(pa.table({
        'poi_key': pa.array(keys, pa.string()),
        'cls_main_estimate': pa.array(main_out, pa.string()),
        'cls_main_confidence': pa.array([None if c is None else round(c, 4) for c in main_conf_out], pa.float64()),
        'cls_sub_estimate': pa.array(sub_out, pa.string()),
        'cls_sub_confidence': pa.array([None if c is None else round(c, 4) for c in sub_conf_out], pa.float64()),
        'cls_estimate_source': pa.array(['model_name_tfidf'] * len(keys), pa.string()),
    }))
    out.to_parquet(a.out)
    kept_main = sum(1 for x in main_out if x is not None)
    kept_sub = sum(1 for x in sub_out if x is not None)
    report['scored'] = len(keys) - skipped
    report['skipped_non_descriptive'] = skipped
    report['kept_main'] = kept_main
    report['kept_sub'] = kept_sub
    report['kept_main_pct'] = round(kept_main / len(keys), 4) if keys else 0
    report.update(effect(db, a.targets, a.out, sub_main, methods))
    report['out'] = os.path.abspath(a.out)
    with open(report_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({'training_rows': report['training_rows'], 'held_out_main': report['held_out_main'],
                      'held_out_sub': report['held_out_sub'], 'scored': report['scored'], 'skipped': skipped,
                      'kept_main': kept_main, 'kept_sub': kept_sub}, ensure_ascii=False))


if __name__ == '__main__':
    main()
