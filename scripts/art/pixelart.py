# Pixel-art conversion helpers for the illustrated campaign (numpy + Pillow).
"""Raster image -> few-color pixel grid (exploration tool for richer level pictures).

Pipeline:
  1. crop (fractions) and resample to a working size of SS x grid (area filter, linear light);
  2. k-means++ in OKLab over the working pixels -> K "fine" colors (K * 2), Ward-merged to K;
  3. each grid cell takes the color that covers most of its SS x SS block (mode -> crisp edges)
     or, for painterly sources, the color nearest to the cell mean;
  4. cleanup: isolated low-contrast cells adopt the neighbour majority; colors with too few cells
     fold into their nearest neighbour color; colors closer than min_dist merge;
  5. palette = mean of the source colors that landed in each color, slightly more vivid.
"""
from __future__ import annotations

import json
import numpy as np
from PIL import Image


# ----------------------------------------------------------------------------- color math
def srgb_to_lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055) * 255


M1 = np.array([[0.4122214708, 0.5363325363, 0.0514459929],
               [0.2119034982, 0.6806995451, 0.1073969566],
               [0.0883024619, 0.2817188376, 0.6299787005]])
M2 = np.array([[0.2104542553, 0.7936177850, -0.0040720468],
               [1.9779984951, -2.4285922050, 0.4505937099],
               [0.0259040371, 0.7827717662, -0.8086757660]])
M1i = np.linalg.inv(M1)
M2i = np.linalg.inv(M2)


def lin_to_lab(rgb):
    lms = rgb @ M1.T
    return np.cbrt(lms) @ M2.T


def lab_to_lin(lab):
    lms = (lab @ M2i.T) ** 3
    return lms @ M1i.T


def lab_to_hex(lab):
    lab = np.array(lab, dtype=float)
    L, a, b = lab
    # reduce chroma until in gamut
    lo, hi = 0.0, 1.0
    if np.any((lab_to_lin(np.array([L, a, b])) < -1e-4) | (lab_to_lin(np.array([L, a, b])) > 1 + 1e-4)):
        for _ in range(20):
            mid = (lo + hi) / 2
            lin = lab_to_lin(np.array([L, a * mid, b * mid]))
            if np.all((lin >= -1e-4) & (lin <= 1 + 1e-4)):
                lo = mid
            else:
                hi = mid
        a, b = a * lo, b * lo
    rgb = lin_to_srgb(lab_to_lin(np.array([L, a, b])))
    return '#' + ''.join(f'{int(round(v)):02x}' for v in rgb)


def hex_to_lab(h):
    h = h.lstrip('#')
    rgb = np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=float)
    return lin_to_lab(srgb_to_lin(rgb))


# ----------------------------------------------------------------------------- k-means
def kmeans(X, w, k, seed=1, iters=30):
    rng = np.random.default_rng(seed)
    n = len(X)
    k = min(k, n)
    centers = [X[rng.choice(n, p=w / w.sum())]]
    d2 = np.full(n, np.inf)
    for _ in range(1, k):
        d2 = np.minimum(d2, ((X - centers[-1]) ** 2).sum(1))
        p = w * d2
        if p.sum() <= 0:
            break
        centers.append(X[rng.choice(n, p=p / p.sum())])
    C = np.array(centers)
    for _ in range(iters):
        D = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2)
        lab = D.argmin(1)
        newC = np.array([np.average(X[lab == j], axis=0, weights=w[lab == j]) if np.any(lab == j) else C[j] for j in range(len(C))])
        if np.allclose(newC, C, atol=1e-5):
            C = newC
            break
        C = newC
    D = ((X[:, None, :] - C[None, :, :]) ** 2).sum(2)
    return C, D.argmin(1)


