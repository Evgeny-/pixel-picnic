"""Turns generated scenes into level pictures: board size and palette grow through the campaign.

  python3 scripts/art/pictures.py            -> .cache/art/pictures.json (+ contact sheets with --sheets)
Source per slot: scripts/art/selection.json ("meadow-05": "extra/px2_frog" | "gen/meadow-05-s23" | "pd/great_wave"),
otherwise the first existing of gen/<slot>-s11, gen/<slot>-s23.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from scenes import SCENES, NAMES  # noqa: E402
from pixelart import posterize, mode_downsample_fx, outline_pass, render_flat  # noqa: E402

ART = '.cache/art'
WORLDS = list(SCENES)


def tier(n):
    return 'superhard' if n >= 10 and n % 10 == 0 else 'hard' if n >= 5 and n % 5 == 0 else 'normal'


def plan(n):
    """Board width and palette limit for level n."""
    w, idx, t = (n - 1) // 20, (n - 1) % 20, tier(n)
    if n <= 4:
        return 22 + 2 * n, 5 + (n >= 4)
    size = 34 + w * 1.4 - (4 if idx < 5 else 0) + {'normal': 0, 'hard': 3, 'superhard': 6}[t]
    colors = 8 + w // 2 + {'normal': 0, 'hard': 1, 'superhard': 2}[t]
    if n <= 20:
        size, colors = min(size, 28 + n // 2), min(colors, 6 + n // 5)
    if n == 260:
        # The Skybound finale has its own tight box limits (see tierTarget); a full-size board fails.
        size, colors = 46, 13
    return int(round(max(26, min(56, size)))), min(16, colors)


def sources(slot, sel):
    """Candidate images for a slot, preferred first (the level builder takes the first one that
    reaches the difficulty target)."""
    picks = [sel[slot]] if isinstance(sel.get(slot), str) else sel.get(slot, [])
    out = [os.path.join(ART, x + ('.json' if x.startswith('fixed/') else '.png')) for x in picks]
    if not picks:  # a hand-picked image is used as is; only free slots compare variants
        for s in ('s11', 's23', 'r37'):
            out.append(os.path.join(ART, 'gen', f'{slot}-{s}.png'))
    seen = {os.path.join(ART, x + '.png') for x in sel.get('_exclude', [])}
    res = []
    for p in out:
        if p not in seen and os.path.exists(p) and os.path.getsize(p) > 0:
            seen.add(p)
            res.append(p)
    return res


def convert(path, gw, K):
    # Simple scenes can collapse to a handful of colors; keep finer shades then (more colors
    # also make better puzzles).
    for md in (0.06, 0.045, 0.035):
        post, pal = posterize(path, K=K, width=640, smooth=0, min_dist=md)
        g = outline_pass(post, pal, mode_downsample_fx(post, pal, gw, gw, feat_contrast=0.3))
        if len(g['palette']) >= min(K, max(5, K - 3)):
            break
    return g


def encode(g):
    cells = np.array(g['cells'])
    return ''.join(np.base_repr(int(c), 36).lower() if c >= 0 else '.' for c in cells.ravel())


def main():
    sel = json.load(open('scripts/art/selection.json')) if os.path.exists('scripts/art/selection.json') else {}
    out, sheet = [], []
    for n in range(2, 281):
        w, idx = WORLDS[(n - 1) // 20], (n - 1) % 20
        slot = f'{w}-{idx + 1:02d}'
        paths = sources(slot, sel)
        size, K = plan(n)
        en, ru = NAMES[w][idx]
        for k, path in enumerate(paths):
            if path.endswith('.json'):
                # Hand-picked artwork converted earlier (paintings, cartoon scenes): used as is.
                fx = json.load(open(path))
                name = fx['name']
                g = {'w': fx['w'], 'h': fx['h'], 'palette': fx['palette'],
                     'cells': np.array([-1 if ch == '.' else int(ch, 36) for ch in fx['cells']]).reshape(fx['h'], fx['w'])}
            else:
                g = convert(path, size, K)
                name = {'en': en, 'ru': ru}
            out.append({'n': n, 'id': slot, 'name': name, 'w': g['w'], 'h': g['h'],
                        'palette': g['palette'], 'cells': encode(g), 'src': os.path.relpath(path, ART)})
        # Last resort for the biggest boards: the generator can fail on 50+ cells with 14+ colors.
        if paths and size >= 46 and not paths[0].endswith('.json'):
            g = convert(paths[0], int(size * 0.85), max(8, K - 3))
            out.append({'n': n, 'id': slot, 'name': {'en': en, 'ru': ru}, 'w': g['w'], 'h': g['h'],
                        'palette': g['palette'], 'cells': encode(g), 'src': os.path.relpath(paths[0], ART) + '#small'})
            if '--sheets' in sys.argv and k == 0:
                sheet.append((n, slot, g))
    json.dump(out, open(os.path.join(ART, 'pictures.json'), 'w'))
    print(len(out), 'pictures')
    if sheet:
        os.makedirs(os.path.join(ART, 'sheets'), exist_ok=True)
        for wi, wname in enumerate(WORLDS):
            items = [x for x in sheet if (x[0] - 1) // 20 == wi]
            if not items:
                continue
            S = 200
            im = Image.new('RGB', (5 * (S + 10), 4 * (S + 24)), 'white')
            d = ImageDraw.Draw(im)
            for k, (n, slot, g) in enumerate(items):
                f = render_flat(g, cell=max(1, S // g['w']))
                x, y = (k % 5) * (S + 10), (k // 5) * (S + 24)
                im.paste(f, (x, y))
                d.text((x, y + S + 4), f"{n} {slot} {g['w']}px {len(g['palette'])}c", fill='black')
            im.save(os.path.join(ART, 'sheets', f'{wi + 1:02d}-{wname}.png'))


if __name__ == '__main__':
    main()
