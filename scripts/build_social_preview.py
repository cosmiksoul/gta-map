"""Render the share image from the atlas geometry. Requires Pillow and NumPy."""

import json
from pathlib import Path
import re
from xml.etree import ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "docs" / "assets"
SCALE = 2
W, H = 1200, 630
SIZE = (W * SCALE, H * SCALE)


def rgb(hex_color):
    return np.array(tuple(bytes.fromhex(hex_color)), dtype=np.float32)


def field(amount, stops):
    return np.stack([np.interp(amount, [p for p, _ in stops], [rgb(c)[i] for _, c in stops])
                     for i in range(3)], axis=-1)


def font(size, bold=False, italic=False):
    suffix = "-BoldOblique" if italic else "-Bold" if bold else ""
    choices = [
        Path("C:/Windows/Fonts") / ("segoeuiz.ttf" if italic else "segoeuib.ttf" if bold else "seguisb.ttf"),
        Path("/usr/share/fonts/truetype/dejavu") / f"DejaVuSans{suffix}.ttf",
        Path("/System/Library/Fonts/Supplemental") / ("Arial Bold Italic.ttf" if italic else "Arial Bold.ttf" if bold else "Arial.ttf"),
    ]
    return ImageFont.truetype(str(next(p for p in choices if p.is_file())), size * SCALE)


def px(x, y):
    return round(x * SCALE), round(y * SCALE)


def project(x, y):
    # Geometry paths use four integer units per map viewBox unit.
    x, y = x / 4, y / 4
    return px(680 + .335 * x - .025 * y, 12 + .305 * y)


def rings(d):
    for part in d.split("M")[1:]:
        coords = list(map(int, re.findall(r"-?\d+", part)))
        x, y = coords[:2]
        points = [project(x, y)]
        for dx, dy in zip(coords[2::2], coords[3::2]):
            x += dx
            y += dy
            point = project(x, y)
            if point != points[-1]:
                points.append(point)
        if len(points) > 1:
            yield points


def mask_polygons(group):
    mask = Image.new("L", SIZE)
    draw = ImageDraw.Draw(mask)
    for path in group:
        for index, ring in enumerate(rings(path.attrib["d"])):
            if len(ring) > 2:
                draw.polygon(ring, fill=255 if index == 0 else 0)
    return mask


def tint(image, color, mask):
    image.paste(Image.new("RGB", SIZE, color), mask=mask)


def make_poster():
    y, x = np.mgrid[:SIZE[1], :SIZE[0]].astype(np.float32) / SCALE
    light = np.exp(-(((x-1055)/395)**2 + ((y-144)/358)**2))
    sky = field(y/H, [(0, "20152f"), (.48, "322040"), (1, "231631")])
    sky += light[..., None] * np.array([87, 32, 44])
    rng = np.random.default_rng(6)
    grain = rng.normal(0, 2.3, (SIZE[1], SIZE[0], 1))

    # A single low sun anchors the geography; bands get wider toward the horizon.
    disc = ((x-955)/237)**2 + ((y-216)/237)**2 <= 1
    bands = [(278, 281), (298, 303), (320, 327), (343, 353),
             (368, 381), (396, 412), (426, 447)]
    for start, end in bands:
        disc &= (y < start) | (y > end)
    sun = field((y+20)/470, [(0, "ffe1a0"), (.34, "ffbf8a"),
                             (.70, "ff897d"), (1, "ed66a0")])
    sky = np.where(disc[..., None], sun, sky)
    image = Image.fromarray(np.uint8(np.clip(sky + grain, 0, 255)))

    root = ET.parse(ASSETS / "basemap.svg").getroot()
    terrain = next(e for e in root if e.get("transform") == "scale(.25)")
    _, land, park, urban, paved, sand, buildings, *roads = list(terrain)
    land_mask = mask_polygons(land)
    waterline = land_mask.filter(ImageFilter.MaxFilter(5))
    tint(image, "#b36684", waterline)
    land_color = field(y/H, [(0, "423459"), (.49, "503953"), (1, "4d294a")])
    image.paste(Image.fromarray(np.uint8(np.clip(land_color + grain, 0, 255))), mask=land_mask)
    for group, color in ((park, "#484563"), (urban, "#67445f"), (paved, "#997178"),
                         (sand, "#bf8283"), (buildings, "#7a536d")):
        tint(image, color, mask_polygons(group))
    draw = ImageDraw.Draw(image)
    for path, color, width in zip(roads, ("#866a82", "#b492a1", "#b48299", "#eda18b", "#ffd596"),
                                  (.48, .52, .54, .75, 1.28)):
        for line in rings(path.attrib["d"]):
            draw.line(line, fill=color, width=max(1, round(width * SCALE)))

    # Print the exact town anchor over its road network.
    labels = json.loads((ASSETS / "basemap-labels.json").read_text(encoding="utf-8"))
    vice = next(label for label in labels if label["name"] == "Vice City")
    vx, vy = project((vice["x"] + 10400) * .4, (10400 - vice["y"]) * .4)
    for radius, color in [(7, "#2d223b"), (5, "#7ae5d7"), (2, "#251a35")]:
        r = radius * SCALE
        draw.ellipse((vx-r, vy-r, vx+r, vy+r), fill=color)
    draw.line([(vx+6*SCALE, vy-3*SCALE), (vx+22*SCALE, vy-20*SCALE),
               (vx+43*SCALE, vy-20*SCALE)], fill="#b5ede1", width=2)
    draw.text((vx+48*SCALE, vy-20*SCALE), "Vice City", font=font(17, True),
              fill="#fff5e4", anchor="lm", stroke_width=2, stroke_fill="#432d49")

    draw.text(px(68, 176), "Атлас", font=font(118, True), fill="#fff4e9", anchor="lt")
    word = Image.new("L", SIZE)
    ImageDraw.Draw(word).text(px(66, 280), "Леониды", font=font(118, True, True), fill=255, anchor="lt")
    ink = field((y-280)/103, [(0, "ffc292"), (.52, "ff9f91"), (1, "f47da8")])
    image.paste(Image.fromarray(np.uint8(ink)), mask=word)
    draw.line([px(75, 437), px(136, 437)], fill="#f45fa8", width=4*SCALE)
    draw.text(px(153, 437), "Карта активностей GTA VI", font=font(34), fill="#fff4e9", anchor="lm")

    logo = Image.open(ROOT / "docs" / "apple-touch-icon.png").convert("RGBA")
    logo.thumbnail(px(63, 63), Image.Resampling.LANCZOS)
    image.paste(logo, px(73, 83), logo)

    exif = Image.Exif()
    exif[270] = "Leonida activity atlas. Reprojected and restyled Open GTA 6 Map vector data."
    exif[33432] = ("Map data: Open GTA 6 Map (fbritoferreira), "
                   "https://github.com/fbritoferreira/gta6 ; CC BY 4.0, "
                   "https://creativecommons.org/licenses/by/4.0/")
    image = image.resize((W, H), Image.Resampling.LANCZOS)
    image.save(ASSETS / "social-preview.jpg", quality=91, subsampling=0, optimize=True, exif=exif)


if __name__ == "__main__":
    make_poster()
