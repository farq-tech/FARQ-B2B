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
from scipy.sparse import hstack
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import accuracy_score, top_k_accuracy_score
from sklearn.model_selection import train_test_split

MAIN_MIN, SUB_MIN = 0.60, 0.80   # a label is kept only at or above its gate; everything below stays unclassified


def text_expr(db, path):
    """A name/text SQL expression over whichever of the text columns this parquet carries (a snapshot may lack
    `tradename` or a description), so the same features train and score across files."""
    have = {r[0] for r in db.execute(f"describe select * from read_parquet('{path}')").fetchall()}
    parts = [f"coalesce({c},'')" for c in ('name_ar', 'name_en', 'tradename') if c in have]
    if 'description_ar' in have:
        parts.append("coalesce(substr(description_ar,1,200),'')")
    return " || ' | ' || ".join(parts)


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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--labels', required=True, help='crs_latest.parquet (surveyor-verified categories) for training')
    ap.add_argument('--targets', required=True, help='directory snapshot to score (poi_key + name columns)')
    ap.add_argument('--taxonomy', required=True, help='farq_taxonomy.json (maps sub_id to its main category)')
    ap.add_argument('--out', required=True, help='new parquet; the report is written beside it as .report.json')
    ap.add_argument('--main-min', type=float, default=MAIN_MIN, help=f'keep a main-category estimate at this confidence (default {MAIN_MIN})')
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
    train = db.execute(f"""select {LTEXT} feat, sub_id from read_parquet('{a.labels}')
        where not deleted and sub_id is not null and sub_confidence in ('high','medium')
        and length(trim(coalesce(name_ar,'') || coalesce(name_en,'') || coalesce(tradename,''))) >= 2""").fetchall()
    texts = [r[0] for r in train]
    sub = np.array([r[1] for r in train])
    mains = np.array([sub_main.get(s, 'غير مصنّف') for s in sub])
    # a sub label needs a few examples to be learnable and to split; the main level keeps every row
    import collections
    keep = {k for k, c in collections.Counter(sub).items() if c >= 5}
    smask = np.array([s in keep for s in sub])

    report = {'labels': os.path.abspath(a.labels), 'targets': os.path.abspath(a.targets),
              'training_rows': len(texts), 'held_out_main': held_out(texts, mains, None),
              'held_out_sub': held_out([t for t, k in zip(texts, smask) if k], sub[smask], None),
              'gates': {'main_min': a.main_min, 'sub_min': a.sub_min}}

    Xtr, vecs = features(True, texts)
    main_clf = model().fit(Xtr, mains)
    sub_clf = model().fit(features(False, [t for t, k in zip(texts, smask) if k], vecs), sub[smask])

    rows = db.execute(f"select poi_key, {text_expr(db, a.targets)} feat from read_parquet('{a.targets}')").fetchall()
    keys = [r[0] for r in rows]
    Xte = features(False, [r[1] for r in rows], vecs)
    main_pred, main_conf, _ = top(main_clf, Xte)
    sub_pred, sub_conf, _ = top(sub_clf, Xte)
    # gate: a label below its confidence is dropped to None, so an unsure row stays unclassified rather than guessed
    main_kept = np.where(main_conf >= a.main_min, main_pred, None)
    sub_kept = np.where(sub_conf >= a.sub_min, sub_pred, None)

    out = db.from_arrow(__import__('pyarrow').table({
        'poi_key': keys,
        'cls_main_estimate': [x if x is not None else None for x in main_kept],
        'cls_main_confidence': [round(float(c), 4) for c in main_conf],
        'cls_sub_estimate': [x if x is not None else None for x in sub_kept],
        'cls_sub_confidence': [round(float(c), 4) for c in sub_conf],
        'cls_estimate_source': ['model_name_tfidf'] * len(keys),
    }))
    out.to_parquet(a.out)
    kept_main = int((main_conf >= a.main_min).sum())
    kept_sub = int((sub_conf >= a.sub_min).sum())
    report['scored'] = len(keys)
    report['kept_main'] = kept_main
    report['kept_sub'] = kept_sub
    report['kept_main_pct'] = round(kept_main / len(keys), 4) if keys else 0
    report['out'] = os.path.abspath(a.out)
    with open(report_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(json.dumps({'training_rows': report['training_rows'], 'held_out_main': report['held_out_main'],
                      'held_out_sub': report['held_out_sub'], 'scored': len(keys),
                      'kept_main': kept_main, 'kept_sub': kept_sub}, ensure_ascii=False))


if __name__ == '__main__':
    main()
