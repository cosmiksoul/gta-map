"""Build the static map catalogue from the local research CSV, or reclassify the published JSON."""

import csv
import json
import math
from collections import Counter
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
INPUT = ROOT / "data" / "points.csv"
OUTPUT = ROOT / "docs" / "assets" / "points.json"
SOURCES = ("gtabase", "leonida", "tracker", "ign")
LAYER_ICONS = {
    "properties": "safehouse", "robberies": "heists", "activities": "sports",
    "collectibles": "collections", "collectible-cards": "cards", "vehicles": "transport",
    "weapons": "weapon-spawn", "style": "clothing", "food-drink": "dining",
    "local-places": "places",
}

# Leonida Verse uses broader labels for some categories. Keep those distinct when
# its record does not identify which GTABase subtype or robbery mechanic applies.
EXTRA_CATEGORIES = {
    "counties": ("Округа", "Counties", "counties"),
    "islands": ("Острова", "Islands", "islands"),
    "places": ("Прочие места", "Other places", "places"),
    "nature": ("Природные находки", "Nature finds", "nature"),
    "collectibles": ("Другие коллекционные предметы", "Other collectibles", "collectibles"),
    "stranger-missions": ("Миссии незнакомцев", "Stranger missions", "stranger-missions"),
    "robbery-store": ("Магазины для ограбления", "Stores to rob", "robbery-store"),
    "smash-n-grab": ("Ювелирные магазины для ограбления", "Jewelry robbery locations", "smash-n-grab"),
    "fence": ("Ломбарды", "Pawn shops", "fence"),
    "waink": ("Сканирования WAiNK без подтипа", "WAiNK scans of unspecified type", "waink"),
    "publications": ("Издания без подтипа", "Publications of unspecified type", "publications"),
    "dining": ("Рестораны", "Restaurants", "dining"),
    "vehicles": ("Прочий транспорт", "Other vehicles", "vehicles"),
    "vehicle": ("Места появления транспорта без подтипа", "Vehicle spawns of unspecified type", "vehicle"),
}
ARCHIVE = "extra-archived-locations"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_points():
    if not INPUT.exists():
        previous = read_json(OUTPUT)
        return previous["points"], previous["total"] - len(previous["points"])

    points = []
    unmapped = 0
    with INPUT.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            if not row["x"] and not row["y"]:
                unmapped += 1
                continue
            links = {key: row[key + "_url"] for key in SOURCES if row[key + "_url"]}
            locality = row["locality_gtabase"] or row["region_leonida"]
            points.append([row["id"], row["name"], row["category"], float(row["x"]),
                           float(row["y"]), links, locality, row["coordinate_source"]])
    return points, unmapped


def make_taxonomy(spec):
    layers, groups, categories = [], [], {}
    for source in spec["groups"]:
        key = source["id"]
        layer = {field: source[field] for field in ("id", "label", "en")}
        layers.append({**layer, "icon": LAYER_ICONS[key]})
        groups.append({**layer, "layer": key, "categories": [c["id"] for c in source["categories"]]})
        for entry in source["categories"]:
            kind = entry["id"]
            icon = "cards" if kind.startswith("card-") else kind
            categories[kind] = {**entry, "icon": icon, "group": key, "layer": key}

    layers.append({"id": "extra", "label": "Дополнительно", "en": "Additional", "icon": "all"})
    extras = []
    for kind, (label, en, icon) in EXTRA_CATEGORIES.items():
        key = "extra-" + kind
        categories[key] = {"id": key, "label": label, "en": en, "icon": icon,
                           "group": "extra-sources", "layer": "extra"}
        extras.append(key)
    groups.append({"id": "extra-sources", "label": "Другие источники", "en": "Other sources",
                   "layer": "extra", "categories": extras})
    groups.append({"id": "extra-archive", "label": "Архив GTABase", "en": "GTABase archive",
                   "layer": "extra", "categories": [ARCHIVE], "archived": True})
    categories[ARCHIVE] = {"id": ARCHIVE, "label": "Архивные места", "en": "Archived locations",
                           "icon": "places", "group": "extra-archive", "layer": "extra", "archived": True}
    return layers, groups, categories


