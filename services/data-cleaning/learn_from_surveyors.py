"""Learn from HudHud surveyors' decisions (2024-10 → 2025-08): which directory rows they deleted after visiting.
Label: latest approved log is a delete (1) vs kept (0), for the 230,581 surveyed directory rows.
Features avoid leakage: nothing that changes BECAUSE of the delete (lifecycle «archived», hh_transactions/crs/hh_* tags, HudHud editor).
Output: /Users/m4pro/farq-taxonomy-data/enrich/validity_risk.parquet  (poi_key, risk 0..1, surveyed, surveyor_verdict)
        and a short report of what predicts deletion. Read-only on the directory."""
import re, json
import duckdb, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score, precision_recall_fscore_support
from sklearn.model_selection import train_test_split

P = '/Users/m4pro/farq-targeting/data/targets.parquet'
D = '/Users/m4pro/farq-taxonomy-data/'
db = duckdb.connect(); db.execute("SET threads=8")
LEAKY = {'hh_transactions', 'crs', 'hh_complete', 'hh_master', 'hh_pois', 'master_cr'}
# v2: tags written by the HudHud/TRX pipeline itself (after review) are leakage too; keep only external sources
def pipeline_tag(t): return t in LEAKY or t.startswith(('trx', 'hh_', 'golden', 'output_', 'master'))
tags = [r[0] for r in db.execute(f"select s from (select unnest(sources) s from read_parquet('{P}')) group by 1 having count(*)>=2000").fetchall() if not pipeline_tag(r[0])]
TR = str.maketrans('أإآةىؤئ', 'اااهيوي')
rows = db.execute(f"""select t.poi_key, t.sources, coalesce(try_cast(t.completeness_pct as double),0), nullif(trim(t.phone_norm),'') is not null, coalesce(t.has_whatsapp,false),
   nullif(trim(t.website),'') is not null, nullif(trim(t.email),'') is not null, nullif(trim(t.category),'') is not null,
   lower(coalesce(t.company_status,'')), coalesce(t.name_ar, t.name_en, ''), coalesce(try_cast(t.rating as double),0), coalesce(try_cast(t.reviews_count as double),0),
   c.sub_id, c.source, c.confidence, coalesce(g.size,1),
   case when s.poi_key is null then -1 when s.last_operation='delete' and s.last_review_status='approved' then 1 else 0 end as lbl
   from read_parquet('{P}') t join read_parquet('{D}poi_taxonomy.parquet') c using(poi_key)
   left join read_parquet('{D}poi_groups.parquet') g using(poi_key) left join read_parquet('{D}enrich/hudhud_logs_status.parquet') s using(poi_key)""").fetchall()
subs = sorted({r[12] for r in rows}); sub_ix = {s: i for i, s in enumerate(subs)}
mains = sorted({s.split('.')[0] for s in subs}); main_ix = {m: i for i, m in enumerate(mains)}
STAT = {'open': 0, '': 1, 'active': 0, 'hidden': 2, 'temporary closed': 3, 'permanently closed': 4, 'inactive': 5}
def feat(r):
    key, src, compl, ph, wa, web, em, cat, st, name, rating, rev, sub, csrc, conf, gsize, _ = r
    srcs = set(src or [])
    n = name.translate(TR)
    return [0, ph, wa, web, em, cat, 0, float(rating or 0), float(rev or 0), sub_ix[sub], main_ix[sub.split('.')[0]],
            ['activity', 'secondary', 'name', 'none', 'vacant'].index(csrc) if csrc in ('activity', 'secondary', 'name', 'none', 'vacant') else 5,
            {'high': 2, 'medium': 1}.get(conf, 0), min(gsize, 10), len([t for t in srcs if not pipeline_tag(t)]), len(n), sum(ch.isdigit() for ch in n),
            bool(re.search(r'[a-zA-Z]', n)), bool(re.search(r'[؀-ۿ]', n))] + [t in srcs for t in tags]
X = np.array([feat(r) for r in rows], dtype=float); y = np.array([r[-1] for r in rows]); keys = [r[0] for r in rows]
lab = y >= 0
idx = np.arange(len(y))
tr_i, te_i = train_test_split(idx[lab], test_size=0.2, random_state=7, stratify=y[lab])
# 431 subcategories exceed the 255-category limit: encode each by its smoothed deletion rate, learned on the training split only
def sub_rate(train_idx):
    tot = np.bincount(X[train_idx, 9].astype(int), minlength=len(subs)); dele = np.bincount(X[train_idx, 9].astype(int), weights=y[train_idx], minlength=len(subs))
    prior = y[train_idx].mean(); return (dele + 20 * prior) / (tot + 20)
X_enc = X.copy(); X_enc[:, 9] = sub_rate(tr_i)[X[:, 9].astype(int)]
cat_cols = [10, 11, 6]
Xtr, Xte, ytr, yte = X_enc[tr_i], X_enc[te_i], y[tr_i], y[te_i]
clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, categorical_features=cat_cols, random_state=7)
clf.fit(Xtr, ytr)
p = clf.predict_proba(Xte)[:, 1]
auc = roc_auc_score(yte, p)
prec, rec, f1, _ = precision_recall_fscore_support(yte, p >= 0.5, average='binary')
top = np.argsort(-p)[: int(len(p) * 0.1)]
from sklearn.inspection import permutation_importance
names = ['compl','phone','whatsapp','web','email','has_cat','status','rating','reviews','sub_rate','main','cls_source','conf','dup_group','n_ext_sources','name_len','name_digits','latin','arabic'] + tags
sample = np.random.RandomState(1).choice(len(yte), min(20000, len(yte)), replace=False)
pi = permutation_importance(clf, Xte[sample], yte[sample], scoring='roc_auc', n_repeats=3, random_state=1)
imp = sorted(zip(names, pi.importances_mean), key=lambda x: -x[1])[:12]
report = {'top_features': [(a, round(float(b), 4)) for a, b in imp], 'labelled': int(lab.sum()), 'deleted_share': round(float(y[lab].mean()), 3), 'holdout_auc': round(float(auc), 3),
          'precision@0.5': round(float(prec), 3), 'recall@0.5': round(float(rec), 3), 'deleted_share_in_top10pct_risk': round(float(yte[top].mean()), 3)}
X_enc[:, 9] = sub_rate(idx[lab])[X[:, 9].astype(int)]
clf.fit(X_enc[lab], y[lab])
risk = clf.predict_proba(X_enc)[:, 1]
db.execute("create table r (poi_key varchar, risk double, surveyed bool, surveyor_verdict varchar)")
db.executemany("insert into r values (?,?,?,?)", [(k, round(float(v), 4), bool(l >= 0), {1: 'deleted', 0: 'kept'}.get(int(l))) for k, v, l in zip(keys, risk, y)])
db.execute(f"copy r to '{D}enrich/validity_risk_v2.parquet' (format parquet)")
un = ~lab
report['unsurveyed_rows'] = int(un.sum())
report['unsurveyed_high_risk_ge_0.7'] = int((risk[un] >= 0.7).sum())
report['unsurveyed_low_risk_lt_0.2'] = int((risk[un] < 0.2).sum())
print(json.dumps(report, ensure_ascii=False, indent=1))
json.dump(report, open(f'{D}enrich/validity_risk_v2_report.json', 'w'), ensure_ascii=False, indent=1)
