"""Turn raw SDXL renders into game-ready pixel art.

- textures: box-downscale (keeps seamless tiling) + NES palette
- sprites:  key out flat background, crop, area-downscale, NES palette, binary alpha, optional outline
- cars:     hue-shifted color variants
Writes assets/*.png and assets/manifest.js.   Usage: python process_assets.py [name ...]
"""
import os, sys, json, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "..", "assets")
os.makedirs(OUT, exist_ok=True)

NES = """7C7C7C 0000FC 0000BC 4428BC 940084 A80020 A81000 881400 503000 007800 006800 005800 004058 000000
BCBCBC 0078F8 0058F8 6844FC D800CC E40058 F83800 E45C10 AC7C00 00B800 00A800 00A844 008888
F8F8F8 3CBCFC 6888FC 9878F8 F878F8 F85898 F87858 FCA044 F8B800 B8F818 58D854 58F898 00E8D8 787878
FCFCFC A4E4FC B8B8F8 D8B8F8 F8B8F8 F8A4C0 F0D0B0 FCE0A8 F8D878 D8F878 B8F8B8 B8F8D8 00FCFC F8D8F8""".split()
PAL = np.array(sorted({tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in NES}), dtype=np.float32)

# Which raw seed to use per asset (index in raw/<name>_<seed>.png), chosen by eye from contact sheets.
PICKS = json.load(open(os.path.join(HERE, "picks.json"))) if os.path.exists(os.path.join(HERE, "picks.json")) else {}

# name: (kind, max_w, max_h, outline)
SPECS = {
    "tex_grass": ("tex", 64), "tex_dirt": ("tex", 64), "tex_asphalt": ("tex", 64), "tex_sand": ("tex", 64),
    "tex_water": ("tex", 64), "tex_snow": ("tex", 64), "tex_ice": ("tex", 64), "tex_concrete": ("tex", 64),
    "tex_rubber": ("tex", 64),
    "car_buggy": ("car", 14, 22, True), "car_formula": ("car", 14, 24, True),
    "oil": ("spr", 32, 32, False), "puddle": ("spr", 36, 36, False), "missile": ("spr", 6, 14, True),
    "tree_oak": ("spr", 48, 52, True), "bush": ("spr", 22, 20, True), "haybale": ("spr", 22, 20, True),
    "tree_palm": ("spr", 44, 60, True), "rock": ("spr", 24, 22, True), "umbrella": ("spr", 34, 36, True),
    "tree_pine": ("spr", 34, 56, True), "snowman": ("spr", 22, 30, True), "cone": ("spr", 12, 14, True),
    "barrel": ("spr", 16, 20, True), "tirestack": ("spr", 20, 22, True), "lamp": ("spr", 18, 56, True),
    "cloud": ("spr", 64, 48, True), "bomb": ("spr", 12, 12, True),
    "icon_engine": ("spr", 16, 16, True), "icon_tire": ("spr", 16, 16, True), "icon_battery": ("spr", 16, 16, True),
    "trophy": ("spr", 56, 64, True),
    "title_art": ("art", 320, 183),
}

CAR_HUES = {"red": 0, "blue": 0.62, "green": 0.33, "yellow": 0.14}


def nes_quantize(rgb):
    """rgb: HxWx3 float array -> nearest NES color per pixel (weighted RGB distance)."""
    w = np.array([0.30, 0.59, 0.11], dtype=np.float32) ** 0.5
    flat = rgb.reshape(-1, 3) * w
    pal = PAL * w
    d = ((flat[:, None, :] - pal[None, :, :]) ** 2).sum(-1)
    return PAL[d.argmin(1)].reshape(rgb.shape)


def pick(name):
    """picks.json entry: seed  or  [seed, "flip", ...] -> (path, options)"""
    v = PICKS.get(name, 0)
    seed, opts = (v[0], set(v[1:])) if isinstance(v, list) else (v, set())
    return os.path.join(RAW, f"{name}_{seed}.png"), opts


def key_background(im):
    """Return alpha mask (bool) by flood-filling near-background colors from the border."""
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    lab, _ = ndimage.label(dist < 48)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(edge_labels))
    fg = ~bgmask
    fg = ndimage.binary_opening(fg, iterations=2)
    fg = ndimage.binary_erosion(fg, iterations=2)
    # keep main blobs only
    lab2, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab2, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s >= sizes.max() * 0.08]
        fg = np.isin(lab2, keep)
    return a, fg


