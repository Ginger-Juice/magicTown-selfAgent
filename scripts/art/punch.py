"""Flood-fill punch: art-preview -> public. Edge-connected near-black only."""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "assets" / "art-preview"
DST = ROOT / "public"


def flood_punch(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    px = im.load()
    w, h = im.size
    seen = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def is_bg(c: tuple[int, int, int, int]) -> bool:
        return c[0] < 16 and c[1] < 16 and c[2] < 16

    for x in range(w):
        q.append((x, 0))
        q.append((x, h - 1))
    for y in range(h):
        q.append((0, y))
        q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h or seen[y][x]:
            continue
        seen[y][x] = True
        if not is_bg(px[x, y]):
            continue
        px[x, y] = (0, 0, 0, 0)
        q.append((x + 1, y))
        q.append((x - 1, y))
        q.append((x, y + 1))
        q.append((x, y - 1))
    return im


def main() -> None:
    p = argparse.ArgumentParser(description="Punch Google cutouts into public/")
    p.add_argument("files", nargs="+", help="PNG filenames under assets/art-preview/")
    args = p.parse_args()
    DST.mkdir(parents=True, exist_ok=True)
    for name in args.files:
        src = SRC / name
        dest = DST / name
        out = flood_punch(Image.open(src))
        out.save(dest)
        print(f"ok {name} -> {dest} {out.size}")


if __name__ == "__main__":
    main()
