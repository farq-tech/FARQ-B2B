# -*- coding: utf-8 -*-
"""Are the targeting AI's picks right? Measured on real supplier answers in the Farq inbox.

Run from ~/farq-targeting:
    railway run -- nice python3 <this file> export   # read-only: labelled (request, supplier) pairs -> data/fit_eval.json
    railway run -- nice python3 <this file> run      # the targeting ranker judges every pair -> report

Labels (real outcomes):
  sells  = the supplier QUOTED, or replied with a price / a quote file, or said «out of stock» (it carries the item)
  no     = the supplier declined with reason DO_NOT_SELL_PRODUCT
  weak_no = declined, reason unspecified (reported separately: it may be price, distance, busy…)
The ranker sees exactly what it sees in production: the request text and the supplier's name + category.
"""
import os, sys, json, importlib.util

HERE = os.getcwd()
OUT = os.path.join(HERE, 'data', 'fit_eval.json')


def export():
    import psycopg
    with psycopg.connect(os.environ['CONSTRUCTION_DB_URL'], sslmode='require', connect_timeout=20) as c:
        c.execute('set transaction read only')
        rows = c.execute("""
          with lab as (
            select i.id invite_id, i.rfq_version_id, i.supplier_id,
              case when i.response_status = 'QUOTED' then 'sells'
                   when bool_or(m.reply_kind in ('QUOTE_FILE','PRICE_IN_TEXT')) then 'sells'
                   when bool_or(m.decline_reason = 'OUT_OF_STOCK') then 'sells'
                   when bool_or(m.decline_reason = 'DO_NOT_SELL_PRODUCT') then 'no'
                   when i.response_status = 'DECLINED' or bool_or(m.reply_kind = 'DECLINED') then 'weak_no' end label
            from construction.rfq_invites i left join construction.inbox_messages m on m.invite_id = i.id
            group by i.id)
          select lab.label, lab.rfq_version_id::text,
                 (select string_agg(coalesce(nullif(e->>'name_ar', ''), e->>'name_en', e->>'original_name'), ' · ')
                    from construction.rfq_versions v, jsonb_array_elements(v.payload->'lines') e where v.id = lab.rfq_version_id),
                 s.id::text, s.name_ar, s.name_en,
                 coalesce(nullif(regexp_replace(coalesce(s.directory_metadata->>'activities', ''), '[\\[\\]"]', '', 'g'), ''), s.supplied_items_text, s.directory_metadata->'rule_trades'->>'primary')
          from lab join construction.suppliers s on s.id = lab.supplier_id
          where lab.label is not null""").fetchall()
    rows = [r for r in rows if (r[2] or '').strip() and 'تسجيل منتجات' not in (r[2] or '') and 'تجربة' not in (r[4] or '')]  # holder / test requests carry no real item
    data = [{'label': r[0], 'version': r[1], 'request': (r[2] or '')[:400], 'supplier_id': r[3], 'name': r[4] or r[5] or '', 'category': (r[6] or '')[:120]} for r in rows]
    json.dump(data, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    from collections import Counter
    print('exported', len(data), Counter(d['label'] for d in data), 'requests', len({d['version'] for d in data}))


def outcomes():
    """Every supplier answer as memory for the ranker -> data/outcomes.json (supplier id, phone digits, what it quoted / declined)."""
    import psycopg
    with psycopg.connect(os.environ['CONSTRUCTION_DB_URL'], sslmode='require', connect_timeout=20) as c:
        c.execute('set transaction read only')
        rows = c.execute("""
          with lab as (
            select i.id, i.rfq_version_id, i.supplier_id,
              case when i.response_status = 'QUOTED' or bool_or(m.reply_kind in ('QUOTE_FILE','PRICE_IN_TEXT')) or bool_or(m.decline_reason = 'OUT_OF_STOCK') then 'sells'
                   when bool_or(m.decline_reason = 'DO_NOT_SELL_PRODUCT') then 'no' end label
            from construction.rfq_invites i left join construction.inbox_messages m on m.invite_id = i.id group by i.id)
          select lab.supplier_id::text, regexp_replace(coalesce(sc.whatsapp_e164, sc.phone_e164, ''), '[^0-9]', '', 'g'), lab.label, lab.rfq_version_id::text,
                 (select string_agg(coalesce(nullif(e->>'name_ar', ''), e->>'name_en'), ' · ') from construction.rfq_versions v, jsonb_array_elements(v.payload->'lines') e where v.id = lab.rfq_version_id)
          from lab left join construction.supplier_contacts sc on sc.supplier_id = lab.supplier_id
          where lab.label is not null""").fetchall()
    data = [{'supplier_id': r[0], 'phone': r[1], 'label': r[2], 'version': r[3], 'items': (r[4] or '')[:160]} for r in rows if (r[4] or '').strip() and 'تسجيل منتجات' not in (r[4] or '')]
    json.dump(data, open(os.path.join(HERE, 'data', 'outcomes.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('outcomes', len(data))


def history_of(mem, d, skip_version=None):
    """The ranker's note for one supplier: what it quoted / declined before (other requests only when skip_version)."""
    xs = [m for m in mem if m['supplier_id'] == d['supplier_id'] and m['version'] != skip_version]
    sold = '; '.join(m['items'][:60] for m in xs if m['label'] == 'sells')
    no = '; '.join(m['items'][:60] for m in xs if m['label'] == 'no')
    return ' / '.join(x for x in [f'quoted before: {sold}' if sold else '', f'declined, does not sell: {no}' if no else ''] if x)


def run():
    spec = importlib.util.spec_from_file_location('srv', os.path.join(HERE, 'server.py'))
    srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)
    data = json.load(open(OUT, encoding='utf-8'))
    by_req = {}
    for d in data: by_req.setdefault(d['version'], []).append(d)
    for ver, items in by_req.items():
        mem = json.load(open(os.path.join(HERE, 'data', 'outcomes.json'), encoding='utf-8')) if os.path.exists(os.path.join(HERE, 'data', 'outcomes.json')) else []
        # leave-one-request-out: the supplier's answer to THIS request is never shown to the ranker
        rows = [{'poi_key': f"{d['supplier_id']}", 'name_ar': d['name'], 'category_ar': d['category'], 'history': history_of(mem, d, ver)} for d in items]
        fit = srv.ai_rank(items[0]['request'], rows)
        for d in items: d['ai'] = fit.get(d['supplier_id'])
    from collections import Counter
    tab = Counter((d['label'], d.get('ai')) for d in data)
    print('label × AI fit (L likely · M maybe · N not · None = not judged):')
    for lab in ('sells', 'no', 'weak_no'):
        tot = sum(v for (l, _), v in tab.items() if l == lab)
        print(f"  {lab:8} n={tot:4}  L={tab[(lab,'L')]:4}  M={tab[(lab,'M')]:4}  N={tab[(lab,'N')]:4}  none={tab[(lab,None)]:3}")
    s = [d for d in data if d['label'] == 'sells']; n = [d for d in data if d['label'] == 'no']
    if s: print(f"sellers kept (L or M): {sum(d.get('ai') in ('L','M') for d in s)}/{len(s)}  ·  as L: {sum(d.get('ai') == 'L' for d in s)}/{len(s)}")
    if n: print(f"non-sellers rejected (N): {sum(d.get('ai') == 'N' for d in n)}/{len(n)}")
    json.dump(data, open(OUT.replace('.json', '.judged.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print('mistakes (sellers judged N):')
    for d in [d for d in s if d.get('ai') == 'N'][:15]: print('   ✗', d['request'][:50], '|', d['name'][:40], '|', d['category'][:40])
    print('mistakes (non-sellers judged L):')
    for d in [d for d in n if d.get('ai') == 'L'][:15]: print('   ✗', d['request'][:50], '|', d['name'][:40], '|', d['category'][:40])


if __name__ == '__main__':
    {'export': export, 'run': run, 'outcomes': outcomes}[sys.argv[1]]()
