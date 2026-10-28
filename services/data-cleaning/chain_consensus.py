"""Chain consensus: a chain's branch takes the activity most of its classified branches carry.

A chain is found exactly as the map finds it (`market_analytics.brand_sql` and `group_chains` in the targeting service):
one brand key per city after letter folding and dropping the branch name and number, an Arabic and a Latin key joined by
a shared registration only when each is the other's strongest partner, and a bare activity word is no brand.

For each chain of at least MIN_BRANCHES branches in a city, the branches classified high or medium vote with their main
activity. The votes must cover at least COVERAGE of the chain's branches: a name hundreds of places share
(«مكتب مقاولات عامة», a district or a building word) is mostly unclassified, and four votes do not speak for 500 places.
When at least MIN_AGREE of them agree and they are at least CONSENSUS of the votes, the branches classified low or
not at all take the chain's most common subcategory within it, at medium confidence, with `source = chain_consensus`
and the previous classification kept in `evidence`. A branch classified high or medium under another activity keeps it:
a surveyor, a registration or the classifier had evidence, and a shared name is not proof. On the directory of
2026-10 overriding them was tried and a sample showed why not: the brand_name field sometimes holds a mall's or another
company's name («لوكا» cafés turned barbers, «الدبلوماسي للحلويات» turned a laundry).

Reads a directory snapshot (targets.parquet) and its row classification (poi_taxonomy.parquet); writes a new
classification and a report next to the output path. Never writes over its input or the served files.

    python3 chain_consensus.py --targets T.parquet --taxonomy X.parquet --subs farq_taxonomy.json --out Y.parquet
"""
import argparse
import json
import os
import pathlib
import sys
from collections import Counter

import duckdb

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "targeting-api"))
from market_analytics import brand_sql, group_chains  # noqa: E402

MIN_BRANCHES = 3
MIN_AGREE = 3
CONSENSUS = 2 / 3
COVERAGE = 0.5
CLASSIFIED = ("high", "medium")


def chain_decisions(rows, taxonomy, main_of):
    """rows: (city, poi_key, district, label, key, cr) of one snapshot; taxonomy: poi_key -> (sub_id, confidence);
    main_of: sub_id -> main id. Returns ({poi_key: new row}, [one summary per chain that reached consensus])."""
    by_city = {}
    for city, *rest in rows:
        by_city.setdefault(city, []).append(tuple(rest))
    changes, chains = {}, []
    for city, city_rows in sorted(by_city.items(), key=lambda item: item[0] or ""):
        for group in group_chains(city_rows).values():
            pois = sorted(group["pois"])
            if len(pois) < MIN_BRANCHES:
                continue
            votes = Counter(main_of.get(taxonomy[poi][0]) for poi in pois
                            if poi in taxonomy and taxonomy[poi][1] in CLASSIFIED and main_of.get(taxonomy[poi][0]))
            if not votes:
                continue
            main, agree = votes.most_common(1)[0]
            if agree < MIN_AGREE or agree < CONSENSUS * sum(votes.values()) or sum(votes.values()) < COVERAGE * len(pois):
                continue
            # the chain's own subcategory: the one its agreeing branches carry most (ties go to the smaller id)
            subs = Counter(taxonomy[poi][0] for poi in pois if poi in taxonomy and taxonomy[poi][1] in CLASSIFIED
                           and main_of.get(taxonomy[poi][0]) == main)
            sub = sorted(subs.items(), key=lambda item: (-item[1], item[0]))[0][0]
            moved = 0
            for poi in pois:
                before_sub, before_conf = taxonomy.get(poi, (None, None))
                if before_conf in CLASSIFIED:
                    continue
                changes[poi] = {"poi_key": poi, "sub_id": sub, "source": "chain_consensus", "confidence": "medium",
                                "evidence": json.dumps({"brand": group["brand"], "city": city, "branches": len(pois),
                                                        "agree": agree, "classified": sum(votes.values()),
                                                        "before_sub_id": before_sub, "before_confidence": before_conf},
                                                       ensure_ascii=False)}
                moved += 1
            chains.append({"city": city, "brand": group["brand"], "branches": len(pois), "main_id": main, "sub_id": sub,
                           "agree": agree, "classified": sum(votes.values()), "moved": moved})
    return changes, chains


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--targets", required=True)
    parser.add_argument("--taxonomy", required=True)
    parser.add_argument("--subs", required=True, help="farq_taxonomy.json (sub_id -> main_id)")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = pathlib.Path(args.out).resolve()
    if out in {pathlib.Path(args.taxonomy).resolve(), pathlib.Path(args.targets).resolve()} or out.exists():
        sys.exit(f"refusing to write {out}: it is an input or already exists")
    main_of = {sub["sub_id"]: sub["main_id"] for sub in json.load(open(args.subs, encoding="utf-8"))["subs"]}
    db = duckdb.connect()
    columns = {row[0] for row in db.execute("describe select * from read_parquet(?)", [args.targets]).fetchall()}
    rows = db.execute(f"select p.city_en, {brand_sql(columns)} from read_parquet(?) p", [args.targets]).fetchall()
    taxonomy = {poi: (sub, conf) for poi, sub, conf in
                db.execute("select poi_key, sub_id, confidence from read_parquet(?)", [args.taxonomy]).fetchall()}
    changes, chains = chain_decisions(rows, taxonomy, main_of)
    db.execute("create table changes(poi_key varchar, sub_id varchar, source varchar, confidence varchar, evidence varchar)")
    db.executemany("insert into changes values (?, ?, ?, ?, ?)",
                   [(c["poi_key"], c["sub_id"], c["source"], c["confidence"], c["evidence"]) for c in changes.values()])
    kept = {row[0] for row in db.execute("describe select * from read_parquet(?)", [args.taxonomy]).fetchall()}
    select = ", ".join(f"cast(x.{name} as varchar) as \"{name}\"" if name in kept else f"null::varchar as \"{name}\""
                       for name in ("poi_key", "sub_id", "source", "confidence", "evidence"))
    partial = str(out) + ".partial"
    db.execute(f"""copy (
        select * from (select {select} from read_parquet(?) x anti join changes c using (poi_key)
                       union all select * from changes) order by poi_key
    ) to '{partial}' (format parquet, compression zstd)""", [args.taxonomy])
    os.replace(partial, out)
    before = Counter(json.loads(c["evidence"])["before_confidence"] or "unclassified" for c in changes.values())
    report = {"targets": args.targets, "taxonomy": args.taxonomy, "out": str(out),
              "rule": {"min_branches": MIN_BRANCHES, "min_agree": MIN_AGREE, "consensus": round(CONSENSUS, 3), "coverage": COVERAGE,
                       "moves_only": "low or unclassified"},
              "chains_with_consensus": len(chains), "rows_moved": len(changes), "moved_from": dict(before),
              "largest": sorted(chains, key=lambda c: -c["moved"])[:40]}
    report_path = out.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("chains_with_consensus", "rows_moved", "moved_from")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
