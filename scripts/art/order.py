"""Mixes the scenes over the campaign: simple pictures early, richer ones later and on hard levels,
and never the same theme twice in a row.  python3 scripts/art/order.py -> scripts/art/order.json"""
import json, os, random, sys

sys.path.insert(0, os.path.dirname(__file__))
from scenes import SCENES  # noqa: E402

DROP = {'meadow-01'}  # level 1 is the authored strawberry; one scene stays out


def tier(n):
    return 'superhard' if n >= 10 and n % 10 == 0 else 'hard' if n >= 5 and n % 5 == 0 else 'normal'


def main():
    rnd = random.Random(2026)
    pools = {'simple': [], 'medium': [], 'rich': []}
    for w, scenes in SCENES.items():
        for i in range(len(scenes)):
            slot = f'{w}-{i + 1:02d}'
            if slot not in DROP:
                pools['simple' if i < 5 else 'rich' if i >= 15 else 'medium'].append(slot)
    levels = list(range(2, 281))
    bonus = {'normal': 0.0, 'hard': 0.12, 'superhard': 0.25}
    score = {n: (n - 2) / 278 + bonus[tier(n)] + rnd.uniform(-0.04, 0.04) for n in levels}
    by_score = sorted(levels, key=lambda n: score[n])
    cls, k = {}, 0
    for name in ('simple', 'medium', 'rich'):
        for n in by_score[k:k + len(pools[name])]:
            cls[n] = name
        k += len(pools[name])
    # Interleave themes inside every pool, then hand scenes out in level order.
    queues = {}
    for name, slots in pools.items():
        by_theme = {}
        for s in slots:
            by_theme.setdefault(s.rsplit('-', 1)[0], []).append(s)
        for v in by_theme.values():
            rnd.shuffle(v)
        order = []
        while any(by_theme.values()):
            themes = [t for t in by_theme if by_theme[t]]
            rnd.shuffle(themes)
            order += [by_theme[t].pop() for t in themes]
        queues[name] = order
    out = {n: queues[cls[n]].pop(0) for n in levels}
    # No theme twice in a row: swap with a later level of the same class when needed.
    theme = lambda n: out[n].rsplit('-', 1)[0]  # noqa: E731
    for n in levels[1:]:
        if theme(n) != theme(n - 1):
            continue
        for m in levels:
            if m > n and cls[m] == cls[n] and theme(m) not in (theme(n - 1), theme(n + 1) if n + 1 in out else '') \
                    and theme(n) not in (theme(m - 1), theme(m + 1) if m + 1 in out else ''):
                out[n], out[m] = out[m], out[n]
                break
    repeats = sum(1 for n in levels[1:] if theme(n) == theme(n - 1))
    json.dump({str(n): out[n] for n in levels}, open(os.path.join(os.path.dirname(__file__), 'order.json'), 'w'), indent=0)
    print('levels', len(out), 'same theme in a row:', repeats, 'first:', [out[n] for n in range(2, 12)])


if __name__ == '__main__':
    main()
