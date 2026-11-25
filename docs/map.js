"use strict";

const $ = (id) => document.getElementById(id);
const format = new Intl.NumberFormat("ru-RU");
const mobile = matchMedia("(max-width: 780px)");
const palette = {
  properties: "#f5cb9f", robberies: "#f45fa8", activities: "#ff8869",
  collectibles: "#ffda88", "collectible-cards": "#cea5fa", vehicles: "#81c6ff",
  weapons: "#a8b7e7", style: "#fab4d3", "food-drink": "#ffb388", "local-places": "#67ddd1",
};
const sourceNames = { gtabase: "GTABase", tracker: "Tracker.gg", leonida: "Leonida Verse", ign: "IGN" };
const atlas = { left: -10400, right: 3800, bottom: -9500, top: 10400 };
const canvas = $("map");
const ctx = canvas.getContext("2d");
const base = new Image();
let labels = [];
let points = [];
let filtered = [];
let groupedResults = null;
let layers = [];
let categories = new Map();
let groups = [];
let sections = [];
let catalogMode = "map";
let activeGroup = "";
let activeCategory = "";
let searchTerms = [];
let categoryPoints = new Map();
const goalsByPoint = new Map();
let goalsDone = new Set();
const goalsKey = "leonida-atlas.goals.v1";
let selected = null;
let visited = new Set();
const foundTargets = new Set();
let storageWorks = true;
let listLimit = 24;
let loaded = false;
let frame = 0;
let markers = [];
let screenWidth = 0;
let screenHeight = 0;
let ratio = 1;
let camera = null;
let minimumScale = 0.01;
let maximumScale = 4;
const storeKey = "leonida-atlas.visited.v1";
try {
  const saved = JSON.parse(localStorage.getItem(storeKey) || "[]");
  if (Array.isArray(saved)) visited = new Set(saved.filter((id) => typeof id === "string"));
  const savedGoals = JSON.parse(localStorage.getItem(goalsKey) || "[]");
  if (Array.isArray(savedGoals)) goalsDone = new Set(savedGoals.filter((id) => typeof id === "string"));
} catch {
  storageWorks = false;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function iconBadge(id, layer) {
  const node = el("span", null, "category-icon");
  node.setAttribute("aria-hidden", "true");
  node.style.setProperty("--icon-tint", palette[layer] || "#ecd7e5");
  node.append(MapIcons.svg(id, 19));
  return node;
}
function categoryBadge(category) {
  return iconBadge(category.icon, category.layer);
}
function normalize(value) {
  return value.toLocaleLowerCase("ru").normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function wordEnding(n, forms) {
  const tens = n % 100, units = n % 10;
  return forms[(tens < 11 || tens > 14) && units === 1 ? 0 : (tens < 11 || tens > 14) && units >= 2 && units <= 4 ? 1 : 2];
}
function mapStatus(message) {
  $("map-status").textContent = message;
  $("map-status").hidden = !message;
}
function updateStatus() {
  if (!loaded) return;
  if (!filtered.length) mapStatus("По этим фильтрам ничего не найдено.");
  else if (base.complete && !base.naturalWidth) mapStatus("Подложку загрузить не удалось. Метки доступны.");
  else mapStatus("");
}
function setPanel(open) {
  const show = mobile.matches && open;
  $("catalog").classList.toggle("open", show);
  $("panel-toggle").setAttribute("aria-expanded", String(show));
  $("scrim").hidden = !show;
}
function openResults() {
  $("catalog").classList.add("searching");
  setPanel(true);
  $("catalog").scrollTop = 0;
}
function clearDetail() {
  selected = null;
  $("detail").hidden = true;
  requestDraw();
}
function applyFilters() {
  if (!loaded) return;
  searchTerms = normalize($("search").value).split(" ").filter(Boolean);
  const visible = catalogPredicate();
  filtered = points.filter(visible);
  groupedResults = null;
  listLimit = 24;
  if (selected && !filtered.includes(selected)) clearDetail();
  $("reset").hidden = !activeGroup && !activeCategory && !$("hide-visited").checked &&
    !(catalogMode === "map" && $("gtabase-only").checked) && !$("search").value;
  $("top-count").textContent = format.format(filtered.length) + " " + wordEnding(filtered.length, ["точка", "точки", "точек"]);
  renderResults();
  updateStatus();
  requestDraw();
}
function renderResults() {
  const rows = groupedResults || filtered;
  $("result-heading").textContent = groupedResults ? "Места в этой группе" : "Список мест";
  $("clear-group").hidden = !groupedResults;
  $("result-count").textContent = format.format(rows.length);
  const list = document.createDocumentFragment();
  if (!rows.length) list.append(el("p", "Попробуйте другое название или сбросьте фильтры.", "empty"));
  for (const p of rows.slice(0, listLimit)) {
    const button = el("button", null, "result");
    button.type = "button";
    button.setAttribute("aria-current", String(p === selected));
    const description = p.locality ? p.category.label + " · " + p.locality : p.category.label;
    button.append(categoryBadge(p.category), el("strong", p.name), el("small", description));
    if (checkedOnMap(p)) {
      const check = el("span", "✓", "done");
      check.setAttribute("aria-label", catalogMode === "map" ? "Посещено" : "Выполнено");
      button.append(check);
    }
    button.addEventListener("click", () => openPoint(p, true));
    list.append(button);
  }
  $("result-list").replaceChildren(list);
  $("load-more").hidden = listLimit >= rows.length;
}
function buildDetail() {
  if (!selected) return;
  $("detail-category").textContent = selected.category.groupLabel + " › " + selected.category.label;
  $("detail-icon").replaceChildren(categoryBadge(selected.category));
  $("detail-name").textContent = selected.name;
  $("detail-area").textContent = selected.locality;
  $("detail-area").hidden = !selected.locality;
  const links = [];
  for (const [key, url] of Object.entries(selected.sources)) {
    if (!sourceNames[key] || !url.startsWith("https://")) continue;
    const historical = selected.category.archived && key === "gtabase";
    const a = el("a", (historical ? "Карта GTABase" : sourceNames[key]) + " ↗");
    a.href = historical ? "https://www.gtabase.com/gta-6/map/" : url;
    a.target = "_blank";
    a.rel = "noopener";
    links.push(a);
  }
  $("detail-sources").replaceChildren(...links);
  const seen = foundTargets.has(selected.category.sharedTarget.get(selected.id) || selected.id);
  const alternative = selected.category.sharedTarget.has(selected.id);
  $("visit").setAttribute("aria-pressed", String(seen));
  $("visit").querySelector("span").textContent = alternative
    ? (seen ? "Найдено · снять отметку" : "Отметить предмет найденным")
    : (seen ? "Посещено · снять отметку" : "Отметить посещённым");
  $("save-notice").hidden = storageWorks;
  $("visit").hidden = catalogMode !== "map";
  buildGoalActions(selected);
  $("detail").hidden = false;
}
function openPoint(p, center) {
  selected = p;
  setPanel(false);
  buildDetail();
  if (center) {
    camera.scale = Math.max(camera.scale, Math.min(maximumScale, minimumScale * 24));
    camera.x = p.x;
    camera.y = p.y - (mobile.matches ? screenHeight * .14 / camera.scale : 0);
  }
  renderResults();
  requestDraw();
  $("detail-name").focus({ preventScroll: true });
}
function toggleVisited() {
  if (!selected) return;
  const id = selected.id;
  const target = selected.category.sharedTarget.get(id) || id;
  if (foundTargets.has(target)) {
    const alternatives = selected.category.units?.find(ids => ids[0] === target) || [id];
    for (const member of alternatives) visited.delete(member);
    foundTargets.delete(target);
  } else {
    visited.add(id);
    foundTargets.add(target);
  }
  try {
    localStorage.setItem(storeKey, JSON.stringify([...visited]));
    storageWorks = true;
  } catch { storageWorks = false; }
  buildDetail();
  renderCatalog();
  applyFilters();
}
function visibleBounds(rows) {
  if (!rows.length) return [atlas.left, atlas.bottom, atlas.right, atlas.top];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of rows) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return [x0, y0, x1, y1];
}
function fit(rows) {
  const [x0, y0, x1, y1] = visibleBounds(rows);
  const scale = Math.min(screenWidth * .87 / Math.max(300, x1 - x0), screenHeight * .89 / Math.max(300, y1 - y0));
  camera = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: Math.max(minimumScale, Math.min(maximumScale, scale)) };
  requestDraw();
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  screenWidth = rect.width;
  screenHeight = rect.height;
  ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(screenWidth * ratio);
  canvas.height = Math.round(screenHeight * ratio);
  minimumScale = .68 * Math.min(screenWidth / (atlas.right - atlas.left), screenHeight / (atlas.top - atlas.bottom));
  maximumScale = Math.max(2, minimumScale * 160);
  if (!camera) fit(points);
  else { camera.scale = Math.max(minimumScale, Math.min(maximumScale, camera.scale)); requestDraw(); }
}
function sx(x) { return (x - camera.x) * camera.scale + screenWidth / 2; }
function sy(y) { return (camera.y - y) * camera.scale + screenHeight / 2; }
function worldAt(x, y) {
  return { x: camera.x + (x - screenWidth / 2) / camera.scale, y: camera.y - (y - screenHeight / 2) / camera.scale };
}
function limitPan() {
  camera.x = Math.max(atlas.left, Math.min(atlas.right, camera.x));
  camera.y = Math.max(atlas.bottom, Math.min(atlas.top, camera.y));
}
function zoomAt(factor, x = screenWidth / 2, y = screenHeight / 2) {
  if (!camera) return;
  const before = worldAt(x, y);
  camera.scale = Math.max(minimumScale, Math.min(maximumScale, camera.scale * factor));
  const after = worldAt(x, y);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  limitPan();
  requestDraw();
}
function drawBase() {
  if (!base.complete || !base.naturalWidth) return;
  const tl = worldAt(0, 0), br = worldAt(screenWidth, screenHeight);
  const left = Math.max(atlas.left, tl.x), right = Math.min(atlas.right, br.x);
  const top = Math.min(atlas.top, tl.y), bottom = Math.max(atlas.bottom, br.y);
  if (left >= right || bottom >= top) return;
  const fx = base.naturalWidth / (atlas.right - atlas.left);
  const fy = base.naturalHeight / (atlas.top - atlas.bottom);
  ctx.drawImage(base, (left - atlas.left) * fx, (atlas.top - top) * fy,
    (right - left) * fx, (top - bottom) * fy,
    sx(left), sy(top), (right - left) * camera.scale, (top - bottom) * camera.scale);
}
function drawLabels() {
  const boxes = [];
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  for (const label of labels) {
    const anchorX = sx(label.x), anchorY = sy(label.y);
    if (anchorX < 0 || anchorX > screenWidth || anchorY < 4 || anchorY > screenHeight - 4) continue;
    const region = label.kind === "region";
    ctx.font = (region ? "700 12px" : "600 12px") + " 'Segoe UI', sans-serif";
    const name = region ? label.name.toLocaleUpperCase("en") : label.name;
    const half = ctx.measureText(name).width / 2 + 6;
    const candidates = [[0, 0], [0, -22], [0, 22], [half + 14, -10], [-half - 14, -10], [0, -38], [0, 38]];
    for (const [dx, dy] of candidates) {
      const y = anchorY + dy, x = anchorX + dx;
      const box = [x - half, y - 8, x + half, y + 8];
      if (box[0] < 0 || box[2] > screenWidth || box[1] < 0 || box[3] > screenHeight) continue;
      if (boxes.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      if (markers.some((m) => m.x - m.halfWidth < box[2] && m.x + m.halfWidth > box[0] && m.y - m.r < box[3] && m.y + m.r > box[1])) continue;
      boxes.push(box);
      ctx.strokeStyle = "#30213f"; ctx.strokeText(name, x, y);
      ctx.fillStyle = region ? "#ffdaaf" : "#fff4e9"; ctx.fillText(name, x, y);
      break;
    }
  }
}
function groupMarkers() {
  // Use world-space cells so panning doesn't move a point between groups.
  const cell = camera.scale < .075 ? 105 : camera.scale < .15 ? 70 : camera.scale < .6 ? 52 : 44;
  const bins = new Map();
  for (const p of filtered) {
    if (p === selected) continue;
    const x = sx(p.x), y = sy(p.y);
    if (x < -cell || y < -cell || x > screenWidth + cell || y > screenHeight + cell) continue;
    const key = Math.floor((p.x - atlas.left) * camera.scale / cell) + "," + Math.floor((atlas.top - p.y) * camera.scale / cell);
    let group = bins.get(key);
    if (!group) { group = { x: 0, y: 0, points: [] }; bins.set(key, group); }
    group.x += x; group.y += y; group.points.push(p);
  }
  // Two points can straddle a cell edge yet share almost the same screen position.
  // Combine overlapping neighbours so their badges and touch targets remain usable.
  const occupied = new Map();
  const groups = new Set();
  const originX = sx(atlas.left), originY = sy(atlas.top);
  for (const group of bins.values()) {
    group.x /= group.points.length; group.y /= group.points.length;
    for (;;) {
      measureBadge(group);
      const col = Math.floor((group.x - originX) / 96), row = Math.floor((group.y - originY) / 96);
      let neighbour;
      for (let i = col - 1; i <= col + 1 && !neighbour; i++) {
        for (let j = row - 1; j <= row + 1 && !neighbour; j++) {
          neighbour = occupied.get(i + "," + j)?.find((other) =>
            Math.abs(other.x - group.x) < other.halfWidth + group.halfWidth + 4 &&
            Math.abs(other.y - group.y) < other.r + group.r + 4);
        }
      }
      if (!neighbour) {
        group.cell = col + "," + row;
        if (!occupied.has(group.cell)) occupied.set(group.cell, []);
        occupied.get(group.cell).push(group);
        groups.add(group);
        break;
      }
      // The centroid, glyph count and text width can all change on a merge.
      // Remove the old footprint and check the combined badge again before insertion.
      const bucket = occupied.get(neighbour.cell);
      bucket.splice(bucket.indexOf(neighbour), 1);
      groups.delete(neighbour);
      const share = neighbour.points.length / (group.points.length + neighbour.points.length);
      group.x += (neighbour.x - group.x) * share;
      group.y += (neighbour.y - group.y) * share;
      group.points.push(...neighbour.points);
    }
  }
  if (selected) {
    const x = sx(selected.x), y = sy(selected.y);
    if (x >= -24 && y >= -24 && x <= screenWidth + 24 && y <= screenHeight + 24) {
      const pin = { x, y, points: [selected] };
      measureBadge(pin); groups.add(pin);
    }
  }
  return [...groups];
}
function drawPointBadge(group) {
  const point = group.points[0];
  const current = point === selected;
  const radius = current ? 16 : 14;
  const {x, y} = group;
  const ink = "#281735";
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  if (current) {
    ctx.strokeStyle = "#fff4e9"; ctx.lineWidth = 7; ctx.stroke();
  }
  ctx.fillStyle = palette[point.category.layer] || "#ecd7e5"; ctx.fill();
  ctx.strokeStyle = "#30203c"; ctx.lineWidth = 2; ctx.stroke();
  MapIcons.draw(ctx, point.category.icon, x, y, current ? 22 : 20, ink);
  if (checkedOnMap(point)) {
    const bx = x + radius * .72, by = y + radius * .72;
    ctx.beginPath(); ctx.arc(bx, by, 5.4, 0, 2 * Math.PI);
    ctx.fillStyle = "#391f46"; ctx.fill();
    ctx.lineWidth = 1.1; ctx.strokeStyle = "#fff4e9"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx - 2.8, by); ctx.lineTo(bx - .7, by + 2); ctx.lineTo(bx + 2.8, by - 2);
    ctx.strokeStyle = "#8af5dc"; ctx.lineWidth = 1.55; ctx.stroke();
  }
}
function measureBadge(group) {
  const members = group.points;
  if (members.length === 1) {
    group.r = group.halfWidth = members[0] === selected ? 20 : 16;
    return;
  }
  const {id, layer} = members[0].category;
  const other = members.find((p) => p.category.id !== id);
  const sameLayer = !other || members.every((p) => p.category.layer === layer);
  const pair = other && (members.length <= 5 || camera.scale >= .15) &&
    members.every((p) => p.category.id === id || p.category.id === other.category.id);
  group.icon = !other || pair ? members[0].category.icon : sameLayer ? members[0].category.layerIcon : "all";
  group.color = (sameLayer && palette[layer]) || "#e0b5d3";
  group.secondCategory = pair ? other.category : null;
  group.digitsWidth = ctx.measureText(String(members.length)).width;
  group.halfWidth = ((pair ? 42 : 26) + group.digitsWidth + 7) / 2;
  group.r = 12;
}
function drawClusterBadge(group) {
  const {x, y, icon, color, secondCategory} = group;
  const w = group.halfWidth * 2;
  const left = x - group.halfWidth;
  ctx.beginPath();
  ctx.arc(left + w - group.r, y, group.r, -Math.PI / 2, Math.PI / 2);
  ctx.arc(left + group.r, y, group.r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
  ctx.fillStyle = "#311e42"; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.stroke();
  if (secondCategory) {
    MapIcons.draw(ctx, icon, left + 14, y, 15, palette[group.points[0].category.layer] || "#ecd7e5");
    MapIcons.draw(ctx, secondCategory.icon, left + 30, y, 15, palette[secondCategory.layer] || "#ecd7e5");
  } else {
    MapIcons.draw(ctx, icon, left + 14.5, y, 15, color);
  }
  ctx.fillStyle = "#fff4e9";
  ctx.fillText(String(group.points.length), left + w - 7 - group.digitsWidth / 2, y + .5);
}
function drawMarkers() {
  ctx.font = "700 12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  markers = groupMarkers();
  for (const group of markers) {
    if (group.points.length === 1) drawPointBadge(group);
    else drawClusterBadge(group);
  }
}
function draw() {
  frame = 0;
  if (!camera || !ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#252043"; ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawBase(); drawMarkers(); drawLabels();
  $("zoom-in").disabled = camera.scale >= maximumScale * .999;
  $("zoom-out").disabled = camera.scale <= minimumScale * 1.001;
}
function requestDraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function markerAt(x, y, touch) {
  let hit = null, nearest = Infinity;
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    const dx = Math.abs(m.x - x), dy = Math.abs(m.y - y);
    const radius = Math.max(touch ? 22 : 0, m.r + 2);
    const capsuleDx = Math.max(0, dx - (m.halfWidth - m.r));
    if (capsuleDx * capsuleDx + dy * dy > radius * radius) continue;
    if (m.points.length === 1 && m.points[0] === selected && dx * dx + dy * dy < m.r * m.r) return m;
    const distance = dx * dx + dy * dy;
    if (distance < nearest) { hit = m; nearest = distance; }
  }
  return hit;
}
function selectAt(x, y, touch = mobile.matches || matchMedia("(pointer: coarse)").matches) {
  const hit = markerAt(x, y, touch);
  if (!hit) { clearDetail(); renderResults(); return; }
  if (hit.points.length === 1) { openPoint(hit.points[0], false); return; }
  const [x0,y0,x1,y1] = visibleBounds(hit.points);
  if (camera.scale >= maximumScale * .97 || Math.max(x1-x0,y1-y0) * maximumScale < 25) {
    clearDetail();
    groupedResults = hit.points;
    listLimit = 24;
    renderResults();
    openResults();
    if (!mobile.matches) $("result-heading").scrollIntoView({ block: "nearest" });
    return;
  }
  clearDetail();
  const center = worldAt(hit.x, hit.y);
  camera.x = center.x; camera.y = center.y;
  zoomAt(2.4);
}
const pointers = new Map();
let startPointer = null;
let drag = false;
function gesture() {
  const pair = [...pointers.values()];
  if (pair.length < 2) return { ...pair[0], distance: 0 };
  return { x: (pair[0].x + pair[1].x)/2, y: (pair[0].y + pair[1].y)/2, distance: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) };
}
function local(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
function hoverText(marker) {
  if (!marker) return "";
  const rows = marker.points;
  if (rows.length === 1) return rows[0].category.label + " · " + rows[0].name;
  if (!marker.summary) {
    const totals = new Map();
    for (const point of rows) totals.set(point.category.label, (totals.get(point.category.label) || 0) + 1);
    const kinds = [...totals].sort((a, b) => b[1] - a[1]);
    const names = kinds.slice(0, 3).map(([name, count]) => name + " (" + count + ")");
    if (kinds.length > 3) names.push("…");
    marker.summary = format.format(rows.length) + " " + wordEnding(rows.length, ["точка", "точки", "точек"]) + " · " + names.join(", ");
  }
  return marker.summary;
}
canvas.addEventListener("pointerleave", () => { canvas.title = ""; canvas.style.cursor = ""; });
canvas.addEventListener("pointerdown", (event) => {
  if (!camera || event.button !== 0) return;
  canvas.title = ""; canvas.style.cursor = "";
  const position = local(event);
  if (!pointers.size) { startPointer = position; drag = false; }
  else drag = true;
  pointers.set(event.pointerId, position);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) {
    if (event.pointerType === "mouse" && !event.buttons) {
      const position = local(event);
      const hit = markerAt(position.x, position.y, false);
      const title = hoverText(hit);
      if (canvas.title !== title) canvas.title = title;
      canvas.style.cursor = hit ? "pointer" : "";
    }
    return;
  }
  const prev = gesture(), point = local(event);
  pointers.set(event.pointerId, point);
  const next = gesture();
  if (Math.hypot(point.x - startPointer.x, point.y - startPointer.y) > 4) drag = true;
  if (!drag) return;
  canvas.classList.add("dragging");
  camera.x -= (next.x - prev.x) / camera.scale;
  camera.y += (next.y - prev.y) / camera.scale;
  if (prev.distance > 2 && next.distance > 2) zoomAt(next.distance / prev.distance, next.x, next.y);
  limitPan(); requestDraw();
});
function pointerEnd(event) {
  if (!pointers.has(event.pointerId)) return;
  const wasTap = event.type === "pointerup" && pointers.size === 1 && !drag;
  pointers.delete(event.pointerId);
  if (!pointers.size) canvas.classList.remove("dragging");
  if (wasTap) { const p = local(event); selectAt(p.x, p.y, event.pointerType !== "mouse"); }
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("lostpointercapture", pointerEnd);
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const p = local(event);
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? screenHeight : 1);
  zoomAt(Math.exp(Math.max(-1, Math.min(1, -delta * .0025))), p.x, p.y);
}, { passive: false });
canvas.addEventListener("keydown", (event) => {
  if (!camera) return;
  const delta = 72 / camera.scale;
  switch (event.key) {
    case "ArrowLeft": camera.x -= delta; break;
    case "ArrowRight": camera.x += delta; break;
    case "ArrowUp": camera.y += delta; break;
    case "ArrowDown": camera.y -= delta; break;
    case "+": case "=": zoomAt(1.6); break;
    case "-": zoomAt(1 / 1.6); break;
    case "Home": fit(filtered); break;
    default: return;
  }
  event.preventDefault(); limitPan(); requestDraw();
});
$("panel-toggle").addEventListener("click", () => {
  const opening = !$("catalog").classList.contains("open");
  if (opening) { $("catalog").classList.remove("searching"); $("catalog").scrollTop = 0; }
  setPanel(opening);
});
$("scrim").addEventListener("click", () => setPanel(false));
$("search").addEventListener("input", () => {
  applyFilters();
  if ($("search").value.trim()) openResults();
  else $("catalog").classList.remove("searching");
});
$("search").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && filtered.length) {
    if (filtered.length === 1) openPoint(filtered[0], true);
    else { openResults(); $("result-list").querySelector("button")?.focus(); }
  }
});
$("mode-map").addEventListener("click", () => switchCatalog("map"));
$("mode-completion").addEventListener("click", () => switchCatalog("completion"));
$("gtabase-only").addEventListener("change", () => {
  if (groups.find(g => g.id === activeGroup)?.layer === "extra") activeGroup = activeCategory = "";
  renderCatalog();
  applyFilters();
});
$("hide-visited").addEventListener("change", applyFilters);
$("reset").addEventListener("click", () => {
  activeGroup = activeCategory = ""; $("search").value = ""; $("hide-visited").checked = false;
  if (catalogMode === "map") $("gtabase-only").checked = false;
  $("catalog").classList.remove("searching");
  renderCatalog(); applyFilters();
});
$("zoom-in").addEventListener("click", () => zoomAt(1.7));
$("zoom-out").addEventListener("click", () => zoomAt(1 / 1.7));
$("fit").addEventListener("click", () => fit(filtered));
$("clear-group").addEventListener("click", () => { groupedResults = null; listLimit = 24; renderResults(); });
$("load-more").addEventListener("click", () => { listLimit += 40; renderResults(); });
$("detail-close").addEventListener("click", () => { clearDetail(); renderResults(); canvas.focus(); });
$("visit").addEventListener("click", toggleVisited);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("catalog").classList.contains("open")) { setPanel(false); $("panel-toggle").focus(); }
  else if (selected) { clearDetail(); renderResults(); canvas.focus(); }
});
mobile.addEventListener("change", () => setPanel(false));
base.onload = () => { updateStatus(); requestDraw(); };
base.onerror = updateStatus;
base.src = "./assets/basemap.svg?v=3";
const observer = new ResizeObserver(resize);
observer.observe($("map-area"));
fetch("./assets/basemap-labels.json").then((res) => res.ok ? res.json() : []).then((rows) => {
  if (Array.isArray(rows)) { labels = rows; requestDraw(); }
}).catch(() => {});
async function init() {
  try {
    const response = await fetch("./assets/points.json?v=4");
    if (!response.ok) throw Error("points");
    const data = await response.json();
    layers = data.layers;
    groups = data.groups;
    const layerIndex = new Map(layers.map(layer => [layer.id, layer]));
    const groupLabels = new Map(groups.map(group => [group.id, group.label]));
    categories = new Map(data.categories.map(c => {
      c.layerIcon = layerIndex.get(c.layer).icon;
      c.groupLabel = groupLabels.get(c.group);
      c.sharedTarget = new Map();
      for (const unit of c.units || []) {
        for (const id of unit) c.sharedTarget.set(id, unit[0]);
      }
      return [c.id, c];
    }));
    points = data.points.map(([id, name, categoryId, x, y, sources, locality]) => {
      const category = categories.get(categoryId);
      const layer = layerIndex.get(category.layer);
      const searchText = normalize([name, locality, category.label, category.en, categoryId, layer.label, layer.en].join(" "));
      const point = { id, name, category, x, y, sources, locality, searchText };
      if (visited.has(id)) foundTargets.add(category.sharedTarget.get(id) || id);
      if (!categoryPoints.has(categoryId)) categoryPoints.set(categoryId, []);
      categoryPoints.get(categoryId).push(point);
      return point;
    });
    loaded = true;
    const query = new URLSearchParams(location.search);
    const section = groups.find(group => group.id === query.get("section"));
    if (section) activeGroup = section.id;
    $("gtabase-only").checked = query.get("source") === "gtabase" && section?.layer !== "extra";
    renderCatalog(); resize(); applyFilters(); fit(filtered);
    if (query.get("view") === "completion") {
      await switchCatalog("completion");
      setPanel(true);
    } else if (section) {
      setPanel(true);
    }
  } catch {
    $("top-count").textContent = "Ошибка загрузки";
    mapStatus("Не удалось загрузить точки.");
    const retry = el("button", "Повторить");
    retry.type = "button"; retry.addEventListener("click", () => location.reload()); $("map-status").append(retry);
  }
}
init();
