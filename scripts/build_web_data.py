"""Build the public map's point catalogue from data/points.csv, without network access."""

import csv
import json
import math
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "data" / "points.csv"
OUTPUT = ROOT / "docs" / "assets" / "points.json"
LAYERS = {
    "Спорт, досуг и трюки": "sports",
    "События и задания": "events",
    "Коллекции и находки": "collections",
    "Ограбления и операции": "heists",
    "Транспорт и предметы": "transport",
    "Места и услуги": "places",
}
CATEGORIES = {
    "ahol-street-art": "Граффити Ahol",
    "airport": "Аэропорты и аэродромы",
    "ammu-nation": "Оружейные магазины",
    "arcade": "Игровые автоматы",
    "atm": "Банкоматы",
    "bank": "Банки",
    "bar": "Бары",
    "base-jump": "Бейсджампинг",
    "basketball": "Баскетбол",
    "book-swap": "Книжный обмен",
    "bus-stop": "Автобусные остановки",
    "cafe-takeout": "Кафе и еда навынос",
    "car-meet": "Автовстречи",
    "car-wash": "Автомойки",
    "cards": "Коллекционные карточки",
    "cinema": "Кинотеатры",
    "city-town": "Города и районы",
    "clothing": "Магазины одежды",
    "collectibles": "Другие коллекционные предметы",
    "convenience-store": "Магазины у дома",
    "counties": "Округа",
    "dining": "Рестораны",
    "drone-race": "Испытания с дронами",
    "easter-egg": "Пасхалки",
    "electronics": "Магазины электроники",
    "ev-charger": "Зарядные станции",
    "fence": "Скупщики",
    "ferry": "Паромные причалы",
    "fire-station": "Пожарные станции",
    "fishing": "Места рыбалки",
    "food-and-drink": "Еда и напитки",
    "footwear": "Обувные магазины",
    "gang-compound": "Базы банд",
    "gang-operation": "Нелегальные операции",
    "garage": "Гаражи",
    "gas-station": "Заправки",
    "golf": "Гольф",
    "gym": "Спортзалы",
    "haircut": "Салоны красоты",
    "helipad": "Вертолётные площадки",
    "hidden-package": "Тайники",
    "hospital": "Больницы",
    "hunting": "Места охоты",
    "islands": "Острова",
    "knife-flight": "Полёты на боку",
    "landmark": "Ориентиры",
    "liquor-store": "Магазины алкоголя",
    "luxury-watch": "Дорогие часы",
    "marina": "Марины",
    "meditation": "Места для медитации",
    "message-bottle": "Послания в бутылках",
    "meteorite": "Осколки метеоритов",
    "mini-golf": "Мини-гольф",
    "mural": "Муралы",
    "nature": "Природные находки",
    "nightclub": "Ночные клубы",
    "parachuting": "Парашюты",
    "pay-n-spray": "Покраска транспорта",
    "payday-loan": "Займы до зарплаты",
    "places": "Прочие места",
    "playlist": "Плейлисты",
    "police-station": "Полицейские участки",
    "pool": "Бильярд",
    "public-transport": "Общественный транспорт",
    "publications": "Печатные издания",
    "race": "Гонки",
    "random-event": "Случайные события",
    "robbery-store": "Магазины для ограбления",
    "safe": "Сейфы",
    "safehouse": "Убежища",
    "scoop-container": "Контейнеры SCOOP",
    "shooting-range": "Тиры",
    "smash-n-grab": "Ограбления витрин",
    "stranger-missions": "Миссии незнакомцев",
    "street-food": "Уличная еда",
    "stunt-jump": "Каскадёрские прыжки",
    "tattoo": "Тату-салоны",
    "towable-atm": "Буксируемые банкоматы",
    "treasure": "Сокровища",
    "under-the-bridge": "Пролёты под мостами",
    "unique-weapon": "Уникальное оружие",
    "vehicle": "Места появления транспорта",
    "vehicle-mod-shop": "Тюнинг транспорта",
    "vehicle-rental": "Прокат транспорта",
    "vehicle-request": "Заказы на транспорт",
    "vehicles": "Прочий транспорт",
    "waink": "Сканирования WAiNK",
    "weapon-spawn": "Места появления оружия",
    "yellow-loot-box": "Жёлтые ящики с добычей",
}
SOURCES = ("gtabase", "leonida", "tracker", "ign")


def make_catalogue():
    points = []
    seen = set()
    category_layers = {}
    total = 0
    with INPUT.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            total += 1
            if not row["x"] and not row["y"]:
                continue
            x, y = float(row["x"]), float(row["y"])
            point_id = row["id"]
            if not math.isfinite(x) or not math.isfinite(y) or point_id in seen:
                raise ValueError(f"Invalid coordinates or duplicate point ID: {point_id}")
            seen.add(point_id)
            category = row["category"]
            layer = LAYERS[row["layer"]]
            if category_layers.setdefault(category, layer) != layer:
                raise ValueError(f"Category belongs to multiple layers: {category}")
            links = {key: row[key + "_url"] for key in SOURCES if row[key + "_url"]}
            if row["coordinate_source"] not in links:
                raise ValueError(f"Missing coordinate source for {point_id}")
            if any(urlsplit(url).scheme != "https" for url in links.values()):
                raise ValueError(f"Non-HTTPS source URL for {point_id}")
            locality = row["locality_gtabase"] or row["region_leonida"]
            points.append([point_id, row["name"], category, x, y, links, locality, row["coordinate_source"]])

    xs = [point[3] for point in points]
    ys = [point[4] for point in points]
    return {
        "total": total,
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "layers": [{"id": key, "label": label} for label, key in LAYERS.items()],
        "categories": [
            {"id": key, "label": CATEGORIES[key], "layer": category_layers[key]}
            for key in sorted(category_layers, key=CATEGORIES.__getitem__)
        ],
        "points": points,
    }


if __name__ == "__main__":
    data = make_catalogue()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"{len(data['points'])} geolocated points in {len(data['categories'])} categories")
