"""Contact sheet of raw images: python sheet.py <prefix> [prefix...] -> raw/_sheet.png"""
import sys, os, glob
from PIL import Image, ImageDraw

RAW = os.path.join(os.path.dirname(__file__), "raw")
files = sorted(f for p in sys.argv[1:] for f in glob.glob(os.path.join(RAW, p + "*.png")) if "_sheet" not in f)
T = 256
cols = min(6, len(files))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * T, rows * (T + 14)), "black")
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB")
    im.thumbnail((T, T))
    x, y = (i % cols) * T, (i // cols) * (T + 14)
    sheet.paste(im, (x, y + 14))
    d.text((x + 3, y + 1), os.path.basename(f)[:-4], fill="white")
sheet.save(os.path.join(RAW, "_sheet.png"))
print(len(files), "images")