def ward_merge(C, W, k, min_d):
    """Merge clusters bottom-up (Ward cost) until <= k remain and none are closer than min_d.
    Returns list of member index lists."""
    groups = [[i] for i in range(len(C))]
    cen = [C[i].copy() for i in range(len(C))]
    wt = [W[i] for i in range(len(C))]
    while len(groups) > 1:
        n = len(groups)
        best = None
        close = None
        for i in range(n):
            for j in range(i + 1, n):
                d2 = ((cen[i] - cen[j]) ** 2).sum()
                cost = wt[i] * wt[j] / (wt[i] + wt[j]) * d2
                if best is None or cost < best[0]:
                    best = (cost, i, j)
                if close is None or d2 < close[0]:
                    close = (d2, i, j)
        if np.sqrt(close[0]) < min_d:
            _, i, j = close
        elif n > k:
            _, i, j = best
        else:
            break
        tw = wt[i] + wt[j]
        cen[i] = (cen[i] * wt[i] + cen[j] * wt[j]) / tw
        wt[i] = tw
        groups[i] = groups[i] + groups[j]
        del groups[j], cen[j], wt[j]
    return groups


# ----------------------------------------------------------------------------- main
def load(path, crop=None, bg=(255, 255, 255)):
    im = Image.open(path)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA')
        base = Image.new('RGBA', im.size, bg + (255,))
        base.alpha_composite(im)
        im = base
    im = im.convert('RGB')
    if crop:
        W, H = im.size
        x0, y0, x1, y1 = crop
        im = im.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H)))
    return im


def resample_lin(im, w, h):
    """Area-average resample in linear light. Returns float array (h, w, 3) linear RGB."""
    arr = srgb_to_lin(np.asarray(im, dtype=float))
    chans = []
    for c in range(3):
        ch = Image.fromarray(arr[:, :, c].astype(np.float32), mode='F')
        chans.append(np.asarray(ch.resize((w, h), Image.BOX), dtype=float))
    return np.stack(chans, axis=2)


def merge_palette(C, W, k, min_d):
    """Merge closest centroids (weighted) until <= k remain and all pairs are >= min_d apart."""
    C = [c.copy() for c in C]
    W = list(W)
    groups = [[i] for i in range(len(C))]
    while len(C) > 1:
        n = len(C)
        D = np.array([[np.linalg.norm(C[i] - C[j]) if i < j else np.inf for j in range(n)] for i in range(n)])
        i, j = np.unravel_index(D.argmin(), D.shape)
        if D[i, j] >= min_d and n <= k:
            break
        if D[i, j] >= min_d:
            # over budget: merge the pair with the lowest Ward cost instead
            best = None
            for a in range(n):
                for b in range(a + 1, n):
                    cost = W[a] * W[b] / (W[a] + W[b]) * D[a, b] ** 2
                    if best is None or cost < best[0]:
                        best = (cost, a, b)
            _, i, j = best
        tw = W[i] + W[j]
        C[i] = (C[i] * W[i] + C[j] * W[j]) / tw
        W[i] = tw
        groups[i] += groups[j]
        del C[j], W[j], groups[j]
    return np.array(C), W, groups


