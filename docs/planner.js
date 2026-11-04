"use strict";

const airportSelect = document.querySelector("#airport");
const aircraftSelect = document.querySelector("#aircraft");
const results = document.querySelector("#results");
const routeTab = document.querySelector("#show-routes");
const fleetTab = document.querySelector("#show-fleet");
const planBox = document.querySelector("#plan");

// Dados da coleta no PilOps, publicados em dados.json pelo coletor local.
let fleet = [];
let routes = [];
let hubs = new Set();
let airportCodes = [];
let pilots = [];
let flightLog = [];
let flightsSince = null;
// Cobertura de cada rota pela frota atual (preenchida em start()).
let coverage = new Map();

const state = { origin: "", prefix: "", plan: [], tab: "routes", focus: null };
const number = new Intl.NumberFormat("pt-BR");

// ---------- Cálculos ----------

const airportName = code => airports[code]?.name || "Coordenadas pendentes";
const placeName = code => airports[code]?.city || airportName(code);

// Distância ortodrômica (grande círculo) em milhas náuticas.
function distance(from, to) {
  const a = airports[from];
  const b = airports[to];
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.sqrt(h));
}

const nm = value => value === null ? "distância indisponível" : number.format(Math.round(value)) + " nm";

// Tempo de bloco estimado: cruzeiro + 30 min de táxi, subida e descida, sem vento.
function blockMinutes(miles, plane) {
  const performance = plane && performanceOf(plane.model);
  if (!performance || miles === null) return null;
  return Math.round((miles / performance.speed + 0.5) * 12) * 5;
}

const clock = minutes => minutes === null ? "" :
  "≈ " + Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");

// ok | limite | fora | sem-dados
function reach(plane, miles) {
  const performance = plane && performanceOf(plane.model);
  if (!performance || miles === null) return "sem-dados";
  if (miles > performance.range) return "fora";
  return miles > performance.range * 0.9 ? "limite" : "ok";
}

const unavailable = plane => /em uso|manuten|em voo/i.test(plane.status);

function statusLabel(status) {
  return status.split(" · ").map(part => part === part.toUpperCase()
    ? part.charAt(0) + part.slice(1).toLowerCase() : part).join(" · ");
}

const selectedPlane = () => fleet.find(plane => plane.prefix === state.prefix);
const currentOrigin = () => state.plan.length ? state.plan.at(-1).destination : state.origin;

// ---------- Filtros ----------

// ---------- Mapa ----------

const mapContainer = document.querySelector("#map");
const map = window.L ? L.map(mapContainer, { minZoom: 1, maxZoom: 11, worldCopyJump: true }) : null;
const connections = map && L.layerGroup().addTo(map);
const markers = map && L.layerGroup().addTo(map);
const worldView = () => map?.fitBounds([[-55, -177], [69, 177]], { padding: [8, 8] });

if (map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    referrerPolicy: "strict-origin-when-cross-origin",
    maxZoom: 11,
  }).addTo(map);
  worldView();
} else {
  mapContainer.textContent = "O mapa não carregou. Os filtros e as listas continuam disponíveis.";
}

// Arco de grande círculo com longitudes contínuas (podem passar de ±180), sem cortar o Pacífico.
function arc(from, to) {
  const rad = Math.PI / 180;
  const vector = ({ lat, lon }) => [Math.cos(lat * rad) * Math.cos(lon * rad),
    Math.cos(lat * rad) * Math.sin(lon * rad), Math.sin(lat * rad)];
  const a = vector(airports[from]);
  const b = vector(airports[to]);
  const angle = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const steps = Math.min(128, Math.max(2, Math.ceil(angle / rad / 2)));
  const points = [[airports[from].lat, airports[from].lon]];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const [wa, wb] = angle < 1e-9 ? [1 - t, t]
      : [Math.sin((1 - t) * angle) / Math.sin(angle), Math.sin(t * angle) / Math.sin(angle)];
    const [x, y, z] = a.map((value, k) => wa * value + wb * b[k]);
    let lon = Math.atan2(y, x) / rad;
    lon += Math.round((points.at(-1)[1] - lon) / 360) * 360;
    points.push([Math.atan2(z, Math.hypot(x, y)) / rad, lon]);
  }
  return points;
}

