# Draws the flat map's land and ice (land.svg, ice.svg, beside this file) from the
# globe's own pictures, so the two always show the same coasts.
# usage: make-land.py <backgrounds/commander-earth> [degrees per cell] [north edge] [south edge]
# Change the numbers and MAP at the top of main.js has to say the same.
import math, os, sys
import numpy as np
from PIL import Image

frames = sys.argv[1]
DEG = float(sys.argv[2]) if len(sys.argv) > 2 else 4
NORTH = float(sys.argv[3]) if len(sys.argv) > 3 else 76
SOUTH = float(sys.argv[4]) if len(sys.argv) > 4 else -56
N, STEP, TILT = 480, 0.75, math.radians(23.4)      # render.py's: frames, degrees between them, the axis' lean
SIZE, GLOBE = 312, 224                             # a picture and the globe in it, px

# Picture k looks straight at longitude -0.75 k: its middle meridian, a line leaning
# with the axis, is that longitude from pole to pole.
FINE = 0.5
lats = np.radians(np.arange(90 - FINE / 2, -90, -FINE))
off = (SIZE - GLOBE) / 2
xs = np.clip((off + (np.sin(lats) * math.sin(TILT) + 1) / 2 * GLOBE).astype(int), 0, SIZE - 1)
ys = np.clip((off + (1 - np.sin(lats) * math.cos(TILT)) / 2 * GLOBE).astype(int), 0, SIZE - 1)
kind = np.zeros((len(lats), N), np.uint8)          # 0 sea, 1 land, 2 ice; column = longitude east of 0 / 0.75
for k in range(N):
    p = np.asarray(Image.open(os.path.join(frames, f"{k:03d}.png")).convert("RGB")).astype(int)[ys, xs]
    land = (p[:, 1] > p[:, 2]) & (p.sum(axis=1) > 0)
    ice = (p[:, 0] > 100) & (p[:, 2] > 120)
    kind[:, int(round((-STEP * k) % 360 / STEP)) % N] = np.where(ice, 2, np.where(land, 1, 0))

cols, rows = int(round(360 / DEG)), int(round((NORTH - SOUTH) / DEG))
def share(what, r, c):
    lat0 = int((90 - NORTH + r * DEG) / FINE); lat1 = int((90 - NORTH + (r + 1) * DEG) / FINE)
    lon = -180 + c * DEG
    idx = [int(round(((lon + i * STEP) % 360) / STEP)) % N for i in range(int(DEG / STEP) + 1)]
    return (kind[lat0:lat1][:, idx] == what).mean()
cells = np.zeros((rows, cols), np.uint8)
for r in range(rows):
    for c in range(cols):
        l, i = share(1, r, c), share(2, r, c)
        cells[r, c] = 2 if i >= 0.4 and i >= l else 1 if l + i >= 0.42 else 0

def write(name, what):
    d = []
    for r in range(rows):
        c = 0
        while c < cols:
            if cells[r, c] != what: c += 1; continue
            e = c
            while e < cols and cells[r, e] == what: e += 1
            d.append(f"M{c} {r}h{e - c}v1h-{e - c}z"); c = e
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, name), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{cols}" height="{rows}" viewBox="0 0 {cols} {rows}" shape-rendering="crispEdges"><path fill="currentColor" d="{"".join(d)}"/></svg>\n')
write("land.svg", 1); write("ice.svg", 2)
print(f"{cols} x {rows} cells")
for r in range(rows): print("".join(" #:"[v] for v in cells[r]))