def pixelate(path, gw, gh, K, crop=None, ss=4, mode='mode', min_dist=0.075, vivid=1.12,
             levels=None, min_cells=None, keep_contrast=0.2, seed=3, bg=(255, 255, 255),
             pre_blur=0.0, sat_extra=0.0, light=0.0, sharpen=0.0, weights=None):
    im = load(path, crop, bg)
    if pre_blur > 0:
        from PIL import ImageFilter
        im = im.filter(ImageFilter.GaussianBlur(pre_blur))
    if sharpen > 0:
        from PIL import ImageFilter
        im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=int(sharpen * 100), threshold=2))
    work = resample_lin(im, gw * ss, gh * ss)
    lab = lin_to_lab(work.reshape(-1, 3)).reshape(gh * ss, gw * ss, 3)
    if levels:
        lo, hi, tlo, thi = levels
        L = lab[:, :, 0]
        plo, phi = np.percentile(L, lo), np.percentile(L, hi)
        lab[:, :, 0] = np.clip((L - plo) / max(1e-6, phi - plo), 0, 1) * (thi - tlo) + tlo
    if light:
        lab[:, :, 0] = np.clip(lab[:, :, 0] + light, 0, 1)
    if sat_extra:
        lab[:, :, 1:] *= (1 + sat_extra)
    cell_mean = lab.reshape(gh, ss, gw, ss, 3).mean((1, 3))
    if mode == 'mode':
        # palette from the working pixels themselves (keeps saturated brush colors)
        X = lab.reshape(-1, 3)
        q = np.round(X / np.array([0.008, 0.005, 0.005])).astype(np.int64)
        keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
        inv = inv.reshape(-1)
        sums = np.zeros((len(keys), 3))
        np.add.at(sums, inv, X)
        X = sums / counts[:, None]
        w = counts.astype(float)
    else:
        X = cell_mean.reshape(-1, 3)
        w = np.ones(len(X))
        pad = np.pad(cell_mean, ((1, 1), (1, 1), (0, 0)), mode='edge')
        local = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:]) / 4
        contrast = np.linalg.norm(cell_mean - local, axis=2).reshape(-1)
        w = w * (1 + 6 * np.clip(contrast - 0.03, 0, 0.2))
    C, lab_idx = kmeans(X, w, K + 8, seed=seed)
    CW = np.array([w[lab_idx == j].sum() for j in range(len(C))])
    C, CW, _ = merge_palette(C, CW, K, min_dist)
    G = len(C)
    if mode == 'mode':
        hr = lab.reshape(-1, 3)
        D = ((hr[:, None, :] - C[None, :, :]) ** 2).sum(2)
        hl = D.argmin(1).reshape(gh, ss, gw, ss).transpose(0, 2, 1, 3).reshape(gh, gw, ss * ss)
        hist = np.stack([(hl == g).sum(2) for g in range(G)], axis=2).astype(float)
        # tie-break / soften with distance of the cell mean
        Dm = ((cell_mean[:, :, None, :] - C[None, None, :, :]) ** 2).sum(3)
        cells = (hist - Dm * 10).argmax(2)
    else:
        Dm = ((cell_mean[:, :, None, :] - C[None, None, :, :]) ** 2).sum(3)
        cells = Dm.argmin(2)
    cent = C
    cells = cleanup(cells, cent, keep_contrast)
    if min_cells is None:
        min_cells = max(3, int(gw * gh * 0.003))
    cells = fold_small2(cells, cent, min_cells, keep_contrast)
    used = sorted(set(cells.ravel().tolist()), key=lambda c: -(cells == c).sum())
    remap = {c: i for i, c in enumerate(used)}
    pal = []
    for c in used:
        m = cells == c
        v = np.median(cell_mean[m], axis=0).copy()
        v[1:] *= vivid
        pal.append(lab_to_hex(v))
    out = np.vectorize(remap.get)(cells)
    return {'w': gw, 'h': gh, 'palette': pal, 'cells': out}


def fold_small2(cells, cent, min_cells, keep_contrast):
    cells = cells.copy()
    while True:
        ids, counts = np.unique(cells, return_counts=True)
        small = [(c, n) for c, n in zip(ids, counts) if n < min_cells]
        if not small or len(ids) <= 1:
            return cells
        c, n = min(small, key=lambda t: t[1])
        others = [o for o in ids if o != c]
        tgt = min(others, key=lambda o: np.linalg.norm(cent[c] - cent[o]))
        cells[cells == c] = tgt


def neighbours(cells, y, x):
    h, w = cells.shape
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w:
            yield cells[ny, nx]


def cleanup(cells, cent, keep_contrast, passes=2):
    cells = cells.copy()
    h, w = cells.shape
    for _ in range(passes):
        changed = 0
        for y in range(h):
            for x in range(w):
                c = cells[y, x]
                nb = list(neighbours(cells, y, x))
                if c in nb:
                    continue
                # isolated: keep it if it contrasts strongly with every neighbour (eye, star)
                dmin = min(np.linalg.norm(cent[c] - cent[o]) for o in nb)
                if dmin >= keep_contrast:
                    continue
                # 8-neighbour majority
                votes = {}
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dy == 0 and dx == 0:
                            continue
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w:
                            o = cells[ny, nx]
                            votes[o] = votes.get(o, 0) + (1.0 if dy == 0 or dx == 0 else 0.6)
                best = max(votes.items(), key=lambda kv: (kv[1], -np.linalg.norm(cent[c] - cent[kv[0]])))[0]
                cells[y, x] = best
                changed += 1
        if not changed:
            break
    return cells


