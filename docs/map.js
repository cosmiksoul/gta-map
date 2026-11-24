"use strict";

const $ = (id) => document.getElementById(id);
const format = new Intl.NumberFormat("ru-RU");
const mobile = matchMedia("(max-width: 780px)");
const palette = {
  sports: "#ff9b73", events: "#ffd168", collections: "#e8a5e7",
  heists: "#ff858d", transport: "#80c7f4", places: "#86d6b9",
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
let activeLayer = "";
let selected = null;
let visited = new Set();
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
} catch {
  storageWorks = false;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function dot(color) {
  const node = el("span", null, "dot");
  node.style.setProperty("--dot-color", color);
  return node;
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
function buildLayers() {
  const counts = new Map();
  for (const p of points) counts.set(p.category.layer, (counts.get(p.category.layer) || 0) + 1);
  const buttons = [{ id: "", label: "Все слои" }, ...layers].map(({ id, label }) => {
    const button = el("button", null, "layer");
    button.type = "button";
    button.dataset.layer = id;
    button.append(dot(palette[id] || "#516864"), el("span", label), el("span", format.format(id ? counts.get(id) || 0 : points.length), "layer-count"));
    button.addEventListener("click", () => {
      activeLayer = id;
      buildCategories();
      applyFilters();
    });
    return button;
  });
  $("layers").replaceChildren(...buttons);
}
function buildCategories() {
  const select = $("category");
  select.replaceChildren(new Option("Все категории", ""));
  for (const category of categories.values()) {
    if (!activeLayer || category.layer === activeLayer) select.add(new Option(category.label, category.id));
  }
}
function applyFilters() {
  if (!loaded) return;
  const terms = normalize($("search").value).split(" ").filter(Boolean);
  const category = $("category").value;
  const hideVisited = $("hide-visited").checked;
  filtered = points.filter((p) =>
    (!activeLayer || p.category.layer === activeLayer) &&
    (!category || p.category.id === category) &&
    (!hideVisited || !visited.has(p.id)) &&
    terms.every((term) => p.searchText.includes(term)));
  groupedResults = null;
  listLimit = 24;
  if (selected && !filtered.includes(selected)) clearDetail();
  $("reset").hidden = !activeLayer && !category && !hideVisited && !$("search").value;
  for (const button of $("layers").children) {
    button.setAttribute("aria-pressed", String(button.dataset.layer === activeLayer));
  }
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
    button.append(dot(palette[p.category.layer]), el("strong", p.name), el("small", p.locality || p.category.label));
    if (visited.has(p.id)) {
      const check = el("span", "✓", "done");
      check.setAttribute("aria-label", "Посещено");
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
  $("detail-category").textContent = selected.category.label;
  $("detail-dot").style.setProperty("--dot-color", palette[selected.category.layer]);
  $("detail-name").textContent = selected.name;
  $("detail-area").textContent = selected.locality;
  $("detail-area").hidden = !selected.locality;
  const links = [];
  for (const [key, url] of Object.entries(selected.sources)) {
    if (!sourceNames[key] || !url.startsWith("https://")) continue;
    const a = el("a", sourceNames[key] + " ↗");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    links.push(a);
  }
  $("detail-sources").replaceChildren(...links);
  const seen = visited.has(selected.id);
  $("visit").setAttribute("aria-pressed", String(seen));
  $("visit").querySelector("span").textContent = seen ? "Посещено · снять отметку" : "Отметить посещённым";
  $("save-notice").hidden = storageWorks;
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
  if (visited.has(id)) visited.delete(id); else visited.add(id);
  try {
    localStorage.setItem(storeKey, JSON.stringify([...visited]));
    storageWorks = true;
  } catch { storageWorks = false; }
  buildDetail();
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
      if (markers.some((m) => m.x - m.r < box[2] && m.x + m.r > box[0] && m.y - m.r < box[3] && m.y + m.r > box[1])) continue;
      boxes.push(box);
      ctx.strokeStyle = "#223731"; ctx.strokeText(name, x, y);
      ctx.fillStyle = region ? "#d6e2ce" : "#f1f2dc"; ctx.fillText(name, x, y);
      break;
    }
  }
}
function drawMarkers() {
  // The bins are anchored in world space so clusters do not jump when the user pans.
  const cell = camera.scale < .075 ? 105 : camera.scale < .15 ? 65 : camera.scale < .6 ? 38 : 22;
  const bins = new Map();
  for (const p of filtered) {
    const x = sx(p.x), y = sy(p.y);
    if (x < -cell || y < -cell || x > screenWidth + cell || y > screenHeight + cell) continue;
    const key = Math.floor((p.x - atlas.left) * camera.scale / cell) + "," + Math.floor((atlas.top - p.y) * camera.scale / cell);
    let group = bins.get(key);
    if (!group) { group = { x: 0, y: 0, points: [] }; bins.set(key, group); }
    group.x += x; group.y += y; group.points.push(p);
  }
  markers = [...bins.values()];
  const singleLayer = Boolean(activeLayer || $("category").value);
  ctx.font = "700 11px 'Segoe UI', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const group of markers) {
    const size = group.points.length;
    group.x /= size; group.y /= size;
    const single = size === 1;
    const point = group.points[0];
    const color = palette[point.category.layer] || "#c3d8c9";
    const fill = single ? color : "#223d40";
    group.r = single ? 5.5 : size > 99 ? 16 : size > 9 ? 13.5 : 11;
    ctx.beginPath(); ctx.arc(group.x, group.y, group.r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = single ? 1.6 : 1.5;
    ctx.strokeStyle = single ? "#173135" : (singleLayer ? color : "#a3c6ae"); ctx.stroke();
    if (!single) { ctx.fillStyle = "#f9fff2"; ctx.fillText(String(size), group.x, group.y + .5); }
    else if (visited.has(point.id)) {
      ctx.beginPath(); ctx.moveTo(group.x - 3, group.y); ctx.lineTo(group.x - 1, group.y + 2); ctx.lineTo(group.x + 3, group.y - 2);
      ctx.lineWidth = 1.7; ctx.strokeStyle = "#183934"; ctx.stroke();
    }
  }
  if (selected) {
    const x = sx(selected.x), y = sy(selected.y);
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.strokeStyle = "#132d34"; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = "#fffce0"; ctx.lineWidth = 2; ctx.stroke();
  }
}
function draw() {
  frame = 0;
  if (!camera || !ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#102b35"; ctx.fillRect(0, 0, screenWidth, screenHeight);
  drawBase(); drawMarkers(); drawLabels();
  $("zoom-in").disabled = camera.scale >= maximumScale * .999;
  $("zoom-out").disabled = camera.scale <= minimumScale * 1.001;
}
function requestDraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}
function selectAt(x, y) {
  let hit = null, distance = Infinity;
  const touchRadius = mobile.matches || matchMedia("(pointer: coarse)").matches ? 22 : 12;
  for (const m of markers) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < Math.max(touchRadius, m.r + 4) && d < distance) { hit = m; distance = d; }
  }
  if (!hit) { clearDetail(); renderResults(); return; }
  if (hit.points.length === 1) { openPoint(hit.points[0], false); return; }
  const [x0,y0,x1,y1] = visibleBounds(hit.points);
  if (camera.scale >= maximumScale * .97 || Math.max(x1-x0,y1-y0) * maximumScale < 22) {
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
canvas.addEventListener("pointerdown", (event) => {
  if (!camera || event.button !== 0) return;
  const position = local(event);
  if (!pointers.size) { startPointer = position; drag = false; }
  else drag = true;
  pointers.set(event.pointerId, position);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!pointers.has(event.pointerId)) return;
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
  if (wasTap) { const p = local(event); selectAt(p.x, p.y); }
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
$("category").addEventListener("change", applyFilters);
$("hide-visited").addEventListener("change", applyFilters);
$("reset").addEventListener("click", () => {
  activeLayer = ""; $("search").value = ""; $("hide-visited").checked = false;
  $("catalog").classList.remove("searching");
  buildCategories(); applyFilters();
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
base.src = "./assets/basemap.svg";
const observer = new ResizeObserver(resize);
observer.observe($("map-area"));
fetch("./assets/basemap-labels.json").then((res) => res.ok ? res.json() : []).then((rows) => {
  if (Array.isArray(rows)) { labels = rows; requestDraw(); }
}).catch(() => {});
async function init() {
  try {
    const response = await fetch("./assets/points.json");
    if (!response.ok) throw Error("points");
    const data = await response.json();
    layers = data.layers;
    categories = new Map(data.categories.map((c) => [c.id, c]));
    const layerNames = new Map(layers.map((layer) => [layer.id, layer.label]));
    points = data.points.map(([id, name, categoryId, x, y, sources, locality]) => {
      const category = categories.get(categoryId);
      const searchText = normalize([name, locality, category.label, categoryId, layerNames.get(category.layer)].join(" "));
      return { id, name, category, x, y, sources, locality, searchText };
    });
    loaded = true;
    buildLayers(); buildCategories(); resize(); applyFilters(); fit(points);
  } catch {
    $("top-count").textContent = "Ошибка загрузки";
    mapStatus("Не удалось загрузить точки.");
    const retry = el("button", "Повторить");
    retry.type = "button"; retry.addEventListener("click", () => location.reload()); $("map-status").append(retry);
  }
}
init();
