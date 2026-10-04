"""Preview processed assets at 4x on a grey checkerboard -> raw/_preview.png"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets")
files = sorted(f for f in os.listdir(OUT) if f.endswith(".png") and f != "title_art.png")
S, CELL = 4, 270
cols = 6
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * CELL, rows * CELL), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(os.path.join(OUT, f)).convert("RGBA")
    im = im.resize((im.width * S, im.height * S), Image.NEAREST)
    im.thumbnail((CELL - 20, CELL - 20), Image.NEAREST)
    x, y = (i % cols) * CELL, (i // cols) * CELL
    bg = Image.new("RGBA", im.size, (120, 120, 120, 255))
    for yy in range(0, im.height, 8):
        for xx in range(0, im.width, 8):
            if (xx // 8 + yy // 8) % 2:
                bg.paste((140, 140, 140, 255), (xx, yy, xx + 8, yy + 8))
    bg.alpha_composite(im)
    sheet.paste(bg.convert("RGB"), (x + 10, y + 16))
    d.text((x + 4, y + 2), f"{f[:-4]} {Image.open(os.path.join(OUT, f)).size}", fill="white")
sheet.save(os.path.join(HERE, "raw", "_preview.png"))