def fold_small(cells, cent, min_cells, keep_contrast):
    cells = cells.copy()
    while True:
        ids, counts = np.unique(cells, return_counts=True)
        small = [(c, n) for c, n in zip(ids, counts) if n < min_cells]
        if not small:
            return cells, cent
        c, n = min(small, key=lambda t: t[1])
        others = [o for o in ids if o != c]
        if not others:
            return cells, cent
        tgt = min(others, key=lambda o: np.linalg.norm(cent[c] - cent[o]))
        cells[cells == c] = tgt


def merge_close(cells, cent, min_dist):
    cells = cells.copy()
    while True:
        ids, counts = np.unique(cells, return_counts=True)
        best = None
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                d = np.linalg.norm(cent[ids[i]] - cent[ids[j]])
                if d < min_dist and (best is None or d < best[0]):
                    best = (d, ids[i], ids[j], counts[i], counts[j])
        if best is None:
            return cells, cent
        _, a, b, na, nb = best
        big, small = (a, b) if na >= nb else (b, a)
        cells[cells == small] = big


# ----------------------------------------------------------------------------- previews
def render_cubes(grid, cell=16, gap=1, frame=None):
    """Approximate the in-game look: rounded cubes with a lit top edge."""
    from PIL import ImageDraw
    w, h = grid['w'], grid['h']
    pal = [tuple(int(p[i:i + 2], 16) for i in (1, 3, 5)) for p in grid['palette']]
    W, H = w * cell, h * cell
    img = Image.new('RGB', (W, H), (40, 30, 24))
    d = ImageDraw.Draw(img)
    cells = grid['cells']
    for y in range(h):
        for x in range(w):
            c = cells[y][x] if isinstance(cells, list) else cells[y, x]
            if c < 0:
                continue
            r, g, b = pal[c]
            x0, y0 = x * cell, y * cell
            dark = tuple(int(v * 0.62) for v in (r, g, b))
            light = tuple(min(255, int(v + (255 - v) * 0.35)) for v in (r, g, b))
            d.rounded_rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], radius=3, fill=dark)
            d.rounded_rectangle([x0 + 1, y0, x0 + cell - 2, y0 + cell - 4], radius=3, fill=(r, g, b))
            d.line([x0 + 3, y0 + 1, x0 + cell - 4, y0 + 1], fill=light)
    return img


def render_flat(grid, cell=8):
    w, h = grid['w'], grid['h']
    pal = [tuple(int(p[i:i + 2], 16) for i in (1, 3, 5)) for p in grid['palette']]
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    cells = np.array(grid['cells'])
    for i, p in enumerate(pal):
        arr[cells == i] = p
    return Image.fromarray(arr).resize((w * cell, h * cell), Image.NEAREST)


def to_json(grid):
    cells = np.array(grid['cells'])
    alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    s = ''.join(alphabet[c] if c >= 0 else '.' for c in cells.ravel())
    return {'w': grid['w'], 'h': grid['h'], 'palette': grid['palette'], 'cells': s}


