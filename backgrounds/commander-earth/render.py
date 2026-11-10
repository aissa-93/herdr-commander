# Renders a revolving pixel-art Earth from Natural Earth outlines (public domain).
# usage: render.py <data dir> <out dir> [D globe pixels] [N frames] [S px per globe pixel] [margin]
import json, math, sys, os
import numpy as np
from PIL import Image, ImageDraw

data, out = sys.argv[1], sys.argv[2]
D = int(sys.argv[3]) if len(sys.argv) > 3 else 112
N = int(sys.argv[4]) if len(sys.argv) > 4 else 240
SC = int(sys.argv[5]) if len(sys.argv) > 5 else 4
MARGIN = float(sys.argv[6]) if len(sys.argv) > 6 else 0.72   # the globe's share of the picture
only = [int(x) for x in sys.argv[7].split(",")] if len(sys.argv) > 7 else None

W, H = 8192, 4096
def polys(name):
    g = json.load(open(os.path.join(data, name + ".geojson")))
    for f in g["features"]:
        geo = f["geometry"]
        if not geo: continue
        for p in ([geo["coordinates"]] if geo["type"] == "Polygon" else geo["coordinates"]):
            yield p
def draw(mask, name, fill):
    d = ImageDraw.Draw(mask)
    xy = lambda ring: [((lon + 180) / 360 * W, (90 - lat) / 180 * H) for lon, lat, *_ in ring]
    for p in polys(name):
        d.polygon(xy(p[0]), fill=fill)
        for hole in p[1:]: d.polygon(xy(hole), fill=255 - fill)

land = Image.new("L", (W, H), 0); draw(land, "ne_50m_land", 255); draw(land, "ne_50m_lakes", 0)
ice = Image.new("L", (W, H), 0); draw(ice, "ne_50m_glaciated_areas", 255); draw(ice, "ne_50m_antarctic_ice_shelves_polys", 255)
land = np.asarray(land) > 127; ice = np.asarray(ice) > 127

TILT = math.radians(23.4)
SS = 5                                             # sub-samples a side, per globe pixel
n = D * SS
c = (np.arange(n) + 0.5) / n * 2 - 1
X, Y = np.meshgrid(c, -c)                           # y up
R2 = X * X + Y * Y
inside = R2 <= 1
Z = np.sqrt(np.clip(1 - R2, 0, 1))
# undo the axis' lean (north pole leans right) to get earth-aligned coordinates
ex = X * math.cos(TILT) - Y * math.sin(TILT)
ey = X * math.sin(TILT) + Y * math.cos(TILT)
lat = np.arcsin(np.clip(ey, -1, 1))
lon0 = np.arctan2(ex, Z)
row = np.clip(((math.pi / 2 - lat) / math.pi * H).astype(int), 0, H - 1)

# light from the upper left, fixed in the picture: the planet turns under it
L = np.array([-0.55, 0.5, 0.67]); L = L / np.linalg.norm(L)
def cell(a): return a.reshape(D, SS, D, SS).mean(axis=(1, 3))
lit = cell(X * L[0] + Y * L[1] + Z * L[2])
disc = cell(inside.astype(float)) >= 0.5
jj, ii = np.meshgrid(np.arange(D), np.arange(D))
checker = (ii + jj) % 2 == 0
shade = (lit < 0.12) | ((lit < 0.26) & checker)      # shadow side, a dithered edge to it

PAL = {  # (lit, shade)
    "ocean": ((0x2b, 0x42, 0x5c), (0x1f, 0x2e, 0x44)),
    "land":  ((0x5d, 0x7a, 0x5a), (0x3f, 0x56, 0x44)),
    "ice":   ((0xb4, 0xbf, 0xc9), (0x76, 0x84, 0x93)),
}
size = int(round(D * SC / MARGIN / 2)) * 2
off = (size - D * SC) // 2
os.makedirs(out, exist_ok=True)
for k in (only or range(N)):
    lam = -2 * math.pi * k / N                      # the surface moves west to east
    col = (((lon0 + lam + math.pi) % (2 * math.pi)) / (2 * math.pi) * W).astype(int) % W
    isl = cell((land[row, col] & inside).astype(float)) >= 0.5
    isi = cell((ice[row, col] & inside).astype(float)) >= 0.5
    img = np.zeros((D, D, 4), np.uint8)
    for name, m in (("ocean", disc), ("land", disc & isl), ("ice", disc & isi)):
        a, b = PAL[name]
        img[m & ~shade] = (*a, 255); img[m & shade] = (*b, 255)
    im = Image.fromarray(img, "RGBA").resize((D * SC, D * SC), Image.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0)); canvas.paste(im, (off, off))
    canvas.save(os.path.join(out, f"{k:03d}.png"), optimize=True)
print("frames", len(only or range(N)), "size", size, "globe", D * SC)
