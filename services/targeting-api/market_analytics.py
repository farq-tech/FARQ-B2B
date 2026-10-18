"""Read-only aggregates for the Farq opportunity map.

All aggregates follow the directory's open-record policy. Activity-filtered
counts use the same high/medium row-level taxonomy confidence as map discovery.
This module returns aggregates only, never contact or business-identifying fields.
"""
import os
import threading

import taxonomy_search


DATA = os.path.join(os.path.dirname(__file__), "data", "targets.parquet")
POI_TAXONOMY = os.path.join(os.path.dirname(__file__), "data", "poi_taxonomy.parquet")
STREET_DENSITY = os.path.join(os.path.dirname(__file__), "data", "street_density.parquet")

MAX_SUB_IDS = 50
MAX_DISTRICTS = 30
MAX_SPECIALTY_IDS = 20
MAX_TEXT = 120

MARKET_BASIS = (
    "حصر سجلات الدليل غير المغلقة نهائياً في المدينة؛ الأحياء تعتمد على الإسناد الموثوق. "
    "وجود قناة واتساب مستمد من علامة المصدر ولا يعني تحققاً مستقلاً من الرقم أو نية الشراء."
)
BUYER_BASIS = (
    "الشراء المتوقع مستنتج من علاقات التصنيف (يشتري عادةً)، وليس سجلاً لطلب أو شراء فعلي. "
    "الأعداد من دليل المنشآت، وعلامة واتساب غير متحقق منها مستقلاً."
)