# ----------------------------------------------------------------------------- cartoon / AI art
def thin_mask(m):
    """Zhang-Suen thinning of a boolean mask (keeps 1-cell-wide lines)."""
    m = m.copy().astype(np.uint8)
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            p = np.pad(m, 1)
            P2, P3, P4 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:]
            P5, P6, P7 = p[2:, 2:], p[2:, 1:-1], p[2:, :-2]
            P8, P9 = p[1:-1, :-2], p[:-2, :-2]
            nb = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(x.astype(int) for x in nb)
            seq = nb + [P2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(int) for i in range(8))
            if step == 0:
                c = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            rm = (m == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rm.any():
                m[rm] = 0
                changed = True
    return m.astype(bool)


def pixelate_cartoon(path, gw, gh, K, crop=None, ss=8, min_dist=0.075, vivid=1.08, line_boost=1.8,
                     line_L=0.32, min_cells=None, keep_contrast=0.2, seed=3, sat_extra=0.0,
                     levels=None, edge_q=70, cleanup_passes=2, bg=(255, 255, 255)):
    """For flat-colored art with outlines (AI cartoons, vector art): palette from flat areas only,
    per-cell mode with a boost for dark line colors so outlines stay continuous."""
    im = load(path, crop, bg)
    work = resample_lin(im, gw * ss, gh * ss)
    lab = lin_to_lab(work.reshape(-1, 3)).reshape(gh * ss, gw * ss, 3)
    if levels:
        lo, hi, tlo, thi = levels
        L = lab[:, :, 0]
        plo, phi = np.percentile(L, lo), np.percentile(L, hi)
        lab[:, :, 0] = np.clip((L - plo) / max(1e-6, phi - plo), 0, 1) * (thi - tlo) + tlo
    if sat_extra:
        lab[:, :, 1:] *= (1 + sat_extra)
    # flat pixels: low local gradient
    gx = np.zeros(lab.shape[:2]); gy = np.zeros(lab.shape[:2])
    gx[:, 1:-1] = np.linalg.norm(lab[:, 2:] - lab[:, :-2], axis=2)
    gy[1:-1, :] = np.linalg.norm(lab[2:, :] - lab[:-2, :], axis=2)
    grad = np.hypot(gx, gy)
    flat = grad < np.percentile(grad, edge_q)
    X = lab[flat]
    q = np.round(X / np.array([0.008, 0.005, 0.005])).astype(np.int64)
    keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(keys), 3))
    np.add.at(sums, inv, X)
    U = sums / counts[:, None]
    Wt = counts.astype(float)
    C, li = kmeans(U, Wt, K + 10, seed=seed)
    CW = np.array([Wt[li == j].sum() for j in range(len(C))])
    C, CW, _ = merge_palette(C, CW, K, min_dist)
    G = len(C)
    hr = lab.reshape(-1, 3)
    D = ((hr[:, None, :] - C[None, :, :]) ** 2).sum(2)
    hl = D.argmin(1).reshape(gh, ss, gw, ss).transpose(0, 2, 1, 3).reshape(gh, gw, ss * ss)
    hist = np.stack([(hl == g).sum(2) for g in range(G)], axis=2).astype(float)
    is_line = C[:, 0] < line_L
    boost = np.where(is_line, line_boost, 1.0)
    cells = (hist * boost[None, None, :]).argmax(2)
    # thin over-thick line regions back to 1-cell strokes where they came from thin source lines
    for g in np.where(is_line)[0]:
        m = cells == g
        if not m.any():
            continue
        cover = hist[:, :, g] / (ss * ss)
        thin = thin_mask(m)
        # cells that the line only grazed (low coverage) and that thinning removed go back
        drop = m & ~thin & (cover < 0.45)
        if drop.any():
            alt = hist.copy()
            alt[:, :, g] = -1
            cells[drop] = alt[drop].argmax(1)
    for _ in range(cleanup_passes):
        cells = cleanup(cells, C, keep_contrast, passes=1)
    if min_cells is None:
        min_cells = max(3, int(gw * gh * 0.0025))
    cells = fold_small2(cells, C, min_cells, keep_contrast)
    used = sorted(set(cells.ravel().tolist()), key=lambda c: -(cells == c).sum())
    remap = {c: i for i, c in enumerate(used)}
    pal = []
    for c in used:
        v = C[c].copy()
        v[1:] *= vivid
        pal.append(lab_to_hex(v))
    out = np.vectorize(remap.get)(cells)
    return {'w': gw, 'h': gh, 'palette': pal, 'cells': out}


