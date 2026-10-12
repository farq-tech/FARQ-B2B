"""Read-only aggregate diagnosis of the existing directory; exports no entity records."""
import json
import sys
from pathlib import Path
import duckdb

source = Path(sys.argv[1]).resolve(strict=True)
stat_before = (source.stat().st_size, source.stat().st_mtime_ns)
con = duckdb.connect(':memory:')
con.read_parquet(str(source)).create_view('directory')
columns = [r[0] for r in con.execute('DESCRIBE directory').fetchall()]
total, cities = con.execute('SELECT count(*), count(DISTINCT city_en) FROM directory').fetchone()
visible = con.execute('SELECT count(*) FROM (SELECT city_en FROM directory WHERE city_en IS NOT NULL GROUP BY 1 HAVING count(*) >= 1500)').fetchone()[0]
unayzah = con.execute('SELECT count(*), mode(city_ar) FROM directory WHERE city_en = ?', ['Unayzah']).fetchone()
fields = [c for c in ['name_ar', 'name_en', 'category', 'category_ar', 'secondary_category', 'category_l3', 'google_category'] if c in columns]
expr = "translate(lower(concat_ws(' ', " + ', '.join(fields) + ")), 'أإآةىؤئ', 'اااهيوي')"
hits = con.execute('SELECT count(*) FROM directory WHERE city_en = ? AND regexp_matches(' + expr + ', ?)', ['Unayzah', 'منظف|نظاف|clean|detergent|hygien']).fetchone()[0]
con.close()
assert stat_before == (source.stat().st_size, source.stat().st_mtime_ns), 'SOURCE_CHANGED_DURING_AUDIT'
print(json.dumps({'source': str(source), 'source_unchanged_size_mtime': True,
  'records': total, 'distinct_cities': cities, 'current_city_threshold': 1500, 'cities_above_threshold': visible,
  'Unayzah': {'records': unayzah[0], 'modal_ar': unayzah[1], 'cleaning_label_hits': hits},
  'timestamp_columns': [c for c in columns if any(t in c.lower() for t in ['observed', 'crawled', 'updated_at', 'created_at'])],
  'interpretation': 'Zero label hits means coverage gap, not absence of real suppliers. Categories alone do not prove product sale or purchase.',
  'entity_records_exported': 0}, ensure_ascii=False, indent=2))
