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

    def _tx(self):
        if self._taxonomy is None:
            with self._taxonomy_lock:
                if self._taxonomy is None:
                    self._taxonomy = taxonomy_search.get()
        return self._taxonomy

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
        resolved = list(sub_ids)
        if main_id:
            if main_id not in {item.get("main_id") for item in tx.subs.values()}:
                return [], True
            main_subs = {sid for sid, item in tx.subs.items() if item.get("main_id") == main_id}
            resolved = list(main_subs) if not resolved else [sid for sid in resolved if sid in main_subs]
        elif q and not resolved:
            # Keep analytics local-only: don't pass a query to any model/provider.
            specialty_ids, _ = tx.spec_hits(q)
            resolved = list(dict.fromkeys(tx.specs[sid]["sub_id"] for sid in specialty_ids))
            if not resolved:
                resolved = tx.subs_in(q)[0]
            if not resolved:
                return [], True
        if resolved and not all(sid in tx.subs for sid in resolved):
            raise ValueError("unknown sub_id")
        return resolved, bool((main_id or q) and not resolved)

    def _where(self, body):
        city, q, main_id, sub_ids, districts, objective = self._validate(body)
        subs, empty_match = self._resolve_subs(q, main_id, sub_ids, objective)
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
        return city, subs, " and ".join(clauses), params

    def district_counts(self, body):
        city, _, where, params = self._where(body)
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
            "basis": MARKET_BASIS,
        }

    def market_summary(self, body):
        city, subs, where, params = self._where(body)
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
        with self.lock:
            row = self.db.execute(aggregate, params).fetchone()
            n_specialties = self.db.execute(specialty_sql, [DATA, POI_TAXONOMY] + params[1:]).fetchone()[0]
            top_districts = self.db.execute(district_sql, params).fetchall()
            dense = self._densest_street(city, subs, body.get("main_id"), body.get("districts") or [])
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
                "n_approx": n_approx,
                "n_cr": n_cr,
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