def detect_pixel_period(path, lo=6.0, hi=40.0):
    """Estimate the size of the 'big pixels' of AI pixel art (period of edge positions)."""
    im = np.asarray(Image.open(path).convert('RGB'), dtype=float)
    out = []
    for axis in (1, 0):
        d = np.abs(np.diff(im, axis=axis)).sum(2)
        prof = d.sum(0 if axis == 1 else 1)
        prof = prof - prof.mean()
        n = len(prof)
        best = None
        for p in np.arange(lo, hi, 0.05):
            ph = np.exp(-2j * np.pi * np.arange(n) / p)
            v = abs((prof * ph).sum())
            if best is None or v > best[0]:
                best = (v, p, np.angle((prof * ph).sum()))
        out.append(best)
    return out  # [(strength, period, phase) for x, y]


def posterize(path, K=16, crop=None, width=512, min_dist=0.06, edge_q=65, seed=3, sat_extra=0.0, smooth=1):
    """Flat-color version of an illustration: palette from flat (low-gradient) pixels, every pixel
    snapped to it, then a small majority filter to clean anti-aliasing. Returns PIL RGB image."""
    im = load(path, crop)
    im = im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)
    arr = srgb_to_lin(np.asarray(im, dtype=float))
    lab = lin_to_lab(arr.reshape(-1, 3)).reshape(arr.shape)
    if sat_extra:
        lab[:, :, 1:] *= 1 + sat_extra
    gx = np.zeros(lab.shape[:2]); gy = np.zeros(lab.shape[:2])
    gx[:, 1:-1] = np.linalg.norm(lab[:, 2:] - lab[:, :-2], axis=2)
    gy[1:-1, :] = np.linalg.norm(lab[2:, :] - lab[:-2, :], axis=2)
    grad = np.hypot(gx, gy)
    flat = grad < np.percentile(grad, edge_q)
    X = lab[flat]
    q = np.round(X / np.array([0.008, 0.005, 0.005])).astype(np.int64)
    keys, inv, counts = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    inv = inv.reshape(-1)
    sums = np.zeros((len(keys), 3)); np.add.at(sums, inv, X)
    U = sums / counts[:, None]; Wt = counts.astype(float)
    C, li = kmeans(U, Wt, K + 10, seed=seed)
    CW = np.array([Wt[li == j].sum() for j in range(len(C))])
    C, CW, _ = merge_palette(C, CW, K, min_dist)
    flatlab = lab.reshape(-1, 3)
    labels = np.empty(len(flatlab), dtype=int)
    for s in range(0, len(flatlab), 65536):
        D = ((flatlab[s:s + 65536, None, :] - C[None]) ** 2).sum(2)
        labels[s:s + 65536] = D.argmin(1)
    labels = labels.reshape(lab.shape[:2])
    for _ in range(smooth):
        # 3x3 majority filter, but never erase dark line pixels
        h, w = labels.shape
        p = np.pad(labels, 1, mode='edge')
        votes = np.zeros((h, w, len(C)), dtype=np.int16)
        for dy in range(3):
            for dx in range(3):
                nb = p[dy:dy + h, dx:dx + w]
                votes[np.arange(h)[:, None], np.arange(w)[None, :], nb] += 1
        maj = votes.argmax(2)
        dark = C[labels][:, :, 0] < 0.35
        keep = dark | (votes[np.arange(h)[:, None], np.arange(w)[None, :], labels] >= 3)
        labels = np.where(keep, labels, maj)
    pal_hex = [lab_to_hex(c) for c in C]
    rgb = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in pal_hex], dtype=np.uint8)
    out = rgb[labels]
    img = Image.fromarray(out)
    img.labels = labels
    return img, pal_hex