def fit_downscale(rgb, alpha, max_w, max_h):
    ys, xs = np.nonzero(alpha)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgb, alpha = rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1].astype(np.float32)
    h, w = alpha.shape
    s = min(max_w / w, max_h / h)
    W, H = max(1, round(w * s)), max(1, round(h * s))
    prem = Image.fromarray(np.uint8(np.clip(rgb * alpha[..., None], 0, 255)))
    am = Image.fromarray(np.uint8(alpha * 255))
    prem = np.asarray(prem.resize((W, H), Image.BOX), dtype=np.float32)
    am = np.asarray(am.resize((W, H), Image.BOX), dtype=np.float32) / 255
    rgb = prem / np.maximum(am[..., None], 1e-3)
    return rgb, am > 0.45


def add_outline(rgb, alpha):
    """1px dark outline around the silhouette (grows the canvas by 1px each side)."""
    rgb = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
    alpha = np.pad(alpha, 1)
    ring = ndimage.binary_dilation(alpha) & ~alpha
    rgb[ring] = (0, 0, 0)
    return rgb, alpha | ring


def boost_contrast(rgb, amount=1.15):
    m = rgb.mean(axis=(0, 1), keepdims=True)
    return np.clip((rgb - m) * amount + m, 0, 255)


def save_rgba(rgb, alpha, name):
    out = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    out[..., :3] = np.clip(rgb, 0, 255)
    out[..., 3] = alpha * 255
    Image.fromarray(out, "RGBA").save(os.path.join(OUT, name + ".png"))


def hue_shift(rgb, alpha, hue):
    out = rgb.copy()
    H, W, _ = rgb.shape
    for y in range(H):
        for x in range(W):
            if not alpha[y, x]:
                continue
            r, g, b = rgb[y, x] / 255
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            if s > 0.35 and v > 0.2:
                out[y, x] = np.array(colorsys.hsv_to_rgb((h + hue) % 1, s, v)) * 255
    return out


def process(name):
    spec = SPECS[name]
    kind = spec[0]
    path, opts = pick(name)
    if not os.path.exists(path):
        print("  missing", path)
        return []
    im = Image.open(path).convert("RGB")
    if "flip" in opts:
        im = im.rotate(180)
    if kind == "tex":
        size = spec[1]
        rgb = np.asarray(im.resize((size, size), Image.BOX), dtype=np.float32)
        # normalize detail so flat textures keep some grain after palette mapping
        mean = rgb.mean(axis=(0, 1), keepdims=True)
        std = float(np.sqrt(((rgb - mean) ** 2).mean())) + 1e-3
        rgb = np.clip(mean + (rgb - mean) * (float(next((o[7:] for o in opts if o.startswith("detail=")), 16)) / std), 0, 255)
        save_rgba(nes_quantize(rgb), np.ones((size, size), bool), name)
        return [name]
    if kind == "art":
        rgb = np.asarray(im.resize((spec[1], spec[2]), Image.BOX), dtype=np.float32)
        save_rgba(nes_quantize(boost_contrast(rgb, 1.1)), np.ones((spec[2], spec[1]), bool), name)
        return [name]
    _, mw, mh, outline = spec
    rgb, fg = key_background(im)
    rgb, alpha = fit_downscale(rgb, fg, mw, mh)
    rgb = nes_quantize(boost_contrast(rgb))
    if outline:
        rgb, alpha = add_outline(rgb, alpha)
    if kind == "car":
        names = []
        for cname, hue in CAR_HUES.items():
            v = nes_quantize(hue_shift(rgb, alpha, hue)) if hue else rgb
            save_rgba(v, alpha, f"{name}_{cname}")
            names.append(f"{name}_{cname}")
        return names
    save_rgba(rgb, alpha, name)
    return [name]


def main():
    names = sys.argv[1:] or list(SPECS)
    for n in names:
        print(n, process(n))
    files = sorted(f[:-4] for f in os.listdir(OUT) if f.endswith(".png"))
    with open(os.path.join(OUT, "manifest.js"), "w") as f:
        f.write("// generated by tools/process_assets.py\nconst ASSET_NAMES = " + json.dumps(files) + ";\n")


if __name__ == "__main__":
    main()