// Cópias a ±360° para que linhas e pontos apareçam em qualquer volta do mapa.
const offsets = [-360, 0, 360];
const shifted = (points, offset) => points.map(([lat, lon]) => [lat, lon + offset]);

function drawMap(listed) {
  if (!map) return;
  markers.clearLayers();
  connections.clearLayers();
  const origin = currentOrigin();
  const draw = (route, style) => {
    if (!airports[route.origin] || !airports[route.destination]) return;
    const points = arc(route.origin, route.destination);
    for (const offset of offsets) {
      L.polyline(shifted(points, offset), { ...style, interactive: false }).addTo(connections);
    }
  };
  for (const { route } of listed) {
    const focused = state.focus === route;
    draw(route, { color: focused ? "#ee4055" : "#184ccc", weight: focused ? 4 : origin ? 2.6 : 1.7,
      opacity: focused ? 1 : origin ? .8 : .44 });
  }
  for (const leg of state.plan) {
    draw(leg, { color: "#0b1630", weight: 3.4, opacity: .9, dashArray: "7 6" });
  }
  for (const code of airportCodes) {
    if (!airports[code]) continue;
    const count = fleet.filter(plane => plane.airport === code).length;
    const tip = document.createElement("span");
    tip.textContent = code + " · " + airports[code].name + (count ? " · " + count + " na frota" : "");
    for (const offset of offsets) {
      L.circleMarker([airports[code].lat, airports[code].lon + offset], {
        radius: code === origin ? 8 : hubs.has(code) ? 6 : 4,
        color: "#ffffff", weight: 1.4, fillColor: hubs.has(code) ? "#ee4055" : "#184ccc", fillOpacity: 1,
      }).bindTooltip(tip).on("click", () => chooseAirport(code)).addTo(markers);
    }
  }
}

// Enquadra a origem e os destinos visíveis, com longitudes próximas da origem.
function frame(listed) {
  if (!map) return;
  const origin = currentOrigin();
  const shown = state.focus ? [state.focus] : [...state.plan, ...listed.map(item => item.route)];
  const points = shown.filter(route => airports[route.origin] && airports[route.destination])
    .flatMap(route => arc(route.origin, route.destination));
  if (origin && airports[origin]) points.push([airports[origin].lat, airports[origin].lon]);
  if (!points.length) return worldView();
  const center = origin && airports[origin] ? airports[origin].lon : points[0][1];
  const near = points.map(([lat, lon]) => [lat, lon + Math.round((center - lon) / 360) * 360]);
  map.fitBounds(near, { padding: [28, 28], maxZoom: points.length > 1 ? 7 : 6 });
}