class MarketAnalytics:
    def __init__(self, directory_tiles):
        self.tiles = directory_tiles
        self.lock = directory_tiles.lock
        self.db = directory_tiles.db
        self._taxonomy = None
        self._taxonomy_lock = threading.Lock()
        self._specialty_column = None
        self._specialty_column_lock = threading.Lock()

    def _tx(self):
        if self._taxonomy is None:
            with self._taxonomy_lock:
                if self._taxonomy is None:
                    self._taxonomy = taxonomy_search.get()
        return self._taxonomy

    def _has_specialty_column(self):
        if self._specialty_column is None:
            with self._specialty_column_lock:
                if self._specialty_column is None:
                    with self.lock:
                        columns = {row[0] for row in self.db.execute("describe select * from read_parquet(?)", [DATA]).fetchall()}
                    self._specialty_column = "specialty_ids" in columns
        return self._specialty_column

    @staticmethod
    def _validate(body):
        city = body.get("city")
        if not isinstance(city, str) or not 1 <= len(city) <= 80:
            raise ValueError("city")
        q = body.get("q")
        if q is not None and (not isinstance(q, str) or len(q) > MAX_TEXT):
            raise ValueError("q")
        main_id = body.get("main_id")
        if main_id is not None and (not isinstance(main_id, str) or not 1 <= len(main_id) <= 40):
            raise ValueError("main_id")
        sub_ids = body.get("sub_ids") or []
        if not isinstance(sub_ids, list) or len(sub_ids) > MAX_SUB_IDS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in sub_ids
        ):
            raise ValueError("sub_ids")
        districts = body.get("districts") or []
        if not isinstance(districts, list) or len(districts) > MAX_DISTRICTS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in districts
        ):
            raise ValueError("districts")
        specialty_ids = body.get("specialty_ids") or []
        if not isinstance(specialty_ids, list) or len(specialty_ids) > MAX_SPECIALTY_IDS or not all(
            isinstance(item, str) and 1 <= len(item) <= 80 for item in specialty_ids
        ):
            raise ValueError("specialty_ids")
        objective = body.get("objective", "purchase")
        if objective not in ("purchase", "marketing"):
            raise ValueError("objective")
        return city, q, main_id, list(dict.fromkeys(sub_ids)), list(dict.fromkeys(districts)), objective

    def _resolve_subs(self, q, main_id, sub_ids, objective):
        tx = self._tx()
        if tx is None:
            if q or main_id:
                return [], True
            return sub_ids, False
        if sub_ids and not all(sid in tx.subs for sid in sub_ids):
            raise ValueError("unknown sub_id")
        resolved = None
        if q:
            # Resolve free text locally, then intersect it with any explicit
            # activity selection below. Silently ignoring either filter makes
            # district totals disagree with what the user asked the map to show.
            specialty_ids, _ = tx.spec_hits(q)
            query_subs = list(dict.fromkeys(tx.specs[sid]["sub_id"] for sid in specialty_ids))
            if not query_subs:
                query_subs = tx.subs_in(q)[0]
            if not query_subs:
                return [], True
            resolved = set(query_subs)
        if main_id:
            if main_id not in {item.get("main_id") for item in tx.subs.values()}:
                return [], True
            main_subs = {sid for sid, item in tx.subs.items() if item.get("main_id") == main_id}
            resolved = main_subs if resolved is None else resolved & main_subs
        if sub_ids:
            requested_subs = set(sub_ids)
            resolved = requested_subs if resolved is None else resolved & requested_subs
        resolved = sorted(resolved) if resolved is not None else []
        if resolved and not all(sid in tx.subs for sid in resolved):
            raise ValueError("unknown sub_id")
        return resolved, bool((main_id or q) and not resolved)

    def _where(self, body):
        city, q, main_id, sub_ids, districts, objective = self._validate(body)
        subs, empty_match = self._resolve_subs(q, main_id, sub_ids, objective)
        specialty_ids = list(dict.fromkeys(body.get("specialty_ids") or []))
        specialty_available = not specialty_ids or self._has_specialty_column()
        clauses = [
            self.tiles.search_sql,
            "coalesce(nullif(p.name_ar, ''), p.name_en) is not null",
            "p.city_en = ?",
        ]
        params = [DATA, city]
        if empty_match:
            clauses.append("false")
        elif subs:
            clauses.append(
                "exists (select 1 from read_parquet(?) c where c.poi_key = p.poi_key "
                "and c.confidence in ('high', 'medium') and c.sub_id in (select unnest(?::varchar[])))"
            )
            params.extend([POI_TAXONOMY, subs])
        if districts:
            clauses.append("p.district_ar in (select unnest(?::varchar[]))")
            params.append(districts)
        if specialty_ids:
            if not specialty_available:
                # Older directory snapshots cannot answer exact-specialty questions;
                # fail closed rather than show the wider parent subcategory as exact.
                clauses.append("false")
            else:
                clauses.append("list_has_any(string_split(coalesce(p.specialty_ids, ''), '|'), ?::varchar[])")
                params.append(specialty_ids)
        return city, subs, " and ".join(clauses), params, specialty_available

    def district_counts(self, body):
        city, _, where, params, specialty_available = self._where(body)
        query = f"""
            select p.district_ar, count(*) n,
                   count(*) filter (where coalesce(p.has_whatsapp, false)) n_whatsapp,
                   count(*) filter (where coalesce(p.is_wholesale, false)) n_wholesale
            from read_parquet(?) p
            where {where} and p.district_reliable is true
              and length(trim(coalesce(p.district_ar, ''))) > 0
            group by p.district_ar order by n desc, p.district_ar
        """
        with self.lock:
            rows = self.db.execute(query, params).fetchall()
            total = self.db.execute(
                f"select count(*) from read_parquet(?) p where {where}", params
            ).fetchone()[0]
        return {
            "ok": True,
            "city": city,
            "districts": [
                {"district_ar": name, "n": n, "n_whatsapp": whatsapp, "n_wholesale": wholesale}
                for name, n, whatsapp, wholesale in rows
            ],
            "total": total,
            "specialty_available": specialty_available,
            "basis": MARKET_BASIS,
        }

    def district_insights(self, body):
        """Aggregate confidently classified activities for selected districts.

        Missing categories mean no matching directory records, not proof that a trade
        does not exist in the real district.
        """
        city, q, main_id, sub_ids, districts, _ = self._validate(body)
        if q or main_id or sub_ids or not districts:
            raise ValueError("district_insights requires districts only")
        tx = self._tx()
        if tx is None:
            return {"ok": False, "city": city, "districts": [], "basis": "التصنيف غير متاح"}

        # Build a parameterized taxonomy relation from the same approved labels used
        # by search. Counts are distinct POIs per activity to avoid double counting
        # when one listing has multiple specialty rows.
        subs = [
            (sid, item.get("main_id") or "", item.get("main_ar") or "غير مصنف", item.get("sub_ar") or "")
            for sid, item in tx.subs.items()
            if not sid.startswith(("unc.", "noncom."))
        ]
        values_sql = ",".join("(?, ?, ?, ?)" for _ in subs)
        taxonomy_params = [value for row in subs for value in row]
        taxonomy_cte = f"taxonomy(sub_id, main_id, main_ar, sub_ar) as (values {values_sql})"
        base = (
            "from read_parquet(?) p where " + self.tiles.search_sql +
            " and p.city_en = ? and p.district_reliable is true "
            "and length(trim(coalesce(p.district_ar, ''))) > 0 "
            "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null"
        )
        where_params = [DATA, city]
        with self.lock:
            district_rows = self.db.execute(
                f"select p.district_ar, count(*) n {base} "
                "and p.district_ar in (select unnest(?::varchar[])) group by 1",
                where_params + [districts],
            ).fetchall()
            classified_rows = self.db.execute(
                "select p.district_ar, count(distinct p.poi_key) from read_parquet(?) p "
                "join read_parquet(?) c on c.poi_key = p.poi_key "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null group by 1",
                [DATA, POI_TAXONOMY, city, districts],
            ).fetchall()
            # City coverage defines which main activities can be called missing.
            city_activity_rows = self.db.execute(
                f"with {taxonomy_cte} select t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and c.confidence in ('high','medium') "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by t.main_id",
                taxonomy_params + [DATA, POI_TAXONOMY, city],
            ).fetchall()
            main_rows = self.db.execute(
                f"with {taxonomy_cte} select p.district_ar, t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by p.district_ar, t.main_id",
                taxonomy_params + [DATA, POI_TAXONOMY, city, districts],
            ).fetchall()
            sub_rows = self.db.execute(
                f"with {taxonomy_cte} select p.district_ar, t.main_id, t.sub_id, any_value(t.sub_ar), count(distinct p.poi_key) n "
                "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                "join taxonomy t on t.sub_id = c.sub_id "
                f"where {self.tiles.search_sql} and p.city_en = ? and p.district_reliable is true "
                "and c.confidence in ('high','medium') and p.district_ar in (select unnest(?::varchar[])) "
                "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                "group by p.district_ar, t.main_id, t.sub_id",
                taxonomy_params + [DATA, POI_TAXONOMY, city, districts],
            ).fetchall()

        city_mains = {mid: {"main_id": mid, "main_ar": label, "n": n} for mid, label, n in city_activity_rows}
        totals = {name: count for name, count in district_rows}
        classified_totals = {name: count for name, count in classified_rows}
        by_district = {name: [] for name in districts}
        for name, mid, label, count in main_rows:
            by_district.setdefault(name, []).append({"main_id": mid, "main_ar": label, "n": count})
        subs_by_district = {}
        for name, mid, sid, label, count in sub_rows:
            subs_by_district.setdefault((name, mid), []).append({"sub_id": sid, "sub_ar": label, "n": count})

        results = []
        for name in districts:
            activities = sorted(by_district.get(name, []), key=lambda item: (-item["n"], item["main_ar"]))
            for activity in activities:
                activity["top_subactivities"] = sorted(
                    subs_by_district.get((name, activity["main_id"]), []),
                    key=lambda item: (-item["n"], item["sub_ar"]),
                )[:3]
            ranked_present = sorted(activities, key=lambda item: (item["n"], item["main_ar"]))
            present_ids = {item["main_id"] for item in activities}
            absent = sorted(
                (item["main_ar"] for mid, item in city_mains.items() if mid not in present_ids),
            )
            total = totals.get(name, 0)
            classified = classified_totals.get(name, 0)
            results.append({
                "district_ar": name,
                "total": total,
                "classified": classified,
                "classification_pct": round(classified * 100 / total) if total else 0,
                "dominant_activity": activities[0] if activities else None,
                "least_activity": ranked_present[0] if ranked_present else None,
                "activities": activities,
                "absent_from_directory": absent,
            })
        return {
            "ok": True,
            "city": city,
            "districts": results,
            "basis": "سجلات الدليل ذات إسناد حي موثوق وتصنيف نشاط عالي أو متوسط الثقة. الأنشطة الغائبة تعني عدم ظهور سجل مصنف لها في هذا الحي، ولا تثبت غيابها فعلياً.",
        }

    def market_summary(self, body):
        city, subs, where, params, specialty_available = self._where(body)
        aggregate = f"""
            select count(*) total,
                   count(*) filter (where coalesce(p.has_whatsapp, false)) n_whatsapp,
                   count(*) filter (where coalesce(p.is_wholesale, false)) n_wholesale,
                   count(*) filter (where not (
                       coalesce(
                           coalesce(p.location_precision, 'unknown') = 'point'
                           and p.longitude between -180 and 180
                           and p.latitude between -85.05112878 and 85.05112878,
                           false
                       )
                   )) n_approx,
                   count(*) filter (where length(trim(coalesce(p.commercial_license, ''))) > 0) n_cr,
                   count(distinct p.district_ar) filter (
                       where p.district_reliable is true and length(trim(coalesce(p.district_ar, ''))) > 0
                   ) districts_count
            from read_parquet(?) p where {where}
        """
        specialty_sql = f"""
            select count(distinct c.sub_id)
            from read_parquet(?) p join read_parquet(?) c using (poi_key)
            where {where} and c.confidence in ('high', 'medium')
        """
        district_sql = f"""
            select p.district_ar, count(*) n
            from read_parquet(?) p where {where} and p.district_reliable is true
              and length(trim(coalesce(p.district_ar, ''))) > 0
            group by p.district_ar order by n desc, p.district_ar limit 5
        """
        tx = self._tx()
        with self.lock:
            row = self.db.execute(aggregate, params).fetchone()
            n_specialties = self.db.execute(specialty_sql, [DATA, POI_TAXONOMY] + params[1:]).fetchone()[0]
            top_districts = self.db.execute(district_sql, params).fetchall()
            activity_rows = []
            if tx is not None:
                # Use the same approved taxonomy as discovery. Counts are distinct
                # businesses per main activity (a business can belong to multiple).
                taxonomy = [
                    (sid, item.get("main_id") or "", item.get("main_ar") or "غير مصنف")
                    for sid, item in tx.subs.items()
                    if not sid.startswith(("unc.", "noncom."))
                ]
                if taxonomy:
                    taxonomy_sql = ",".join("(?, ?, ?)" for _ in taxonomy)
                    taxonomy_params = [value for activity in taxonomy for value in activity]
                    activity_rows = self.db.execute(
                        f"with taxonomy(sub_id, main_id, main_ar) as (values {taxonomy_sql}) "
                        "select t.main_id, any_value(t.main_ar), count(distinct p.poi_key) n "
                        "from read_parquet(?) p join read_parquet(?) c on c.poi_key = p.poi_key "
                        "join taxonomy t on t.sub_id = c.sub_id "
                        f"where {where} and c.confidence in ('high', 'medium') "
                        "and coalesce(nullif(p.name_ar, ''), p.name_en) is not null "
                        "group by t.main_id order by n desc, t.main_id",
                        taxonomy_params + [DATA, POI_TAXONOMY] + params[1:],
                    ).fetchall()
        # Street lines are aggregated only to subcategory in the current data asset.
        # Do not show one as an exact specialty result.
        dense = None if body.get("specialty_ids") else self._densest_street(city, subs, body.get("main_id"), body.get("districts") or [])
        total, n_whatsapp, n_wholesale, n_approx, n_cr, districts_count = row
        return {
            "ok": True,
            "summary": {
                "total": total,
                "districts_count": districts_count,
                "top_districts": [{"district_ar": name, "n": count} for name, count in top_districts],
                "densest_street": dense,
                "n_wholesale": n_wholesale,
                "n_whatsapp": n_whatsapp,
                "n_specialties": n_specialties,
                "main_activities": [
                    {"main_id": main_id, "main_ar": label, "n": count}
                    for main_id, label, count in activity_rows
                ],
                "main_activities_basis": (
                    "سجلات دليل ذات تصنيف نشاط عالي أو متوسط الثقة؛ قد يظهر السجل ضمن أكثر من نشاط."
                ),
                "n_approx": n_approx,
                "n_cr": n_cr,
                "specialty_available": specialty_available,
                "basis": MARKET_BASIS,
            },
        }

    def _densest_street(self, city, subs, main_id, districts):
        if not os.path.isfile(STREET_DENSITY):
            return None
        clauses = ["city_en = ?"]
        params = [STREET_DENSITY, city]
        if subs:
            clauses.append("sub_id in (select unnest(?::varchar[]))")
            params.append(subs)
        elif main_id:
            clauses.append("main_id = ?")
            params.append(main_id)
        if districts:
            clauses.append("district_ar in (select unnest(?::varchar[]))")
            params.append(districts)
        row = self.db.execute(
            "select street_ar, district_ar, n, length_m, per_100m, sub_ar "
            f"from read_parquet(?) where {' and '.join(clauses)} order by n desc, per_100m desc limit 1",
            params,
        ).fetchone()
        if not row:
            return None
        street, district, count, length_m, per_100m, sub = row
        return {
            "street_ar": street,
            "district_ar": district,
            "n": count,
            "length_m": length_m,
            "per_100m": per_100m,
            "sub_ar": sub,
        }

    def who_buys(self, body):
        city, q, main_id, sub_ids, _, _ = self._validate(body)
        tx = self._tx()
        if tx is None:
            raise RuntimeError("taxonomy unavailable")
        if main_id:
            if main_id not in {item.get("main_id") for item in tx.subs.values()}:
                sub_ids = []
            else:
                main_subs = {sid for sid, item in tx.subs.items() if item.get("main_id") == main_id}
                sub_ids = list(main_subs) if not sub_ids else [sid for sid in sub_ids if sid in main_subs]
        elif q and not sub_ids:
            # This endpoint must not send free text to an external model.
            specialty_ids, _ = tx.spec_hits(q)
            sub_ids = list(dict.fromkeys(tx.specs[sid]["sub_id"] for sid in specialty_ids))
            if not sub_ids:
                sub_ids = tx.subs_in(q)[0]
        elif sub_ids and not all(sid in tx.subs for sid in sub_ids):
            raise ValueError("unknown sub_id")
        if not sub_ids:
            return {
                "ok": True,
                "buyers": [],
                "subject": {"sub_ids": [], "label_ar": "لم يتضح النشاط"},
                "basis": BUYER_BASIS,
            }

        subject_sub_ids = set(sub_ids)
        families = {
            family
            for family, sellers in tx.rel.get("sells", {}).items()
            if any(sub in subject_sub_ids for sub, _ in sellers)
        }
        weights = {}
        for family in families:
            for sub, weight in tx.rel.get("buys", {}).get(family, []):
                if sub not in sub_ids and sub in tx.subs and tx._sub_ok(sub):
                    weights[sub] = max(weights.get(sub, 0), weight)
        ranked = sorted(weights, key=lambda sub: (-weights[sub], tx.subs[sub]["sub_ar"]))[:30]
        counts = {}
        if ranked:
            with self.lock:
                rows = self.db.execute(
                    """
                    select c.sub_id, count(distinct p.poi_key) n,
                           count(distinct p.poi_key) filter (where coalesce(p.has_whatsapp, false)) n_whatsapp
                    from read_parquet(?) p join read_parquet(?) c using (poi_key)
                    where p.city_en = ? and """ + self.tiles.search_sql + """
                      and coalesce(nullif(p.name_ar, ''), p.name_en) is not null
                      and c.confidence in ('high', 'medium')
                      and c.sub_id in (select unnest(?::varchar[]))
                    group by c.sub_id
                    """,
                    [DATA, POI_TAXONOMY, city, ranked],
                ).fetchall()
            counts = {sub: (n, whatsapp) for sub, n, whatsapp in rows}
        buyers = []
        for sub in ranked:
            n, whatsapp = counts.get(sub, (0, 0))
            if n <= 0:
                continue
            entry = tx.subs[sub]
            buyers.append(
                {
                    "sub_id": sub,
                    "sub_ar": entry["sub_ar"],
                    "main_id": entry["main_id"],
                    "main_ar": entry["main_ar"],
                    "strength": "core" if weights[sub] >= 2 else "common",
                    "n": n,
                    "n_whatsapp": whatsapp,
                }
            )
        return {
            "ok": True,
            "buyers": buyers,
            "subject": {
                "sub_ids": sub_ids,
                "label_ar": "، ".join(tx.subs[sub]["sub_ar"] for sub in sub_ids[:4]),
            },
            "basis": BUYER_BASIS,
        }