def classify_extra(kind, name):
    if kind.startswith("extra-"):
        return kind
    if kind == "cards":
        if name.casefold().startswith("los santos panic"):
            return "card-los-santos-panic"
        return "collectible-card"
    if kind in EXTRA_CATEGORIES:
        return "extra-" + kind
    return kind


def make_catalogue(points, unmapped, spec, delta):
    layers, groups, categories = make_taxonomy(spec)
    feature_types = {c["featureSlug"]: c["id"] for c in categories.values() if "featureSlug" in c}
    by_id = {row[0]: row for row in points}
    if len(by_id) != len(points):
        raise ValueError("Duplicate point IDs in the input catalogue")
    archived = {"gtabase:" + key for key in delta["retired"] + delta["reused"]}
    reused = set(delta["reused"])
    # A published anchor may be re-used for a different item at the same place.
    # Its historical local ID (and existing visited mark) stays attached to the old item.
    def local_id(source_id):
        return ("gtabase-current:" if source_id in reused else "gtabase:") + source_id

    for row in points:
        links = row[5]
        if row[7] not in links or any(urlsplit(url).scheme != "https" for url in links.values()):
            raise ValueError(f"Invalid point source for {row[0]}")
        if not all(math.isfinite(n) for n in row[3:5]):
            raise ValueError(f"Invalid coordinates for {row[0]}")
        if row[0] in archived:
            row[2] = ARCHIVE
        elif "gtabase" in links:
            # Stable marker IDs can keep old type prefixes. The feature link carries the type.
            feature = parse_qs(urlsplit(links["gtabase"]).query)["feature"][0]
            row[2] = feature_types[feature]
        else:
            row[2] = classify_extra(row[2], row[1])

    for source_id, kind, name, x, y in delta["updates"] + delta["additions"]:
        key = local_id(source_id)
        link = f'{spec["source"]}?feature={categories[kind]["featureSlug"]}#{source_id}'
        if key in by_id:
            row = by_id[key]
            row[1:5] = name, kind, x, y
            row[5]["gtabase"] = link
        else:
            by_id[key] = [key, name, kind, x, y, {"gtabase": link}, "", "gtabase"]

    points = list(by_id.values())
    for row in points:
        if row[2] not in categories:
            raise ValueError(f"Unknown category for {row[0]}: {row[2]}")
    for group in spec["multiSpawnGroups"]:
        ids = [local_id(key) for key in group]
        kind = by_id[ids[0]][2]
        if len(set(ids)) < 2 or any(by_id[key][2] != kind for key in ids):
            raise ValueError(f"Invalid alternative locations: {ids}")
        categories[kind].setdefault("units", []).append(ids)

    counts = Counter(row[2] for row in points if "gtabase" in row[5] and row[0] not in archived)
    for c in categories.values():
        if "sourceMarkers" not in c:
            continue
        alternatives = sum(len(unit) - 1 for unit in c.get("units", []))
        if counts[c["id"]] != c["sourceMarkers"] or counts[c["id"]] - alternatives != c["sourceCount"]:
            raise ValueError(f'Source count mismatch in {c["id"]}')
    xs = [row[3] for row in points]
    ys = [row[4] for row in points]
    return {"total": len(points) + unmapped, "bounds": [min(xs), min(ys), max(xs), max(ys)],
            "layers": layers, "groups": groups, "categories": list(categories.values()), "points": points}


if __name__ == "__main__":
    result = make_catalogue(*read_points(), read_json(SCRIPTS / "gtabase-taxonomy.json"),
                            read_json(SCRIPTS / "gtabase-updates.json"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                      encoding="utf-8")
    print(f'{len(result["points"])} mapped points; {len(result["categories"])} categories')
