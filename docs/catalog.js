"use strict";

let completionRequest;
let completionWeight = 0;
const goalScoreFormat = new Intl.NumberFormat("ru", { maximumFractionDigits: 2 });

function isCurrentGTABase(point) {
  return Boolean(point.sources.gtabase) && !point.category.archived;
}

function goalKey(goal, pointId) {
  return goal.id + "|" + (goal.alternatives.get(pointId) || pointId);
}

function goalScore(goal) {
  let done = 0;
  const checked = (id) => goalsDone.has(goalKey(goal, id));
  for (const unit of goal.units) {
    const complete = goal.mode === "all"
      ? unit.items.length > 0 && unit.items.every((alternatives) => alternatives.some(checked))
      : unit.ids.some(checked);
    if (complete) done += goal.per;
  }
  return Math.min(done, goal.need);
}

async function loadGoals() {
  const response = await fetch("./assets/completion.json?v=4");
  if (!response.ok) throw Error("completion");
  const data = await response.json();
  const index = new Map();
  for (const section of data.sections) {
    for (const goal of section.rows) {
      goal.alternatives = new Map();
      for (const unit of goal.units) {
        for (const ids of goal.mode === "all" ? unit.items : [unit.ids]) {
          for (const id of ids) goal.alternatives.set(id, ids[0]);
        }
      }
      for (const id of goal.alternatives.keys()) {
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(goal);
      }
      goal.section = section.id;
      goal.searchText = normalize([goal.label, goal.labelEn, section.label, section.labelEn].join(" "));
    }
  }
  for (const [id, goals] of index) goalsByPoint.set(id, goals);
  sections = data.sections;
  completionWeight = data.weightTotal;
}

function checkedOnMap(point) {
  if (catalogMode === "map") return foundTargets.has(point.category.sharedTarget.get(point.id) || point.id);
  const relevant = (goalsByPoint.get(point.id) || []).filter(goal => matchesGoal(point, goal));
  return relevant.length > 0 && relevant.every(goal => goalsDone.has(goalKey(goal, point.id)));
}

function matchesGoal(point, goal) {
  return (!activeGroup || goal.section === activeGroup) && (!activeCategory || goal.id === activeCategory) &&
    searchTerms.every(term => point.searchText.includes(term) || goal.searchText.includes(term));
}

async function switchCatalog(mode) {
  if (!loaded) return;
  catalogMode = mode;
  activeGroup = activeCategory = "";
  $("search").value = "";
  $("hide-visited").checked = false;
  $("catalog").classList.remove("searching");
  clearDetail();
  const completion = mode === "completion";
  $("mode-map").setAttribute("aria-pressed", String(!completion));
  $("mode-completion").setAttribute("aria-pressed", String(completion));
  $("source-filter").hidden = completion;
  $("completion-info").hidden = !completion;
  $("hide-label").textContent = completion ? "Скрыть выполненные" : "Скрыть найденные";
  $("layers").replaceChildren();
  if (completion && !sections.length) {
    $("completion-progress").textContent = "Загружаем цели…";
    applyFilters();
    try {
      if (!completionRequest) completionRequest = loadGoals();
      await completionRequest;
    } catch {
      completionRequest = null;
      if (catalogMode === mode) {
        $("completion-progress").textContent = "Не удалось загрузить цели.";
        const retry = el("button", "Повторить", "text-button");
        retry.type = "button";
        retry.onclick = () => switchCatalog(mode);
        $("layers").replaceChildren(retry);
      }
      return;
    }
  }
  if (catalogMode !== mode) return;
  renderCatalog();
  applyFilters();
}

function catalogPredicate() {
  const hide = $("hide-visited").checked;
  if (catalogMode === "completion") {
    return (p) => (goalsByPoint.get(p.id) || []).some((goal) =>
      matchesGoal(p, goal) && (!hide || !goalsDone.has(goalKey(goal, p.id))));
  }
  const group = groups.find((g) => g.id === activeGroup);
  const allowed = group && new Set(group.categories);
  const sourceOnly = $("gtabase-only").checked;
  return (p) => (!p.category.archived || group?.archived) &&
    (!sourceOnly || isCurrentGTABase(p)) && (!allowed || allowed.has(p.category.id)) &&
    (!activeCategory || p.category.id === activeCategory) && (!hide || !checkedOnMap(p)) &&
    searchTerms.every(term => p.searchText.includes(term));
}

function chooseCategory(groupId, categoryId, button) {
  const deselect = activeGroup === groupId && activeCategory === categoryId;
  activeGroup = deselect ? "" : groupId;
  activeCategory = deselect ? "" : categoryId;
  renderCatalog();
  applyFilters();
  if (mobile.matches) {
    setPanel(false);
    $("panel-toggle").focus({ preventScroll: true });
  } else {
    document.getElementById(button.id)?.focus({ preventScroll: true });
  }
}