def mode_downsample(img, pal_hex, gw, gh, dark_boost=1.3, keep_contrast=0.25, min_cells=3, cleanup_passes=1):
    """Posterized image (exact palette colors) -> grid by per-cell majority, dark colors slightly favoured."""
    labels = img.labels
    H, W = labels.shape
    labs = np.array([hex_to_lab(h) for h in pal_hex])
    boost = np.where(labs[:, 0] < 0.35, dark_boost, 1.0)
    ys = (np.arange(H) * gh // H)
    xs = (np.arange(W) * gw // W)
    hist = np.zeros((gh, gw, len(pal_hex)))
    np.add.at(hist, (ys[:, None].repeat(W, 1), xs[None, :].repeat(H, 0), labels), 1)
    cells = (hist * boost[None, None, :]).argmax(2)
    for _ in range(cleanup_passes):
        cells = cleanup(cells, labs, keep_contrast, passes=1)
    cells = fold_small2(cells, labs, min_cells, keep_contrast)
    used = sorted(set(cells.ravel().tolist()), key=lambda c: -(cells == c).sum())
    remap = {c: i for i, c in enumerate(used)}
    return {'w': gw, 'h': gh, 'palette': [pal_hex[c] for c in used], 'cells': np.vectorize(remap.get)(cells)}


def _components(lbl):
    """4-connected components of an int label map. Returns comp id map and list of (label, pixels)."""
    h, w = lbl.shape
    comp = np.full((h, w), -1, dtype=np.int32)
    comps = []
    for y in range(h):
        for x in range(w):
            if comp[y, x] >= 0:
                continue
            L = lbl[y, x]
            cid = len(comps)
            stack = [(y, x)]
            comp[y, x] = cid
            pix = []
            while stack:
                cy, cx = stack.pop()
                pix.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and comp[ny, nx] < 0 and lbl[ny, nx] == L:
                        comp[ny, nx] = cid
                        stack.append((ny, nx))
            comps.append((int(L), pix))
    return comp, comps


def mode_downsample_fx(img, pal_hex, gw, gh, sub=4, dark_boost=1.3, keep_contrast=0.25, min_cells=3,
                       feat_contrast=0.22, feat_max_cells=1.6):
    """Majority downsample that also keeps small high-contrast features (eyes, buttons, stars)."""
    labels = img.labels
    H, W = labels.shape
    labs = np.array([hex_to_lab(h) for h in pal_hex])
    G = len(pal_hex)
    boost = np.where(labs[:, 0] < 0.35, dark_boost, 1.0)
    # intermediate grid (sub x finer) by majority
    sw, sh = gw * sub, gh * sub
    ys = np.arange(H) * sh // H
    xs = np.arange(W) * sw // W
    hist = np.zeros((sh, sw, G), dtype=np.float32)
    np.add.at(hist, (ys[:, None].repeat(W, 1), xs[None, :].repeat(H, 0), labels), 1)
    fine = hist.argmax(2)
    # final cells from the fine map
    blocks = fine.reshape(gh, sub, gw, sub).transpose(0, 2, 1, 3).reshape(gh, gw, sub * sub)
    chist = np.stack([(blocks == g).sum(2) for g in range(G)], axis=2).astype(float)
    cells = (chist * boost[None, None, :]).argmax(2)
    # small features in the fine map
    comp, comps = _components(fine)
    max_area = feat_max_cells * sub * sub
    claimed = {}
    for cid, (L, pix) in enumerate(comps):
        if len(pix) > max_area:
            continue
        py = np.array([p[0] for p in pix]); px = np.array([p[1] for p in pix])
        # surrounding labels
        ring = []
        for y, x in pix:
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < sh and 0 <= nx < sw and comp[ny, nx] != cid:
                    ring.append(fine[ny, nx])
        if not ring:
            continue
        sur = max(set(ring), key=ring.count)
        contrast = np.linalg.norm(labs[L] - labs[sur])
        if contrast < feat_contrast:
            continue
        if len(pix) < max(2, sub * sub // 5) and contrast < 0.45:
            continue
        cy, cx = int(py.mean()) // sub, int(px.mean()) // sub
        # already visible where it sits → fine (a neighbouring outline of the same color doesn't count)
        own = [(y // sub, x // sub) for y, x in pix]
        if any(cells[a, b] == L and np.count_nonzero((py // sub == a) & (px // sub == b)) >= sub * sub * 0.25 for a, b in set(own)):
            continue
        if claimed.get((cy, cx), 0) >= contrast:
            continue
        claimed[(cy, cx)] = contrast
        cells[cy, cx] = L
    keep = np.zeros_like(cells, dtype=bool)
    for (cy, cx) in claimed:
        keep[cy, cx] = True
    cells2 = cleanup(cells, labs, keep_contrast, passes=1)
    cells = np.where(keep, cells, cells2)
    cells = fold_small2(cells, labs, min_cells, keep_contrast)
    used = sorted(set(cells.ravel().tolist()), key=lambda c: -(cells == c).sum())
    remap = {c: i for i, c in enumerate(used)}
    return {'w': gw, 'h': gh, 'palette': [pal_hex[c] for c in used], 'cells': np.vectorize(remap.get)(cells)}


def native_period(path, lo=5, hi=40):
    """Most likely size of the 'big pixels' in AI pixel art (autocorrelation of edge profiles)."""
    im = np.asarray(Image.open(path).convert('RGB'), dtype=float)
    res = []
    for axis in (1, 0):
        d = np.abs(np.diff(im, axis=axis)).sum(2)
        prof = d.sum(0 if axis == 1 else 1)
        prof = prof - prof.mean()
        ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
        ac = ac / ac[0]
        best = max(range(lo, hi), key=lambda l: ac[l])
        res.append((best, round(float(ac[best]), 3)))
    return res


def _erode(m):
    p = np.pad(m, 1)
    return m & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]


def _dilate(m):
    p = np.pad(m, 1)
    return m | p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]


def outline_pass(img, pal_hex, g, sub=4, L_thr=0.3, thick_iter=2, min_len=3):
    """Re-draw thin dark strokes of the source (outlines, whiskers, mouths) as continuous 1-cell lines."""
    labels = img.labels
    H, W = labels.shape
    gw, gh = g['w'], g['h']
    labs = np.array([hex_to_lab(h) for h in pal_hex])
    dark = labs[:, 0] < L_thr
    if not dark.any():
        return g
    sw, sh = gw * sub, gh * sub
    ys = np.arange(H) * sh // H
    xs = np.arange(W) * sw // W
    G = len(pal_hex)
    hist = np.zeros((sh, sw, G), dtype=np.float32)
    np.add.at(hist, (ys[:, None].repeat(W, 1), xs[None, :].repeat(H, 0), labels), 1)
    fine = hist.argmax(2)
    mask = dark[fine]
    core = mask
    for _ in range(thick_iter):
        core = _erode(core)
    opened = core
    for _ in range(thick_iter + 1):
        opened = _dilate(opened)
    thin = mask & ~opened
    skel = thin_mask(thin)
    hit = skel.reshape(gh, sub, gw, sub).transpose(0, 2, 1, 3).reshape(gh, gw, sub * sub).sum(2) >= 1
    # drop tiny isolated bits
    comp, comps = _components(hit.astype(int))
    for cid, (L, pix) in enumerate(comps):
        if L == 1 and len(pix) < min_len:
            for y, x in pix:
                hit[y, x] = False
    # remap: g['palette'] order -> source palette index
    pal_index = {h: i for i, h in enumerate(pal_hex)}
    cells = np.array(g['cells'])
    src_idx = np.array([pal_index[h] for h in g['palette']])
    full = src_idx[cells]
    fblocks = fine.reshape(gh, sub, gw, sub).transpose(0, 2, 1, 3).reshape(gh, gw, sub * sub)
    for y, x in zip(*np.nonzero(hit)):
        ls = fblocks[y, x]
        dl = ls[dark[ls]]
        if len(dl):
            full[y, x] = np.bincount(dl).argmax()
    used = sorted(set(full.ravel().tolist()), key=lambda c: -(full == c).sum())
    remap = {c: i for i, c in enumerate(used)}
    return {'w': gw, 'h': gh, 'palette': [pal_hex[c] for c in used], 'cells': np.vectorize(remap.get)(full)}