// ---------- Lista ----------

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, action) {
  const node = element("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

const reachText = {
  ok: ["Dentro do alcance", "ok"],
  limite: ["No limite do alcance", "warn"],
  fora: ["Fora do alcance", "bad"],
  "sem-dados": ["Alcance não cadastrado", "neutral"],
};

function reachTag(plane, miles) {
  const status = reach(plane, miles);
  const performance = performanceOf(plane.model);
  const [label, tone] = reachText[status];
  return element("span", "tag " + tone, label +
    (performance && status !== "ok" ? " · máx. ≈ " + number.format(performance.range) + " nm" : ""));
}

function routeRow({ route, miles }) {
  const plane = selectedPlane();
  const row = element("li");
  const head = element("div", "row-head");
  head.append(button(route.origin + " → " + route.destination, "item-heading", () => {
    state.focus = state.focus === route ? null : route;
    render(false);
    frame(listedRoutes());
  }));
  if (currentOrigin()) head.append(button("Adicionar ao plano", "secondary small", () => addLeg(route)));
  row.append(head);
  row.append(element("span", "meta", [route.code, placeName(route.destination), nm(miles),
    clock(blockMinutes(miles, plane))].filter(Boolean).join(" · ")));
  if (plane) {
    row.append(reachTag(plane, miles));
  } else if (currentOrigin()) {
    const able = fleet.filter(item => item.airport === route.origin && !unavailable(item) &&
      ["ok", "limite"].includes(reach(item, miles)));
    row.append(element("span", "meta", able.length
      ? "Aeronaves aqui que alcançam: " + able.map(item => item.prefix + " (" + item.model + ")").join(", ")
      : "Nenhuma aeronave disponível aqui alcança este trecho."));
  }
  const status = coverage.get(route)?.status;
  if (!plane && status === "comprar") row.append(element("span", "tag bad", "Nenhuma aeronave da frota alcança esta rota"));
  return row;
}

function fleetRow(plane) {
  const row = element("li", unavailable(plane) ? "unavailable" : "");
  row.append(button(plane.prefix + " · " + plane.model, "item-heading", () => chooseAircraft(plane.prefix)));
  const performance = performanceOf(plane.model);
  row.append(element("span", "meta", "Local exibido: " + plane.airport + " · Hangar: " + (plane.base || "não informado") +
    (performance ? " · alcance ≈ " + number.format(performance.range) + " nm" : "")));
  row.append(element("span", "tag " + (unavailable(plane) ? "bad" : /atenção|fora/i.test(plane.status) ? "warn" : "neutral"),
    statusLabel(plane.status)));
  return row;
}

function listedRoutes() {
  const origin = currentOrigin();
  const plane = selectedPlane();
  const order = { ok: 0, limite: 1, "sem-dados": 2, fora: 3 };
  const listed = routes.filter(route => !origin || route.origin === origin)
    .map(route => ({ route, miles: distance(route.origin, route.destination) }));
  if (!origin) return listed;
  return listed.sort((a, b) => (plane ? order[reach(plane, a.miles)] - order[reach(plane, b.miles)] : 0) ||
    (a.miles ?? Infinity) - (b.miles ?? Infinity));
}

function renderPlan() {
  planBox.replaceChildren();
  planBox.hidden = state.plan.length === 0;
  if (!state.plan.length) return;
  const plane = selectedPlane();
  const legs = state.plan.map(route => ({ route, miles: distance(route.origin, route.destination) }));
  const heading = element("div", "plan-head");
  const title = element("div");
  title.append(element("p", "eyebrow", "PLANO DE TRECHOS"),
    element("strong", "", [state.plan[0].origin, ...state.plan.map(route => route.destination)].join(" → ")));
  const actions = element("div", "plan-actions");
  actions.append(button("Desfazer último", "secondary small", () => {
    state.plan.pop(); state.focus = null; render();
  }), button("Limpar plano", "secondary small", () => {
    state.plan = []; state.focus = null; render();
  }));
  heading.append(title, actions);
  const list = element("ol", "plan-legs");
  for (const { route, miles } of legs) {
    const item = element("li");
    item.append(element("span", "", [route.code, route.origin + " → " + route.destination, nm(miles),
      clock(blockMinutes(miles, plane))].filter(Boolean).join(" · ")));
    if (plane && reach(plane, miles) !== "ok") item.append(reachTag(plane, miles));
    list.append(item);
  }
  const total = legs.reduce((sum, leg) => sum + (leg.miles ?? 0), 0);
  const times = legs.map(leg => blockMinutes(leg.miles, plane));
  const totalTime = times.every(value => value !== null) ? " · " + clock(times.reduce((a, b) => a + b, 0)) + " de bloco" : "";
  planBox.append(heading, list, element("p", "meta", "Total: " + nm(total) + " em " + legs.length +
    (legs.length > 1 ? " trechos" : " trecho") + (plane ? totalTime : " · escolha uma aeronave para checar alcance e tempo")));
}

function render(moveMap = true) {
  const plane = selectedPlane();
  const origin = currentOrigin();
  const listed = listedRoutes();
  const airportFleet = fleet.filter(item => !origin || item.airport === origin);
  airportSelect.value = state.origin;
  aircraftSelect.value = state.prefix;
  document.querySelector("#selection").textContent = [plane?.prefix,
    origin && (plane || state.plan.length ? "a partir de " + origin : origin)].filter(Boolean).join(" ") || "Toda a rede";
  let detail = origin ? airportName(origin) : "Rotas cadastradas e frota do levantamento";
  if (plane) {
    const performance = performanceOf(plane.model);
    detail = plane.model + " · Posição no PilOps: " + plane.airport + " · Hangar: " + (plane.base || "não informado") +
      " · " + statusLabel(plane.status) + (performance
        ? " · Alcance ≈ " + number.format(performance.range) + " nm, cruzeiro ≈ " + performance.speed + " kt"
        : " · Alcance não cadastrado para este modelo") + ".";
    if (unavailable(plane)) detail += " Aeronave indisponível agora.";
    if (origin && origin !== plane.airport) detail += " Planejando a partir de " + origin + ", não da posição atual.";
  }
  document.querySelector("#selection-detail").textContent = detail;
  document.querySelector("#route-count").textContent = listed.length;
  document.querySelector("#fleet-count").textContent = airportFleet.length;
  routeTab.setAttribute("aria-pressed", String(state.tab === "routes"));
  fleetTab.setAttribute("aria-pressed", String(state.tab === "fleet"));
  const rows = state.tab === "routes" ? listed.map(routeRow) : airportFleet.map(fleetRow);
  results.replaceChildren(...rows);
  if (rows.length === 0) {
    results.append(element("li", "", state.tab === "routes"
      ? "Nenhuma rota cadastrada com partida de " + origin + "."
      : "Nenhuma aeronave da Vortex está em " + origin + " neste levantamento."));
  }
  renderPlan();
  drawMap(listed);
  if (moveMap) frame(listed);
}

// ---------- Ações ----------

function chooseAirport(code) {
  Object.assign(state, { origin: code, plan: [], focus: null, tab: "routes" });
  render();
}

function chooseAircraft(prefix) {
  const plane = fleet.find(item => item.prefix === prefix);
  Object.assign(state, { prefix: plane ? prefix : "", origin: plane?.airport || state.origin,
    plan: [], focus: null, tab: "routes" });
  render();
}

function addLeg(route) {
  state.plan.push(route);
  state.focus = null;
  state.tab = "routes";
  render();
}

function reset() {
  Object.assign(state, { origin: "", prefix: "", plan: [], tab: "routes", focus: null });
  render(false);
  worldView();
}

airportSelect.addEventListener("change", () => {
  if (airportSelect.value || state.prefix) chooseAirport(airportSelect.value);
  else reset();
});
aircraftSelect.addEventListener("change", () => {
  if (aircraftSelect.value) chooseAircraft(aircraftSelect.value);
  else { state.prefix = ""; state.plan = []; render(); }
});
routeTab.addEventListener("click", () => { state.tab = "routes"; render(false); });
fleetTab.addEventListener("click", () => { state.tab = "fleet"; render(false); });
document.querySelector("#world").addEventListener("click", worldView);
document.querySelector("#reset").addEventListener("click", reset);

// ---------- Frota × rotas ----------

const money = value => {
  const abs = Math.abs(value);
  const [div, unit] = abs >= 1e9 ? [1e9, " bi"] : abs >= 1e6 ? [1e6, " mi"] : abs >= 1e3 ? [1e3, " mil"] : [1, ""];
  return "P$ " + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: div === 1 ? 0 : 1 }).format(value / div) + unit;
};

