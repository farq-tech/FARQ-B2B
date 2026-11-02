"""Activities a shopper asks for as one: «أغراض مواليد» means the baby-goods, kids-clothes and toy shops together.

A group is built into the trade corridors as one more activity (build_trade_corridors.py), and a request whose words
name the group without naming one of its trades precisely is answered with the group (market_analytics.corridor_subs).
"""
GROUPS = {
    'group.kids': {
        'sub_ar': 'أغراض الأطفال والمواليد',
        'subs': ('retail.baby', 'fashion.kids', 'retail.toys'),
        # normalized words (taxonomy_search.norm: no hamza on alif, ة → ه) that name the group
        'words': ('مواليد', 'المواليد', 'مولود', 'اطفال', 'الاطفال', 'طفل', 'الطفل', 'بيبي', 'رضع', 'الرضع', 'رضيع', 'baby', 'kids'),
    },
}


def with_groups(subs):
    """The taxonomy's activities plus each group, named and filed under its first trade's main activity."""
    out = dict(subs)
    for gid, group in GROUPS.items():
        members = [s for s in group['subs'] if s in subs]
        if members:
            first = subs[members[0]]
            out[gid] = {'sub_ar': group['sub_ar'], 'main_id': first['main_id'], 'main_ar': first['main_ar']}
    return out


def groups_of(sub):
    return [gid for gid, group in GROUPS.items() if sub in group['subs']]
