"""Render the Open GTA 6 Map vector geometry in the same frame as data/points.csv.

Pass a directory containing land.json, surface.json, roads.json, and rails.json
from https://github.com/fbritoferreira/gta6/tree/d8609016b8a883988d7abac4b6b1b1d98708ca70/public/data.
No network access or third-party packages are needed to render the map.
"""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REVISION = "d8609016b8a883988d7abac4b6b1b1d98708ca70"
ASSETS = ROOT / "docs" / "assets"
# Each output SVG unit is 10 game units; integer paths use quarter SVG units.
UNIT = 4
WEST, NORTH = -10400, 10400


def project(point):
    x, y = point
    return (round((32 * x - 16384 - WEST) * UNIT / 10),
            round((NORTH - 16384 + 32 * y) * UNIT / 10))


def simplify(points, tolerance):
    """Douglas-Peucker approximation in the integer drawing grid."""
    if len(points) < 3:
        return points
    x0, y0 = points[0]
    x1, y1 = points[-1]
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy
    farthest = tolerance * tolerance
    split = 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        tip = max(0, min(1, ((px - x0) * dx + (py - y0) * dy) / length2)) if length2 else 0
        distance2 = (px - x0 - tip * dx) ** 2 + (py - y0 - tip * dy) ** 2
        if distance2 > farthest:
            farthest = distance2
            split = i
    if split:
        return simplify(points[:split + 1], tolerance)[:-1] + simplify(points[split:], tolerance)
    return [points[0], points[-1]]


def svg_path(coords, closed, tolerance):
    points = [project(point) for point in coords]
    if not points:
        return ""
    if closed and points[-1] != points[0]:
        points.append(points[0])
    points = simplify(points, tolerance)
    if closed:
        points = points[:-1]
    if len(set(points)) < (3 if closed else 2):
        return ""
    x0, y0 = points[0]
    pieces = [f"M{x0} {y0}l"]
    for x, y in points[1:]:
        pieces.append(f"{x - x0} {y - y0}")
        x0, y0 = x, y
    result = pieces[0] + " ".join(pieces[1:]).replace(" -", "-")
    return result + ("z" if closed else "")


def build(data_dir):
    def read(name):
        return json.loads((data_dir / f"{name}.json").read_text(encoding="utf-8"))

    polygons = defaultdict(list)
    for polygon in read("land"):
        polygons["land"].append("".join(svg_path(ring, True, 1.3) for ring in polygon))
    for feature in read("surface")["features"]:
        layer = feature["properties"]["layer"]
        polygon = feature["geometry"]["coordinates"]
        polygons[layer].append("".join(svg_path(ring, True, 1.6) for ring in polygon))

    lines = defaultdict(list)
    for file in ("roads", "rails"):
        for feature in read(file)["features"]:
            layer = feature["properties"].get("kind", file)
            lines[layer].append(svg_path(feature["geometry"]["coordinates"], False, 1.4))

    result = ['<svg xmlns="http://www.w3.org/2000/svg" width="1420" height="1990" viewBox="0 0 1420 1990">',
              '<title>Leonida</title>',
              '<desc>Coasts, land cover, roads and railways from Open GTA 6 Map (fbritoferreira), '
              f'https://github.com/fbritoferreira/gta6/tree/{REVISION}, CC BY 4.0, '
              'https://creativecommons.org/licenses/by/4.0/. Reprojected, simplified, and restyled.</desc>',
              '<defs><pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">'
              '<path d="M100 0H0V100" fill="none" stroke="#86b3ba" opacity=".13" stroke-width="1"/>'
              '<path d="M46 50h8m-4-4v8" stroke="#86b3ba" opacity=".16" stroke-width=".8"/>'
              '</pattern></defs>',
              '<rect width="100%" height="100%" fill="#102b35"/>',
              '<rect width="100%" height="100%" fill="url(#grid)"/>',
              '<g transform="scale(.25)" fill-rule="evenodd" stroke-linejoin="round" stroke-linecap="round">']
    for layer, color in (("shallow", "#1e4249"), ("land", "#3b5049"), ("park", "#355547"),
                         ("urban", "#4b5652"), ("paved", "#788177"), ("sand", "#747b69"),
                         ("building", "#5d6960")):
        # Give each polygon its own fill operation so overlaps never punch holes.
        outline = ' stroke="#7d9380" stroke-width="1.7"' if layer == "land" else ""
        result.append(f'<g fill="{color}"{outline}>')
        result.extend(f'<path d="{path}"/>' for path in polygons[layer] if path)
        result.append('</g>')
    for layer, color, width in (("minor", "#63746a", 1.9), ("street", "#849186", 2.4),
                                ("rails", "#879484", 2.4), ("main", "#b0a68a", 4),
                                ("highway", "#c0ac7d", 5.4)):
        dash = ' stroke-dasharray="6 4"' if layer == "rails" else ""
        path = "".join(lines[layer])
        result.append(f'<path fill="none" stroke="{color}" stroke-width="{width}"{dash} d="{path}"/>')
    result.append('</g></svg>')
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "basemap.svg").write_text("\n".join(result) + "\n", encoding="utf-8")

    with (ROOT / "data" / "points.csv").open(encoding="utf-8-sig", newline="") as infile:
        labels = []
        regions = {"Mount Kalaga National Park", "Grassrivers", "Leonida Keys", "Lake Leonida"}
        for row in csv.DictReader(infile):
            if row["coordinate_source"] != "gtabase":
                continue
            if row["category"] == "city-town":
                kind = "city"
            elif row["category"] == "landmark" and row["name"] in regions:
                kind = "region"
            else:
                continue
            labels.append({"name": row["name"], "x": float(row["x"]),
                           "y": float(row["y"]), "kind": kind})
    priority = ["Vice City", "Port Gellhorn", "Ambrosia", "Leonida Keys", "Mount Kalaga National Park",
                "Grassrivers", "Waning Sands", "Key Lento", "Capri", "Vice Beach", "Hamlet",
                "Watson Bay", "Gloriana Key", "Lake Leonida"]
    labels.sort(key=lambda label: priority.index(label["name"]) if label["name"] in priority else len(priority))
    (ASSETS / "basemap-labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data_dir", type=Path)
    build(parser.parse_args().data_dir)