// comprar: nenhum modelo da frota tem alcance · indisponivel: só aeronaves em uso/manutenção alcançam ·
// reposicionar: há aeronave capaz livre, mas não na origem · pronta: há aeronave capaz livre na origem.
function routeCoverage(route) {
  const miles = distance(route.origin, route.destination);
  const capable = fleet.filter(plane => ["ok", "limite"].includes(reach(plane, miles)));
  const free = capable.filter(plane => !unavailable(plane));
  const here = free.filter(plane => plane.airport === route.origin);
  const status = !capable.length ? "comprar" : !free.length ? "indisponivel" : !here.length ? "reposicionar" : "pronta";
  // Modelos do catálogo do PilOps que alcançam a rota, do mais barato ao mais caro.
  const options = miles === null ? [] : aircraftCatalog.filter(item => item.range >= miles).sort((a, b) => a.price - b.price);
  return { route, miles, capable, free, here, status, options };
}

const coverageText = {
  comprar: ["Precisa comprar", "bad"],
  indisponivel: ["Só com aeronave indisponível", "warn"],
  reposicionar: ["Reposicionar aeronave", "warn"],
  pronta: ["Pronta para voar", "ok"],
};

function renderCoverage() {
  const order = { comprar: 0, indisponivel: 1, reposicionar: 2, pronta: 3 };
  const items = [...coverage.values()].sort((a, b) => order[a.status] - order[b.status] || (b.miles ?? 0) - (a.miles ?? 0));
  const counts = items.reduce((acc, item) => (acc[item.status] = (acc[item.status] || 0) + 1, acc), {});
  document.querySelector("#coverage-summary").textContent = [
    counts.comprar && counts.comprar + (counts.comprar > 1 ? " rotas precisam" : " rota precisa") + " de aeronave que a frota não tem",
    counts.indisponivel && counts.indisponivel + " só com aeronave em uso ou manutenção",
    counts.reposicionar && counts.reposicionar + " com aeronave capaz em outro aeroporto",
    counts.pronta && counts.pronta + (counts.pronta > 1 ? " prontas" : " pronta") + " para voar",
  ].filter(Boolean).join(" · ") + ".";
  const list = document.querySelector("#coverage");
  list.replaceChildren(...items.map(item => {
    const row = element("li");
    const head = element("div", "row-head");
    head.append(button(item.route.origin + " → " + item.route.destination, "item-heading", () => {
      Object.assign(state, { origin: item.route.origin, plan: [], focus: item.route, tab: "routes" });
      render(false);
      frame(listedRoutes());
      document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    head.append(element("span", "tag " + coverageText[item.status][1], coverageText[item.status][0]));
    row.append(head, element("span", "meta", item.route.code + " · " + nm(item.miles)));
    const models = list => [...new Set(list.map(plane => plane.model))].join(", ");
    let detail;
    if (item.status === "comprar") {
      const cheapest = item.options.slice(0, 5).map(option => option.name + " (" + money(option.price) + ")");
      detail = cheapest.length
        ? "Nenhum modelo da frota tem esse alcance. No PilOps, alcançam: " + cheapest.join(", ") +
          (item.options.length > 5 ? " e mais " + (item.options.length - 5) + " modelos" : "") + "."
        : "Nenhum modelo do catálogo do PilOps tem esse alcance sem escala.";
    } else if (item.status === "indisponivel") {
      detail = "Alcançam, mas estão indisponíveis agora: " + item.capable.map(p => p.prefix + " (" + statusLabel(p.status).toLowerCase() + ")").join(", ") + ".";
    } else if (item.status === "reposicionar") {
      detail = "Capazes e livres em outros aeroportos: " + item.free.map(p => p.prefix + " em " + p.airport).join(", ") +
        ". Modelos: " + models(item.free) + ".";
    } else {
      detail = "Livres em " + item.route.origin + ": " + item.here.map(p => p.prefix + " (" + p.model + ")").join(", ") + ".";
    }
    row.append(element("span", "meta", detail));
    return row;
  }));
}

// ---------- Ranking de pilotos ----------

const hoursText = minutes => Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");
const dayText = iso => iso ? iso.split("-").reverse().join("/") : "—";
const ranking = { key: "companyMinutes", desc: true };

function pilotStats() {
  const registered = new Set(routes.map(route => route.origin + "-" + route.destination));
  const rows = new Map(pilots.map(p => [p.name, { ...p, flights: 0, minutes: 0, nm: 0, revenue: 0, vtx: new Set(), last: null, member: true }]));
  for (const flight of flightLog) {
    if (!rows.has(flight.pilot)) {
      rows.set(flight.pilot, { name: flight.pilot, role: null, level: null, totalMinutes: null, companyMinutes: null,
        joined: null, flights: 0, minutes: 0, nm: 0, revenue: 0, vtx: new Set(), last: null, member: false });
    }
    const row = rows.get(flight.pilot);
    row.flights++;
    row.minutes += flight.minutes;
    row.nm += flight.nm;
    row.revenue += flight.revenue;
    const pair = flight.origin + "-" + flight.destination;
    if (registered.has(pair)) row.vtx.add(pair);
    if (!row.last || flight.date > row.last) row.last = flight.date;
  }
  return [...rows.values()].map(row => ({ ...row, vtxCount: row.vtx.size }));
}

const rankingColumns = [
  ["name", "Piloto"],
  ["companyMinutes", "Horas na Vortex"],
  ["flights", "Voos"],
  ["minutes", "Horas voadas*"],
  ["nm", "Distância*"],
  ["revenue", "Receita*"],
  ["vtxCount", "Rotas VTX*"],
  ["last", "Último voo*"],
];

function renderRanking() {
  const table = document.querySelector("#ranking");
  const rows = pilotStats().sort((a, b) => {
    const [x, y] = [a[ranking.key], b[ranking.key]];
    const result = typeof x === "string" || typeof y === "string"
      ? String(x ?? "").localeCompare(String(y ?? ""), "pt-BR")
      : (x ?? -1) - (y ?? -1);
    return (ranking.desc ? -result : result) || (b.companyMinutes ?? -1) - (a.companyMinutes ?? -1);
  });
  const head = element("tr");
  for (const [key, title] of rankingColumns) {
    const th = element("th");
    th.setAttribute("scope", "col");
    th.setAttribute("aria-sort", ranking.key === key ? (ranking.desc ? "descending" : "ascending") : "none");
    th.append(button(title + (ranking.key === key ? (ranking.desc ? " ↓" : " ↑") : ""), "sort", () => {
      Object.assign(ranking, ranking.key === key ? { desc: !ranking.desc } : { key, desc: key !== "name" });
      renderRanking();
    }));
    head.append(th);
  }
  const body = rows.map((row, index) => {
    const tr = element("tr", row.member ? "" : "former");
    const name = element("td");
    name.append(element("span", "rank", String(index + 1)), element("strong", "", "@" + row.name));
    if (row.role) name.append(element("span", "tag neutral", row.role));
    if (!row.member) name.append(element("span", "tag warn", "fora do painel"));
    tr.append(name,
      element("td", "", row.companyMinutes === null ? "—" : hoursText(row.companyMinutes)),
      element("td", "", number.format(row.flights)),
      element("td", "", row.flights ? hoursText(row.minutes) : "—"),
      element("td", "", row.flights ? nm(row.nm) : "—"),
      element("td", "", row.flights ? money(row.revenue) : "—"),
      element("td", "", row.flights ? String(row.vtxCount) : "—"),
      element("td", "", dayText(row.last)));
    return tr;
  });
  const thead = element("thead");
  thead.append(head);
  const tbody = element("tbody");
  tbody.append(...body);
  table.replaceChildren(thead, tbody);

  document.querySelector("#ranking-note").textContent = (pilots.length ? pilots.length + " pilotos no painel do PilOps. " : "") +
    "Horas na Vortex vêm do PilOps. * Contado a partir dos voos lidos " +
    (flightsSince ? "desde " + dayText(flightsSince) : "nas sincronizações") +
    " (" + flightLog.length + " voos): o PilOps mostra só os 10 voos mais recentes, então sincronize com frequência para não perder nenhum.";

  const pairs = new Map();
  for (const flight of flightLog) {
    const key = flight.origin + " → " + flight.destination;
    const item = pairs.get(key) || { key, count: 0, pilots: new Set(), nm: flight.nm };
    item.count++;
    item.pilots.add(flight.pilot);
    pairs.set(key, item);
  }
  const top = [...pairs.values()].sort((a, b) => b.count - a.count || b.nm - a.nm).slice(0, 5);
  document.querySelector("#top-routes").replaceChildren(...(top.length ? top.map(item => {
    const li = element("li");
    li.append(element("strong", "", item.key), element("span", "meta",
      item.count + (item.count > 1 ? " voos" : " voo") + " · " + nm(item.nm) + " · " + [...item.pilots].map(p => "@" + p).join(", ")));
    return li;
  }) : [element("li", "meta", "Nenhum voo lido ainda.")]));
}

async function start() {
  let data;
  try {
    // O parâmetro evita a cópia em cache do GitHub Pages e traz sempre a coleta mais recente.
    const response = await fetch("./dados.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch {
    document.querySelector("#snapshot-time").textContent = "Não foi possível carregar os dados da Vortex.";
    document.querySelector("#snapshot-note").textContent = "Confira a conexão e recarregue a página.";
    return;
  }
  fleet = data.fleet;
  routes = data.routes;
  hubs = new Set(data.hubs);
  pilots = data.pilots || [];
  flightLog = data.flights || [];
  flightsSince = data.flightsSince || null;
  coverage = new Map(routes.map(route => [route, routeCoverage(route)]));
  // Só entram no filtro e no mapa os aeroportos que a Vortex usa: posição da frota, rotas e hubs.
  airportCodes = [...new Set([
    ...hubs, ...fleet.map(plane => plane.airport),
    ...routes.flatMap(route => [route.origin, route.destination]),
  ])].filter(Boolean).sort();

  document.querySelector("#total-fleet").textContent = fleet.length;
  document.querySelector("#total-routes").textContent = routes.length;
  document.querySelector("#total-hubs").textContent = hubs.size;
  {
    const date = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
    }).format(new Date(data.capturedAt));
    document.querySelector("#snapshot-time").textContent = "Última coleta no PilOps · " + date + " (Brasília)";
    document.querySelector("#snapshot-note").textContent = fleet.length + (fleet.length === 1 ? " aeronave" : " aeronaves") +
      " e " + routes.length + (routes.length === 1 ? " rota mapeada" : " rotas mapeadas") + " nesta coleta.";
  }

  for (const code of airportCodes) {
    const planes = fleet.filter(plane => plane.airport === code).length;
    const departures = routes.filter(route => route.origin === code).length;
    const counts = [planes && planes + (planes > 1 ? " aeronaves" : " aeronave"),
      departures && departures + (departures > 1 ? " rotas" : " rota")].filter(Boolean).join(" · ");
    airportSelect.add(new Option(code + " · " + airportName(code) + (counts ? " — " + counts : ""), code));
  }
  for (const plane of [...fleet].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    aircraftSelect.add(new Option(plane.prefix + " · " + plane.model +
      (unavailable(plane) ? " (" + statusLabel(plane.status).toLowerCase() + ")" : ""), plane.prefix));
  }
  render(false);
  renderCoverage();
  renderRanking();
}

start();