function filterRow(groupId, categoryId, label, sublabel, count, icon, layer) {
  const button = el("button", null, "filter-row");
  button.type = "button";
  button.id = "filter-" + groupId + "--" + categoryId;
  button.dataset.category = categoryId;
  button.setAttribute("aria-pressed", String(activeGroup === groupId && activeCategory === categoryId));
  if (icon) button.append(iconBadge(icon, layer));
  const copy = el("span", null, "filter-copy");
  copy.append(el("span", label));
  if (sublabel) copy.append(el("small", sublabel));
  button.append(copy);
  if (count) button.append(el("span", count, "filter-count"));
  button.addEventListener("click", () => chooseCategory(groupId, categoryId, button));
  return button;
}

function catalogSection(group, open, count) {
  const section = el("details", null, "catalog-group");
  section.dataset.group = group.id;
  section.open = open;
  const summary = el("summary");
  const copy = el("span", null, "filter-copy");
  copy.append(el("strong", group.label));
  const en = group.en || group.labelEn;
  if (en && en !== group.label) copy.append(el("small", en));
  const layer = layers.find(l => l.id === group.layer);
  if (layer) summary.append(iconBadge(layer.icon, layer.id));
  summary.append(copy);
  if (count) summary.append(el("span", count, "group-count"));
  section.append(summary);
  section.append(filterRow(group.id, "", "Весь раздел", "", "", null, null));
  return section;
}

function renderCatalog() {
  const root = $("layers");
  const expanded = new Set([...root.querySelectorAll("details[open]")].map(el => el.dataset.group));
  const first = !root.querySelector("details");
  const list = document.createDocumentFragment();
  if (catalogMode === "map") {
    const sourceOnly = $("gtabase-only").checked;
    for (const group of groups) {
      const rows = group.categories.map(id => categories.get(id)).filter(Boolean);
      const usable = rows.map(category => {
        const all = categoryPoints.get(category.id) || [];
        const members = sourceOnly ? all.filter(isCurrentGTABase) : all;
        return {category, members};
      }).filter(row => row.members.length);
      if (!usable.length) continue;
      for (const row of usable) {
        const checked = new Set(), targets = new Set();
        for (const p of row.members) {
          const target = row.category.sharedTarget.get(p.id) || p.id;
          targets.add(target);
          if (visited.has(p.id)) checked.add(target);
        }
        row.total = targets.size;
        row.found = checked.size;
      }
      const count = usable.reduce((n, r) => n + r.total, 0);
      const section = catalogSection(group, expanded.has(group.id) || group.id === activeGroup, format.format(count));
      for (const {category, members, found, total} of usable) {
        const tracked = !sourceOnly || category.trackable !== false;
        const button = filterRow(group.id, category.id, category.label, category.en,
          (tracked ? found + "/" : "") + format.format(total), category.icon, category.layer);
        button.title = tracked ? "Найдено / всего целей" : "Мест на карте";
        if (total !== members.length) {
          button.querySelector(".filter-copy").append(el("small", "Мест на карте: " + members.length));
        }
        section.append(button);
      }
      list.append(section);
    }
  } else {
    let contribution = 0;
    for (const group of sections) {
      const section = catalogSection(group, expanded.has(group.id) || group.id === activeGroup ||
        (first && group === sections[0]), "");
      for (const goal of group.rows) {
        const done = goalScore(goal);
        contribution += goal.weight * done / goal.need;
        const button = filterRow(group.id, goal.id, goal.label, goal.labelEn, done + "/" + goal.need);
        const copy = button.querySelector(".filter-copy");
        copy.append(el("small", goal.requirement + " · " + goal.weight + "%", "goal-requirement"));
        if (goal.capacity < goal.need) copy.append(el("small", "На карте доступно " + goal.capacity + " из " + goal.need));
        if (goal.note) copy.append(el("small", goal.note, "goal-note"));
        section.append(button);
      }
      list.append(section);
    }
    $("completion-progress").textContent = "По целям карты набрано " + goalScoreFormat.format(contribution) +
      " из " + completionWeight + " п. п. по шкале GTABase";
  }
  root.replaceChildren(list);
}

function buildGoalActions(point) {
  const root = $("goal-actions");
  root.hidden = catalogMode !== "completion";
  root.replaceChildren();
  if (root.hidden) return;
  for (const goal of goalsByPoint.get(point.id) || []) {
    const key = goalKey(goal, point.id);
    const done = goalsDone.has(key);
    const button = el("button", goal.label + (done ? " · выполнено ✓" : " · отметить выполнение"), "visit-button");
    button.type = "button";
    button.setAttribute("aria-pressed", String(done));
    button.addEventListener("click", () => {
      if (goalsDone.has(key)) goalsDone.delete(key); else goalsDone.add(key);
      try {
        localStorage.setItem(goalsKey, JSON.stringify([...goalsDone]));
        storageWorks = true;
      } catch { storageWorks = false; }
      buildDetail();
      renderCatalog();
      applyFilters();
    });
    root.append(button);
  }
}
