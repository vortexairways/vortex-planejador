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
let capturedAt = null;
let pilotsCapturedAt = null;
let revenueMonitor = { readCount: 0, groups: [] };
let refreshingData = false;
let operationConfig = null;
let shareLegs = [];
let activityConfig = null;
let activityDay = null;
// Cobertura de cada rota pela frota atual (preenchida em start()).
let coverage = new Map();
// Circuitos fechados formados por rotas cadastradas (preenchidos em start()).
let circuits = [];
const ideas = { view: "circuitos", scope: "todas", limit: 12 };

const state = { origin: "", prefix: "", plan: [], tab: "routes", focus: null };

// ---------- Idioma ----------
// Português ou inglês. Ordem: ?lang= na URL, escolha salva no navegador, idioma do navegador (pt → português,
// qualquer outro → inglês). Os textos fixos da página levam a versão em inglês no atributo data-en.
const langKey = "vortex-lang";
let lang = (() => {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked === "pt" || asked === "en") return asked;
  try {
    const saved = localStorage.getItem(langKey);
    if (saved === "pt" || saved === "en") return saved;
  } catch { /* navegador sem armazenamento */ }
  return /^pt\b/i.test(navigator.language || "pt") ? "pt" : "en";
})();
const T = (pt, en) => lang === "en" ? en : pt;
const locale = () => lang === "en" ? "en-GB" : "pt-BR";
let number = new Intl.NumberFormat(locale());

const staticTexts = [...document.querySelectorAll("[data-en]")].map(node => ({ node, pt: node.innerHTML, en: node.dataset.en }));
const staticLabels = [...document.querySelectorAll("[data-en-label]")]
  .map(node => ({ node, pt: node.getAttribute("aria-label"), en: node.dataset.enLabel }));
const pageTitle = { pt: document.title, en: "Route planner | Vortex Airways" };

function applyStaticTexts() {
  document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
  document.title = pageTitle[lang];
  for (const item of staticTexts) item.node.innerHTML = item[lang];
  for (const item of staticLabels) item.node.setAttribute("aria-label", item[lang]);
  for (const choice of document.querySelectorAll("#lang button")) {
    choice.setAttribute("aria-pressed", String(choice.dataset.lang === lang));
  }
}

// ---------- Cálculos ----------

const airportName = code => airports[code]?.name || T("Coordenadas pendentes", "Coordinates pending");
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

const nm = value => value === null ? T("distância indisponível", "distance unavailable") : number.format(Math.round(value)) + " nm";

// Usa a duração concluída registrada no PilOps para a mesma rota e modelo.
function blockEstimate(miles, plane, origin, destination) {
  return VortexTimes.estimate({ miles, plane, origin, destination, performance: plane && performanceOf(plane.model), flights: flightLog });
}
const blockMinutes = (miles, plane, origin, destination) => blockEstimate(miles, plane, origin, destination).minutes;
function blockLabel(miles, plane, origin, destination) {
  const estimate = blockEstimate(miles, plane, origin, destination);
  return estimate.minutes === null ? "" : clock(estimate.minutes) + (estimate.source === "pilops"
    ? " · PilOps · " + estimate.count + (estimate.count === 1 ? T(" voo registrado", " recorded flight") : T(" voos registrados", " recorded flights")) +
      T(" · último em ", " · latest on ") + dayText(estimate.lastDate)
    : T(" · estimativa de catálogo", " · catalogue estimate"));
}
const timeBasis = summary => summary.source === "pilops" ? T("histórico do PilOps", "PilOps history") : summary.source === "mixed"
  ? T("PilOps em ", "PilOps on ") + summary.count + "/" + summary.total + T(" trechos; demais por catálogo", " legs; others from catalogue")
  : T("estimativa de catálogo", "catalogue estimate");

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

// Os estados vêm do PilOps em português; em inglês, cada parte conhecida é traduzida.
const statusEnglish = { "MANUTENÇÃO": "Maintenance", "EM USO": "In use", "FORA DA ÁREA": "Out of area",
  "Sem alerta no cartão": "No alerts on card", "Atenção em motor": "Attention: engine", "Atenção em freios": "Attention: brakes",
  "Atenção em pneus": "Attention: tyres" };
function statusLabel(status) {
  return status.split(" · ").map(part => lang === "en" && statusEnglish[part] ? statusEnglish[part]
    : part === part.toUpperCase() ? part.charAt(0) + part.slice(1).toLowerCase() : part).join(" · ");
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
  // Mapa do OpenStreetMap escurecido por filtro (classe efb-tiles), no estilo das telas de navegação de um EFB.
  // Não depende de chave de API nem de conta em serviço de mapas.
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: "efb-tiles",
    referrerPolicy: "strict-origin-when-cross-origin",
    maxZoom: 11,
  }).addTo(map);
  const zoomClass = () => {
    mapContainer.classList.toggle("efb-far", map.getZoom() < 3);
    mapContainer.classList.toggle("efb-very-far", map.getZoom() < 2);
  };
  map.on("zoomend", zoomClass);
  worldView();
  zoomClass();
} else {
  mapContainer.textContent = T("O mapa não carregou. Os filtros e as listas continuam disponíveis.",
    "The map did not load. Filters and lists are still available.");
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

// Paleta inspirada nas telas de navegação: ciano = utilizável, âmbar = atenção, vermelho = impeditivo,
// magenta = plano de voo, azul apagado = malha geral.
const efb = { network: "#5b8db8", ok: "#22d3ee", warn: "#fbbf24", bad: "#fb7185", plan: "#e040fb",
  focus: "#ffffff", casing: "#05080e", planCasing: "#2b0736" };

function drawArc(points, style, casing) {
  for (const offset of offsets) {
    const line = shifted(points, offset);
    if (casing) L.polyline(line, { ...casing, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(connections);
    L.polyline(line, { ...style, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(connections);
  }
}

// Marca um ponto ao longo do arco: seta de sentido (girada pela projeção do mapa) ou etiqueta de distância.
function markAlong(points, fraction, text, className, color, rotate) {
  const i = Math.min(points.length - 2, Math.max(0, Math.floor((points.length - 1) * fraction)));
  const [a, b] = [points[i], points[i + 1]];
  const pa = L.CRS.EPSG3857.project(L.latLng(a[0], a[1]));
  const pb = L.CRS.EPSG3857.project(L.latLng(b[0], b[1]));
  const angle = Math.atan2(-(pb.y - pa.y), pb.x - pa.x) * 180 / Math.PI;
  for (const offset of offsets) {
    const label = element("span", "", text);
    if (color) label.style.color = color;
    if (rotate) label.style.transform = "translate(-50%, -50%) rotate(" + angle.toFixed(1) + "deg)";
    L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + offset], {
      icon: L.divIcon({ className, html: label, iconSize: [0, 0] }), interactive: false, keyboard: false,
    }).addTo(connections);
  }
}

function routeColor(route, plane) {
  if (plane) {
    const status = reach(plane, distance(route.origin, route.destination));
    return status === "ok" ? efb.ok : status === "limite" ? efb.warn : status === "fora" ? efb.bad : efb.network;
  }
  const status = coverage.get(route)?.status;
  return status === "pronta" ? efb.ok : status === "comprar" ? efb.bad : status ? efb.warn : efb.network;
}

function drawMap(listed) {
  if (!map) return;
  markers.clearLayers();
  connections.clearLayers();
  const origin = currentOrigin();
  const plane = selectedPlane();
  const valid = route => airports[route.origin] && airports[route.destination];
  const samePair = (a, b) => a && b && [a.origin, a.destination].sort().join() === [b.origin, b.destination].sort().join();

  if (!origin) {
    // Visão geral: cada par de aeroportos vira uma linha só; seta apenas nas rotas de mão única.
    const pairs = new Map();
    for (const { route } of listed) {
      if (!valid(route)) continue;
      const key = [route.origin, route.destination].sort().join("-");
      const item = pairs.get(key);
      if (!item) pairs.set(key, { route, both: false });
      else if (item.route.origin !== route.origin) item.both = true;
    }
    for (const { route, both } of pairs.values()) {
      const points = arc(route.origin, route.destination);
      const focused = samePair(state.focus, route);
      drawArc(points, { color: focused ? efb.focus : efb.network, weight: focused ? 3 : 1.6, opacity: focused ? 1 : .6 },
        focused ? { color: efb.ok, weight: 8, opacity: .3 } : null);
      if (!both) markAlong(points, .6, "➤", "efb-arrow", focused ? efb.focus : efb.network, true);
    }
  } else {
    for (const { route, miles } of listed) {
      if (!valid(route)) continue;
      const points = arc(route.origin, route.destination);
      const focused = state.focus === route;
      const color = focused ? efb.focus : routeColor(route, plane);
      drawArc(points, { color, weight: focused ? 3.6 : 2.6, opacity: 1 },
        { color: focused ? routeColor(route, plane) : efb.casing, weight: focused ? 9 : 6, opacity: focused ? .35 : .75 });
      markAlong(points, .62, "➤", "efb-arrow", color, true);
      if (focused) markAlong(points, .45, nm(miles), "efb-distance", null, false);
    }
  }

  // Plano de voo: magenta com contorno, setas de sentido e distância de cada trecho.
  for (const leg of state.plan) {
    if (!valid(leg)) continue;
    const points = arc(leg.origin, leg.destination);
    drawArc(points, { color: efb.plan, weight: 4, opacity: 1 }, { color: efb.planCasing, weight: 10, opacity: .9 });
    markAlong(points, .64, "➤", "efb-arrow", efb.plan, true);
    markAlong(points, .42, nm(distance(leg.origin, leg.destination)), "efb-distance on-plan", null, false);
  }

  const network = networkAirports();
  const planStops = new Set(state.plan.flatMap(leg => [leg.origin, leg.destination]));
  const destinations = new Set(origin ? listed.map(item => item.route.destination) : []);
  for (const code of airportCodes) {
    if (!airports[code]) continue;
    const planes = fleet.filter(item => item.airport === code);
    const outside = planes.length && !network.has(code);
    const important = hubs.has(code) || code === origin || planStops.has(code) || destinations.has(code) || outside;
    const classes = ["efb-apt", hubs.has(code) ? "hub" : "", code === origin ? "origin" : "", planStops.has(code) ? "on-plan" : "",
      outside ? "alert" : "", important ? "" : "minor"].filter(Boolean).join(" ");
    const tip = element("span", "", code + " · " + airports[code].name + (planes.length ? " · " + planes.length + T(" na frota", " in fleet") : "") +
      (outside ? T(" · fora da rede", " · outside the network") : ""));
    for (const offset of offsets) {
      const icon = element("div", classes);
      icon.append(element("i"), element("b", "", code));
      if (planes.length) icon.append(element("em", "", String(planes.length)));
      L.marker([airports[code].lat, airports[code].lon + offset], {
        icon: L.divIcon({ className: "efb-apt-icon", html: icon, iconSize: [0, 0] }),
        zIndexOffset: code === origin ? 2000 : important ? 1000 : 0, keyboard: false,
      }).bindTooltip(tip, { className: "efb-tip", direction: "top", offset: [0, -10] })
        .on("click", () => chooseAirport(code)).addTo(markers);
    }
  }
}

// Enquadra a origem e os destinos visíveis, com longitudes próximas da origem.
function frame(listed) {
  if (!map) return;
  const origin = currentOrigin();
  const shown = state.focus ? [state.focus] : state.plan.length ? state.plan : listed.map(item => item.route);
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

const reachText = () => ({
  ok: [T("Dentro do alcance", "Within range"), "ok"],
  limite: [T("No limite do alcance", "At the edge of range"), "warn"],
  fora: [T("Fora do alcance", "Out of range"), "bad"],
  "sem-dados": [T("Alcance não cadastrado", "Range not on file"), "neutral"],
});

function reachTag(plane, miles) {
  const status = reach(plane, miles);
  const performance = performanceOf(plane.model);
  const [label, tone] = reachText()[status];
  return element("span", "tag " + tone, label +
    (performance && status !== "ok" ? T(" · máx. ≈ ", " · max ≈ ") + number.format(performance.range) + " nm" : ""));
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
  if (currentOrigin()) head.append(button(T("Adicionar ao plano", "Add to plan"), "secondary small", () => addLeg(route)));
  row.append(head);
  row.append(element("span", "meta", [route.code, placeName(route.destination), nm(miles),
    blockLabel(miles, plane, route.origin, route.destination)].filter(Boolean).join(" · ")));
  if (plane) {
    row.append(reachTag(plane, miles));
  } else if (currentOrigin()) {
    const able = fleet.filter(item => item.airport === route.origin && !unavailable(item) &&
      ["ok", "limite"].includes(reach(item, miles)));
    row.append(element("span", "meta", able.length
      ? T("Aeronaves aqui que alcançam: ", "Aircraft here that can make it: ") + able.map(item => item.prefix + " (" + item.model + ")").join(", ")
      : T("Nenhuma aeronave disponível aqui alcança este trecho.", "No available aircraft here can fly this leg.")));
  }
  const status = coverage.get(route)?.status;
  if (!plane && status === "comprar") row.append(element("span", "tag bad", T("Nenhuma aeronave da frota alcança esta rota", "No aircraft in the fleet can fly this route")));
  const actions = element("div", "plan-actions share-action");
  actions.append(button(T("Compartilhar voo", "Share flight"), "secondary small", () => openShare([route], plane)));
  row.append(actions);
  return row;
}

function fleetRow(plane) {
  const row = element("li", unavailable(plane) ? "unavailable" : "");
  row.append(button(plane.prefix + " · " + plane.model, "item-heading", () => chooseAircraft(plane.prefix)));
  const performance = performanceOf(plane.model);
  row.append(element("span", "meta", T("Local exibido: ", "Shown at: ") + plane.airport + " · Hangar: " + (plane.base || T("não informado", "not given")) +
    (performance ? T(" · alcance ≈ ", " · range ≈ ") + number.format(performance.range) + " nm" : "")));
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
  title.append(element("p", "eyebrow", T("PLANO DE TRECHOS", "LEG PLAN")),
    element("strong", "", [state.plan[0].origin, ...state.plan.map(route => route.destination)].join(" → ")));
  const actions = element("div", "plan-actions");
  actions.append(button(T("Desfazer último", "Undo last"), "secondary small", () => {
    state.plan.pop(); state.focus = null; render();
  }), button(T("Limpar plano", "Clear plan"), "secondary small", () => {
    state.plan = []; state.focus = null; render();
  }));
  actions.append(button(T("Compartilhar plano", "Share plan"), "secondary small", () => openShare([...state.plan], plane)));
  heading.append(title, actions);
  const list = element("ol", "plan-legs");
  for (const { route, miles } of legs) {
    const item = element("li");
    item.append(element("span", "", [route.code === "Traslado" ? T("Traslado", "Ferry") : route.code,
      route.origin + " → " + route.destination, nm(miles),
      blockLabel(miles, plane, route.origin, route.destination)].filter(Boolean).join(" · ")));
    if (plane && reach(plane, miles) !== "ok") item.append(reachTag(plane, miles));
    list.append(item);
  }
  const total = legs.reduce((sum, leg) => sum + (leg.miles ?? 0), 0);
  const times = VortexTimes.summary(legs.map(leg => blockEstimate(leg.miles, plane, leg.route.origin, leg.route.destination)));
  const totalTime = times.minutes !== null ? " · " + clock(times.minutes) + T(" de duração estimada · ", " estimated duration · ") + timeBasis(times) : "";
  planBox.append(heading, list, element("p", "meta", "Total: " + nm(total) + T(" em ", " in ") + legs.length +
    (legs.length > 1 ? T(" trechos", " legs") : T(" trecho", " leg")) +
    (plane ? totalTime : T(" · escolha uma aeronave para checar alcance e tempo", " · pick an aircraft to check range and time"))));
}

function render(moveMap = true) {
  const plane = selectedPlane();
  const origin = currentOrigin();
  const listed = listedRoutes();
  const airportFleet = fleet.filter(item => !origin || item.airport === origin);
  airportSelect.value = state.origin;
  aircraftSelect.value = state.prefix;
  document.querySelector("#selection").textContent = [plane?.prefix,
    origin && (plane || state.plan.length ? T("a partir de ", "from ") + origin : origin)].filter(Boolean).join(" ") || T("Toda a rede", "Whole network");
  let detail = origin ? airportName(origin) : T("Rotas cadastradas e frota do levantamento", "Registered routes and fleet from the last sync");
  if (plane) {
    const performance = performanceOf(plane.model);
    detail = plane.model + T(" · Posição no PilOps: ", " · Position on PilOps: ") + plane.airport + " · Hangar: " + (plane.base || T("não informado", "not given")) +
      " · " + statusLabel(plane.status) + (performance
        ? T(" · Alcance ≈ ", " · Range ≈ ") + number.format(performance.range) + T(" nm, cruzeiro ≈ ", " nm, cruise ≈ ") + performance.speed + " kt"
        : T(" · Alcance não cadastrado para este modelo", " · No range on file for this model")) + ".";
    if (unavailable(plane)) detail += T(" Aeronave indisponível agora.", " Aircraft unavailable right now.");
    if (origin && origin !== plane.airport) detail += T(" Planejando a partir de " + origin + ", não da posição atual.",
      " Planning from " + origin + ", not from its current position.");
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
      ? T("Nenhuma rota cadastrada com partida de " + origin + ".", "No registered route departs from " + origin + ".")
      : T("Nenhuma aeronave da Vortex está em " + origin + " neste levantamento.", "No Vortex aircraft is at " + origin + " in this sync.")));
  }
  renderPlan();
  drawMap(listed);
  if (moveMap) frame(listed);
  renderSuggestions();
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

// ---------- Aeronaves fora da rede ----------

// Rede = aeroportos de onde parte pelo menos uma rota cadastrada. Fora dela a aeronave não consegue
// voar nenhuma rota VTX sem antes fazer um traslado.
const networkAirports = () => new Set(routes.map(route => route.origin));
const isRegistered = (origin, destination) => routes.some(route => route.origin === origin && route.destination === destination);
const canFly = (plane, origin, destination) => ["ok", "limite"].includes(reach(plane, distance(origin, destination)));

// Voo lido mais recente que levou a aeronave até onde ela está agora.
function lastArrival(plane) {
  return flightLog.filter(flight => flight.prefix === plane.prefix && flight.destination === plane.airport)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

// Aeroportos da rede ao alcance, primeiro os que têm rota sem aeronave capaz livre na origem.
function repositionOptions(plane) {
  return [...networkAirports()].filter(code => airports[code] && code !== plane.airport).map(code => {
    const miles = distance(plane.airport, code);
    const flyable = routes.filter(route => route.origin === code && canFly(plane, route.origin, route.destination));
    const needed = flyable.filter(route => !coverage.get(route)?.here.length);
    return { code, miles, flyable, needed, minutes: blockMinutes(miles, plane, plane.airport, code) };
  }).filter(option => canFly(plane, plane.airport, option.code) && option.flyable.length)
    .sort((a, b) => (b.needed.length > 0) - (a.needed.length > 0) || a.miles - b.miles)
    .map(option => ({ ...option, hangar: option.code === plane.base }))
    .filter((option, index, all) => index < 3 || option.hangar); // as 3 melhores + o hangar da aeronave, se estiver na rede
}

function planFerry(plane, code) {
  Object.assign(state, { prefix: plane.prefix, origin: plane.airport, focus: null, tab: "routes",
    plan: [{ origin: plane.airport, destination: code, code: "Traslado" }] });
  render();
  document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function pilotBadge(name, kind) {
  const warning = kind === "outside", approved = kind === "return";
  const badge = element("strong", warning ? "pilot-alert" : approved ? "pilot-approved" : "",
    (warning ? "⚠ " : approved ? "✓ " : "") + "@" + name);
  badge.title = warning ? T("Voo deixou a aeronave fora da malha", "Flight left the aircraft outside the network")
    : approved ? T("Retorno à malha: aeronave trazida de volta para um aeroporto com rotas da Vortex",
      "Network return: aircraft brought back to an airport with Vortex routes")
    : T("Piloto identificado no voo registrado", "Pilot identified in the recorded flight");
  return badge;
}

function renderAlerts() {
  const list = document.querySelector("#alerts");
  if (!list) return;
  const network = networkAirports();
  const outside = fleet.filter(plane => !network.has(plane.airport));
  const movements = flightLog.map(flight => ({ flight, kind: VortexMovements.classify(flight, routes) }))
    .filter(item => item.kind !== "registered").sort((a, b) => b.flight.date.localeCompare(a.flight.date));
  const warnings = movements.filter(item => item.kind === "outside");

  const alert = document.querySelector("#fleet-alert");
  alert.replaceChildren();
  alert.hidden = !outside.length && !warnings.length;
  if (!alert.hidden) {
    alert.append(button("⚠ " + [outside.length && outside.length + (outside.length > 1 ? T(" aeronaves fora da rede", " aircraft outside the network")
      : T(" aeronave fora da rede", " aircraft outside the network")),
      warnings.length && warnings.length + (warnings.length > 1 ? T(" voos deixaram aeronaves fora da rede", " flights left aircraft outside the network")
        : T(" voo deixou aeronave fora da rede", " flight left an aircraft outside the network"))]
      .filter(Boolean).join(" · ") + T(" — ver avisos", " — see alerts"), "alert-link",
      () => document.querySelector("#alerts-card").scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  document.querySelector("#alerts-summary").textContent = (outside.length
    ? T(outside.length + (outside.length > 1 ? " aeronaves estão em aeroportos" : " aeronave está em aeroporto") +
      " sem nenhuma rota cadastrada de partida. Abaixo, quem levou cada uma até lá (quando o voo foi lido) e para onde reposicionar.",
      outside.length + (outside.length > 1 ? " aircraft are at airports" : " aircraft is at an airport") +
      " with no registered departing route. Below: who flew each one there (when the flight was read) and where to reposition it.")
    : T("Todas as aeronaves estão em aeroportos com rotas cadastradas de partida.", "All aircraft are at airports with registered departing routes.")) +
      T(" Retornos de aeroportos fora da malha recebem selo verde de aprovação; traslados entre aeroportos da malha são neutros. A classificação usa a malha atual e não presume intenção ou autorização do piloto.",
        " Returns from airports outside the network receive a green approval badge; ferries between network airports are neutral. Classification uses the current network and does not assume the pilot’s intent or authorization.");

  const rows = [];
  for (const plane of outside) {
    const row = element("li");
    const head = element("div", "row-head");
    head.append(button(plane.prefix + " · " + plane.model, "item-heading", () => chooseAircraft(plane.prefix)));
    head.append(element("span", "tag bad", T("Fora da rede em ", "Outside the network at ") + plane.airport));
    row.append(head);
    const place = airports[plane.airport];
    row.append(element("span", "meta", (place ? place.name + " · " + countryName(place.country) : plane.airport) +
      (hubs.has(plane.airport) ? T(" · hub sem rotas de partida", " · hub with no departing routes") : "") + " · " + statusLabel(plane.status) +
      (plane.base ? T(" · hangar em ", " · hangar at ") + plane.base : "")));
    const arrival = lastArrival(plane);
    const who = element("span", "meta who");
    if (arrival) {
      who.append(T("Levada até " + plane.airport + " por ", "Flown to " + plane.airport + " by "),
        pilotBadge(arrival.pilot, VortexMovements.classify(arrival, routes)),
        T(" em ", " on ") + dayText(arrival.date) + T(" (voo ", " (flight ") + arrival.origin + " → " +
        arrival.destination + (isRegistered(arrival.origin, arrival.destination) ? ")." : T(", fora das rotas cadastradas).", ", off the registered routes).")));
    } else {
      who.textContent = T("Chegou a " + plane.airport + " antes dos voos lidos" + (flightsSince ? " (desde " + dayText(flightsSince) + ")" : "") +
        ": o piloto responsável não aparece no histórico do PilOps.",
        "Reached " + plane.airport + " before the flights read" + (flightsSince ? " (since " + dayText(flightsSince) + ")" : "") +
        ": the pilot responsible does not appear in the PilOps history.");
    }
    row.append(who);
    const options = repositionOptions(plane);
    const box = element("div", "ferries");
    if (!options.length) {
      box.append(element("span", "meta", T("Nenhum aeroporto da rede ao alcance desta aeronave sem escala.",
        "No network airport is within this aircraft's range without a stop.")));
    }
    for (const option of options) {
      const line = element("div", "ferry");
      line.append(element("span", "", T("Traslado para ", "Ferry to ") + option.code + " (" + placeName(option.code) + ") · " +
        nm(option.miles) + (option.minutes ? " · " + blockLabel(option.miles, plane, plane.airport, option.code) : "") + " · " +
        (option.needed.length ? option.needed.length + (option.needed.length > 1 ? T(" rotas sem aeronave livre ali", " routes with no free aircraft there")
          : T(" rota sem aeronave livre ali", " route with no free aircraft there"))
          : option.flyable.length + (option.flyable.length > 1 ? T(" rotas de partida", " departing routes") : T(" rota de partida", " departing route")))));
      if (option.needed.length) line.append(element("span", "tag ok", T("Necessária", "Needed")));
      if (option.hangar) line.append(element("span", "tag neutral", T("Hangar da aeronave", "Aircraft's hangar")));
      line.append(button(T("Planejar traslado", "Plan ferry"), "secondary small", () => planFerry(plane, option.code)));
      box.append(line);
    }
    row.append(box);
    rows.push(row);
  }
  for (const [kind, label, english] of [
    ["outside", "Voos que deixaram aeronaves fora da malha", "Flights that left aircraft outside the network"],
    ["return", "✓ Retornos à malha · aprovação", "✓ Network returns · approval"],
    ["reposition", "Traslados entre aeroportos da malha · sem advertência", "Ferries between network airports · no warning"],
  ]) {
    const group = movements.filter(item => item.kind === kind);
    if (!group.length) continue;
    rows.push(element("li", "group", T(label, english)));
    for (const { flight } of group) {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(element("strong", "", flight.origin + " → " + flight.destination));
      if (kind === "outside") head.append(element("span", "tag bad", T("Deixou a aeronave fora da rede", "Left the aircraft outside the network")));
      else if (kind === "return") head.append(element("span", "tag ok", T("✓ Retorno à malha", "✓ Network return")));
      else head.append(element("span", "tag neutral", T("Reposicionamento na malha", "Network repositioning")));
      const details = element("span", "meta");
      details.append(dayText(flight.date) + " · ", pilotBadge(flight.pilot, kind), " · " + flight.prefix + " (" + flight.model + ") · " + nm(flight.nm));
      row.append(head, details);
      rows.push(row);
    }
  }
  if (!rows.length) rows.push(element("li", "meta", T("Nenhum aviso no momento.", "No alerts right now.")));
  list.replaceChildren(...rows);
}

// ---------- Sugestões de rotas ----------

const continentNames = {
  pt: { SA: "Sul-americana", NA: "Norte-americana", EU: "Europeia", AS: "Asiática", AF: "Africana", OC: "Oceânica", AN: "Antártica" },
  en: { SA: "South American", NA: "North American", EU: "European", AS: "Asian", AF: "African", OC: "Oceanian", AN: "Antarctic" },
};
const regionNames = {};
function countryName(code) {
  try {
    regionNames[lang] ||= new Intl.DisplayNames([locale()], { type: "region" });
    return regionNames[lang].of(code);
  } catch { return code; }
}

// nacional: um só país · continental: um só continente · intercontinental: mais de um continente.
function scopeOf(codes) {
  const places = codes.map(code => airports[code]);
  if (places.some(place => !place?.country)) return { kind: "indefinida", label: T("Sem classificação", "Unclassified") };
  const countries = new Set(places.map(place => place.country));
  const continents = new Set(places.map(place => place.continent));
  if (countries.size === 1) return { kind: "nacional", label: T("Nacional · ", "Domestic · ") + countryName([...countries][0]) };
  if (continents.size === 1) return { kind: "continental", label: continentNames[lang][[...continents][0]] || "Continental" };
  return { kind: "intercontinental", label: "Intercontinental" };
}

// Para aeroportos isolados, do ponto de vista de uma companhia brasileira:
// nacional = Brasil · continental = resto da América do Sul · intercontinental = fora dela.
const airportScope = code => airports[code]?.country === "BR" ? "nacional"
  : airports[code]?.continent === "SA" ? "continental" : "intercontinental";

const flownPairs = () => {
  const counts = new Map();
  for (const flight of flightLog) {
    const key = flight.origin + "-" + flight.destination;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

// Ciclos simples (sem repetir aeroporto) de 2 a 6 trechos usando só rotas cadastradas.
function findCircuits(maxLegs = 6, maxCircuits = 300) {
  const byOrigin = new Map();
  for (const route of routes) {
    if (!byOrigin.has(route.origin)) byOrigin.set(route.origin, []);
    byOrigin.get(route.origin).push(route);
  }
  const found = new Map();
  const walk = (start, legs) => {
    if (found.size >= maxCircuits) return;
    const here = legs.length ? legs.at(-1).destination : start;
    const visited = new Set([start, ...legs.map(leg => leg.destination)]);
    for (const route of byOrigin.get(here) || []) {
      if (route.destination === start && legs.length >= 1) {
        const cycle = [...legs, route];
        // Mesma sequência de aeroportos, girada, é o mesmo circuito.
        const stops = cycle.map(leg => leg.origin);
        const turn = stops.indexOf([...stops].sort()[0]);
        const key = [...stops.slice(turn), ...stops.slice(0, turn)].join("-");
        if (!found.has(key)) found.set(key, cycle);
      } else if (!visited.has(route.destination) && legs.length + 1 < maxLegs) {
        walk(start, [...legs, route]);
      }
    }
  };
  for (const start of byOrigin.keys()) walk(start, []);
  return [...found.values()].map(legs => {
    const miles = legs.map(leg => distance(leg.origin, leg.destination));
    return { legs, miles, total: miles.reduce((sum, value) => sum + (value ?? 0), 0),
      longest: Math.max(...miles.map(value => value ?? Infinity)), scope: scopeOf(legs.map(leg => leg.origin)) };
  });
}

// Gira o circuito para começar num aeroporto escolhido, num hub com aeronave pronta, ou num hub.
function circuitFrom(circuit, start) {
  const stops = circuit.legs.map(leg => leg.origin);
  const capable = fleet.filter(plane => !unavailable(plane) && ["ok", "limite"].includes(reach(plane, circuit.longest)));
  const pick = start && stops.includes(start) ? start
    : stops.find(code => hubs.has(code) && capable.some(plane => plane.airport === code)) ||
      stops.find(code => capable.some(plane => plane.airport === code)) ||
      stops.find(code => hubs.has(code)) || stops[0];
  const turn = stops.indexOf(pick);
  const legs = [...circuit.legs.slice(turn), ...circuit.legs.slice(0, turn)];
  const miles = [...circuit.miles.slice(turn), ...circuit.miles.slice(0, turn)];
  const ready = capable.filter(plane => plane.airport === pick);
  const anyCapable = fleet.filter(plane => ["ok", "limite"].includes(reach(plane, circuit.longest)));
  return { ...circuit, legs, miles, start: pick, capable, ready, anyCapable };
}

function scopeMatches(scope) {
  return ideas.scope === "todas" || scope.kind === ideas.scope;
}

function suggestionChip(kind, label, count) {
  const chip = button(label + " (" + count + ")", "chip", () => { ideas.scope = kind; ideas.limit = 12; renderSuggestions(); });
  chip.setAttribute("aria-pressed", String(ideas.scope === kind));
  return chip;
}

function circuitRow(circuit, pairs) {
  const row = element("li");
  const head = element("div", "row-head");
  head.append(element("strong", "circuit", [circuit.start, ...circuit.legs.map(leg => leg.destination)].join(" → ")));
  const plane = circuit.ready[0] || circuit.capable[0] || null;
  head.append(button(T("Montar no plano", "Build plan"), "secondary small", () => {
    Object.assign(state, { origin: circuit.start, prefix: plane?.prefix || "", plan: [...circuit.legs], focus: null, tab: "routes" });
    render();
    document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  row.append(head);
  const times = VortexTimes.summary(plane ? circuit.legs.map((leg, i) => blockEstimate(circuit.miles[i], plane, leg.origin, leg.destination)) : []);
  const total = times.minutes !== null
    ? clock(times.minutes) + T(" de duração estimada com ", " estimated duration with ") + plane.model + " · " + timeBasis(times) : "";
  row.append(element("span", "meta", [circuit.legs.length + T(" trechos", " legs"), nm(circuit.total),
    T("maior trecho ", "longest leg ") + nm(circuit.longest), total].filter(Boolean).join(" · ")));
  const never = circuit.legs.filter(leg => !pairs.has(leg.origin + "-" + leg.destination)).length;
  const tags = element("div", "tags");
  tags.append(element("span", "tag neutral", circuit.scope.label));
  if (circuit.ready.length) {
    tags.append(element("span", "tag ok", T("Pronta em ", "Ready at ") + circuit.start + ": " + circuit.ready.map(p => p.prefix).join(", ")));
  } else if (circuit.capable.length) {
    tags.append(element("span", "tag warn", T("Aeronave capaz em outro aeroporto: ", "Capable aircraft at another airport: ") +
      circuit.capable.slice(0, 3).map(p => p.prefix + T(" em ", " at ") + p.airport).join(", ")));
  } else if (circuit.anyCapable.length) {
    tags.append(element("span", "tag warn", T("Só com aeronave indisponível agora", "Only with an aircraft that is unavailable now")));
  } else {
    tags.append(element("span", "tag bad", T("A frota não alcança o maior trecho", "The fleet cannot fly the longest leg")));
  }
  if (never) tags.append(element("span", "tag warn", never === circuit.legs.length ? T("Nenhum trecho voado ainda", "No leg flown yet")
    : never + (never > 1 ? T(" trechos nunca voados", " legs never flown") : T(" trecho nunca voado", " leg never flown"))));
  row.append(tags);
  return row;
}

function renderSuggestions() {
  const list = document.querySelector("#ideas");
  if (!list || !routes.length) return;
  const pairs = flownPairs();
  const start = state.origin || null;
  const routeScopes = routes.map(route => ({ route, scope: scopeOf([route.origin, route.destination]) }));
  const visibleCircuits = circuits.filter(circuit => !start || circuit.legs.some(leg => leg.origin === start))
    .map(circuit => circuitFrom(circuit, start));

  // Filtros por tipo, com contagem do que a aba atual mostra.
  const scopeSource = ideas.view === "circuitos" ? visibleCircuits.map(c => c.scope)
    : ideas.view === "pilotos" ? routeScopes.filter(item => !pairs.has(item.route.origin + "-" + item.route.destination)).map(item => item.scope)
      : airportCodes.filter(code => airports[code]).map(code => ({ kind: airportScope(code) }));
  const count = kind => scopeSource.filter(scope => kind === "todas" || scope.kind === kind).length;
  document.querySelector("#idea-scopes").replaceChildren(
    suggestionChip("todas", T("Todas", "All"), count("todas")), suggestionChip("nacional", T("Nacionais", "Domestic"), count("nacional")),
    suggestionChip("continental", T("Continentais", "Continental"), count("continental")),
    suggestionChip("intercontinental", T("Intercontinentais", "Intercontinental"), count("intercontinental")));
  for (const tabButton of document.querySelectorAll("#idea-tabs button")) {
    tabButton.setAttribute("aria-pressed", String(tabButton.dataset.view === ideas.view));
  }

  const summary = document.querySelector("#ideas-summary");
  const rows = [];
  if (ideas.view === "circuitos") {
    const order = circuit => circuit.ready.length ? 0 : circuit.capable.length ? 1 : circuit.anyCapable.length ? 2 : 3;
    const shown = visibleCircuits.filter(circuit => scopeMatches(circuit.scope))
      .sort((a, b) => order(a) - order(b) || b.legs.length - a.legs.length || a.total - b.total);
    summary.textContent = T((start ? "Circuitos que começam e terminam em " + start + ". " : "Escolha um aeroporto de partida no filtro acima para ver só os circuitos que saem e voltam a ele. ") +
      shown.length + (shown.length === 1 ? " circuito fechado" : " circuitos fechados") + " com rotas já cadastradas na Vortex.",
      (start ? "Circuits that start and end at " + start + ". " : "Pick a departure airport in the filter above to see only the circuits that leave from and return to it. ") +
      shown.length + (shown.length === 1 ? " closed circuit" : " closed circuits") + " made of routes already registered at Vortex.");
    rows.push(...shown.slice(0, ideas.limit).map(circuit => circuitRow(circuit, pairs)));
    if (shown.length > ideas.limit) {
      const more = element("li", "more");
      more.append(button(T("Mostrar mais ", "Show ") + Math.min(12, shown.length - ideas.limit) + T(" de ", " more of ") + (shown.length - ideas.limit),
        "secondary small", () => { ideas.limit += 12; renderSuggestions(); }));
      rows.push(more);
    }
  } else if (ideas.view === "pilotos") {
    const order = { pronta: 0, reposicionar: 1, indisponivel: 2, comprar: 3 };
    const waiting = routeScopes.filter(item => !pairs.has(item.route.origin + "-" + item.route.destination) && scopeMatches(item.scope))
      .map(item => ({ ...item, cover: coverage.get(item.route) }))
      .sort((a, b) => order[a.cover.status] - order[b.cover.status] || (b.cover.miles ?? 0) - (a.cover.miles ?? 0));
    summary.textContent = T("Rotas cadastradas sem nenhum voo registrado " + (flightsSince ? "desde " + dayText(flightsSince) : "nas coletas") +
      ". As de aeronave pronta na origem só esperam um piloto.",
      "Registered routes with no flight recorded " + (flightsSince ? "since " + dayText(flightsSince) : "in the syncs") +
      ". Those with an aircraft ready at the origin are just waiting for a pilot.");
    rows.push(...waiting.map(item => {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(button(item.route.origin + " → " + item.route.destination, "item-heading", () => {
        Object.assign(state, { origin: item.route.origin, plan: [], focus: item.route, tab: "routes" });
        render(false);
        frame(listedRoutes());
        document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      const [coverLabel, coverTone] = coverageText()[item.cover.status];
      head.append(element("span", "tag " + coverTone, coverLabel));
      row.append(head, element("span", "meta", item.route.code + " · " + nm(item.cover.miles) + " · " + item.scope.label +
        (item.cover.here.length ? T(" · livre na origem: ", " · free at the origin: ") + item.cover.here.map(p => p.prefix).join(", ") : "")));
      return row;
    }));
    if (!waiting.length) rows.push(element("li", "meta", T("Todas as rotas deste tipo já têm voo registrado.", "Every route of this type already has a recorded flight.")));
  } else {
    // Movimentos = pousos + decolagens nos voos lidos.
    const moves = new Map(airportCodes.map(code => [code, 0]));
    for (const flight of flightLog) {
      for (const code of [flight.origin, flight.destination]) moves.set(code, (moves.get(code) || 0) + 1);
    }
    const items = [...moves].map(([code, total]) => ({ code, total, scope: scopeOf([code]),
      planes: fleet.filter(plane => plane.airport === code).length,
      departures: routes.filter(route => route.origin === code).length }))
      .filter(item => airports[item.code]);
    const filtered = items.filter(item => ideas.scope === "todas" || airportScope(item.code) === ideas.scope);
    const most = [...filtered].filter(item => item.total).sort((a, b) => b.total - a.total).slice(0, 6);
    const least = [...filtered].sort((a, b) => a.total - b.total || b.departures - a.departures).slice(0, 8);
    summary.textContent = T("Pousos e decolagens nos " + flightLog.length + " voos lidos" +
      (flightsSince ? " desde " + dayText(flightsSince) : "") + ". Aeroportos pouco voados são boas oportunidades de voo." +
      (ideas.scope === "nacional" ? " Filtro: aeroportos no Brasil." : ideas.scope === "continental" ? " Filtro: resto da América do Sul." :
        ideas.scope === "intercontinental" ? " Filtro: fora da América do Sul." : ""),
      "Landings and take-offs in the " + flightLog.length + " flights read" +
      (flightsSince ? " since " + dayText(flightsSince) : "") + ". Rarely flown airports are good flight opportunities." +
      (ideas.scope === "nacional" ? " Filter: airports in Brazil." : ideas.scope === "continental" ? " Filter: rest of South America." :
        ideas.scope === "intercontinental" ? " Filter: outside South America." : ""));
    const airportRow = item => {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(button(item.code + " · " + placeName(item.code), "item-heading", () => chooseAirport(item.code)));
      head.append(element("span", "tag " + (item.total ? "neutral" : "warn"), item.total
        ? item.total + (item.total > 1 ? T(" movimentos", " movements") : T(" movimento", " movement")) : T("Nunca voado", "Never flown")));
      row.append(head, element("span", "meta", airportName(item.code) + " · " + countryName(airports[item.code].country) + " · " +
        item.departures + (item.departures === 1 ? T(" rota de partida", " departing route") : T(" rotas de partida", " departing routes")) + " · " +
        item.planes + (item.planes === 1 ? T(" aeronave aqui", " aircraft here") : T(" aeronaves aqui", " aircraft here"))));
      return row;
    };
    rows.push(element("li", "group", T("Mais voados", "Most flown")),
      ...(most.length ? most.map(airportRow) : [element("li", "meta", T("Nenhum voo lido ainda.", "No flights read yet."))]),
      element("li", "group", T("Menos voados", "Least flown")), ...least.map(airportRow));
  }
  list.replaceChildren(...rows);
}

for (const tabButton of document.querySelectorAll("#idea-tabs button")) {
  tabButton.addEventListener("click", () => { ideas.view = tabButton.dataset.view; ideas.limit = 12; renderSuggestions(); });
}

// ---------- Frota × rotas ----------

// comprar: nenhum modelo da frota tem alcance · indisponivel: só aeronaves em uso/manutenção alcançam ·
// reposicionar: há aeronave capaz livre, mas não na origem · pronta: há aeronave capaz livre na origem.
function routeCoverage(route) {
  const miles = distance(route.origin, route.destination);
  const capable = fleet.filter(plane => ["ok", "limite"].includes(reach(plane, miles)));
  const free = capable.filter(plane => !unavailable(plane));
  const here = free.filter(plane => plane.airport === route.origin);
  const status = !capable.length ? "comprar" : !free.length ? "indisponivel" : !here.length ? "reposicionar" : "pronta";
  // Modelos que alcançam a rota, ordenados pelo alcance e pelo nome.
  const options = miles === null ? [] : aircraftCatalog.filter(item => item.range >= miles).sort((a, b) => a.range - b.range || a.name.localeCompare(b.name));
  return { route, miles, capable, free, here, status, options };
}

const coverageText = () => ({
  comprar: [T("Precisa comprar", "Needs a purchase"), "bad"],
  indisponivel: [T("Só com aeronave indisponível", "Only with an unavailable aircraft"), "warn"],
  reposicionar: [T("Reposicionar aeronave", "Reposition an aircraft"), "warn"],
  pronta: [T("Pronta para voar", "Ready to fly"), "ok"],
});

function renderCoverage() {
  const order = { comprar: 0, indisponivel: 1, reposicionar: 2, pronta: 3 };
  const items = [...coverage.values()].sort((a, b) => order[a.status] - order[b.status] || (b.miles ?? 0) - (a.miles ?? 0));
  const counts = items.reduce((acc, item) => (acc[item.status] = (acc[item.status] || 0) + 1, acc), {});
  document.querySelector("#coverage-summary").textContent = [
    counts.comprar && counts.comprar + (counts.comprar > 1 ? T(" rotas precisam de aeronave que a frota não tem", " routes need an aircraft the fleet does not have")
      : T(" rota precisa de aeronave que a frota não tem", " route needs an aircraft the fleet does not have")),
    counts.indisponivel && counts.indisponivel + T(" só com aeronave em uso ou manutenção", " only with an aircraft in use or in maintenance"),
    counts.reposicionar && counts.reposicionar + T(" com aeronave capaz em outro aeroporto", " with a capable aircraft at another airport"),
    counts.pronta && counts.pronta + (counts.pronta > 1 ? T(" prontas para voar", " ready to fly") : T(" pronta para voar", " ready to fly")),
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
    const [coverLabel, coverTone] = coverageText()[item.status];
    head.append(element("span", "tag " + coverTone, coverLabel));
    row.append(head, element("span", "meta", item.route.code + " · " + nm(item.miles)));
    const models = list => [...new Set(list.map(plane => plane.model))].join(", ");
    let detail;
    if (item.status === "comprar") {
      const models = item.options.slice(0, 5).map(option => option.name);
      detail = models.length
        ? T("Nenhum modelo da frota tem esse alcance. No PilOps, alcançam: ", "No model in the fleet has that range. On PilOps, these can make it: ") +
          models.join(", ") + (item.options.length > 5 ? T(" e mais ", " and ") + (item.options.length - 5) + T(" modelos", " more models") : "") + "."
        : T("Nenhum modelo do catálogo do PilOps tem esse alcance sem escala.", "No model in the PilOps catalogue has that range non-stop.");
    } else if (item.status === "indisponivel") {
      detail = T("Alcançam, mas estão indisponíveis agora: ", "They can make it, but are unavailable now: ") +
        item.capable.map(p => p.prefix + " (" + statusLabel(p.status).toLowerCase() + ")").join(", ") + ".";
    } else if (item.status === "reposicionar") {
      detail = T("Capazes e livres em outros aeroportos: ", "Capable and free at other airports: ") +
        item.free.map(p => p.prefix + T(" em ", " at ") + p.airport).join(", ") + T(". Modelos: ", ". Models: ") + models(item.free) + ".";
    } else {
      detail = T("Livres em ", "Free at ") + item.route.origin + ": " + item.here.map(p => p.prefix + " (" + p.model + ")").join(", ") + ".";
    }
    row.append(element("span", "meta", detail));
    return row;
  }));
}

// ---------- Ranking de pilotos ----------

const hoursText = minutes => Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0");
const dayText = iso => !iso ? "—" : lang === "en"
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T12:00:00Z"))
  : iso.split("-").reverse().join("/");
const ranking = { key: "companyMinutes", desc: true };

function pilotStats() {
  const registered = new Set(routes.map(route => route.origin + "-" + route.destination));
  const rows = new Map(pilots.map(p => [p.name, { ...p, flights: 0, minutes: 0, nm: 0, vtx: new Set(), last: null, member: true }]));
  for (const flight of flightLog) {
    if (!rows.has(flight.pilot)) {
      rows.set(flight.pilot, { name: flight.pilot, role: null, level: null, totalMinutes: null, companyMinutes: null,
        joined: null, flights: 0, minutes: 0, nm: 0, vtx: new Set(), last: null, member: false });
    }
    const row = rows.get(flight.pilot);
    row.flights++;
    row.minutes += flight.minutes;
    row.nm += flight.nm;
    const pair = flight.origin + "-" + flight.destination;
    if (registered.has(pair)) row.vtx.add(pair);
    if (!row.last || flight.date > row.last) row.last = flight.date;
  }
  return [...rows.values()].map(row => ({ ...row, vtxCount: row.vtx.size }));
}

const rankingColumns = () => [
  ["name", T("Piloto", "Pilot")],
  ["cycleFlights", T("Voos na janela de 30 dias*", "Flights in the 30-day window*")],
  ["cycleDays", T("Prazo da janela", "Window deadline")],
  ["companyMinutes", T("Horas na Vortex (total)", "Hours at Vortex (total)")],
  ["flights", T("Voos lidos*", "Flights read*")],
  ["minutes", T("Horas nos voos lidos*", "Hours in flights read*")],
  ["nm", T("Distância*", "Distance*")],
  ["vtxCount", T("Rotas VTX*", "VTX routes*")],
  ["last", T("Último voo*", "Last flight*")],
];

function renderRanking() {
  const table = document.querySelector("#ranking");
  const currentDay = VortexActivity.today();
  activityDay = currentDay;
  const window = VortexActivity.period(activityConfig, currentDay);
  const cycleCounts = VortexActivity.counts(window, flightLog, currentDay);
  renderActivity(window, cycleCounts);
  const rows = pilotStats().map(row => ({ ...row,
    cycleFlights: row.member && window?.active ? cycleCounts.get(row.name) || 0 : null,
    cycleDays: row.member && window?.active ? window.daysRemaining : null,
  })).sort((a, b) => {
    const [x, y] = [a[ranking.key], b[ranking.key]];
    const result = typeof x === "string" || typeof y === "string"
      ? String(x ?? "").localeCompare(String(y ?? ""), locale())
      : (x ?? -1) - (y ?? -1);
    return (ranking.desc ? -result : result) || (b.companyMinutes ?? -1) - (a.companyMinutes ?? -1);
  });
  const head = element("tr");
  for (const [key, title] of rankingColumns()) {
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
    if (!row.member) name.append(element("span", "tag warn", T("fora do painel", "not on the roster")));
    const activityCell = element("td", row.cycleFlights === 0 ? "activity-zero" : "");
    const deadlineCell = element("td", row.cycleFlights === 0 ? "activity-zero" : "");
    if (row.cycleFlights === null) {
      activityCell.textContent = "—";
      deadlineCell.textContent = "—";
    } else {
      activityCell.append(element("strong", "", number.format(row.cycleFlights)), element("span", "tag " + (row.cycleFlights ? "ok" : "bad"),
        row.cycleFlights ? T("Ativo na janela", "Active this window") : T("Nenhum voo registrado", "No flights recorded")));
      deadlineCell.append(element("strong", "", row.cycleDays + T(" dias restantes", " days left")),
        element("span", "meta", T("até ", "by ") + dayText(window.end)));
    }
    tr.append(name, activityCell, deadlineCell,
      element("td", "", row.companyMinutes === null ? "—" : hoursText(row.companyMinutes)),
      element("td", "", number.format(row.flights)),
      element("td", "", row.flights ? hoursText(row.minutes) : "—"),
      element("td", "", row.flights ? nm(row.nm) : "—"),
      element("td", "", row.flights ? String(row.vtxCount) : "—"),
      element("td", "", dayText(row.last)));
    return tr;
  });
  const thead = element("thead");
  thead.append(head);
  const tbody = element("tbody");
  tbody.append(...body);
  table.replaceChildren(thead, tbody);

  document.querySelector("#ranking-note").textContent = T((pilots.length ? pilots.length + " pilotos no painel do PilOps. " : "") +
    "\"Horas na Vortex (total)\" vem do PilOps e soma tudo desde a entrada do piloto na companhia. " +
    "* As colunas com asterisco contam só os voos que o planejador já leu " +
    (flightsSince ? "desde " + dayText(flightsSince) : "nas sincronizações") + " (" + flightLog.length + " voos), " +
    "por isso são bem menores: o PilOps mostra só os 10 voos mais recentes, e elas crescem a cada sincronização.",
    (pilots.length ? pilots.length + " pilots on the PilOps roster. " : "") +
    "\"Hours at Vortex (total)\" comes from PilOps and adds up everything since the pilot joined the company. " +
    "* Columns with an asterisk only count the flights the planner has already read " +
    (flightsSince ? "since " + dayText(flightsSince) : "in the syncs") + " (" + flightLog.length + " flights), " +
    "so they are much smaller: PilOps only shows the 10 most recent flights, and these columns grow with every sync.");
  const pilotsStamp = pilotsCapturedAt && Number.isFinite(Date.parse(pilotsCapturedAt))
    ? new Intl.DateTimeFormat(locale(), { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(pilotsCapturedAt))
    : null;
  document.querySelector("#ranking-note").append(document.createTextNode(pilotsStamp
    ? T(" Cadastro de pilotos lido em ", " Pilot roster read on ") + pilotsStamp + T(" (Brasília).", " (Brasília time).")
    : T(" Data da leitura do cadastro de pilotos indisponível.", " Pilot roster read time unavailable.")));

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
      item.count + (item.count > 1 ? T(" voos", " flights") : T(" voo", " flight")) + " · " + nm(item.nm) + " · " + [...item.pilots].map(p => "@" + p).join(", ")));
    return li;
  }) : [element("li", "meta", T("Nenhum voo lido ainda.", "No flights read yet."))]));
}

function renderActivity(window, counts) {
  const period = document.querySelector("#activity-period");
  const summary = document.querySelector("#activity-summary");
  const note = document.querySelector("#activity-note");
  summary.replaceChildren();
  if (!window) {
    period.textContent = T("Contador indisponível. Confira a configuração da janela.", "Counter unavailable. Check the window configuration.");
    note.textContent = "";
    return;
  }
  period.textContent = dayText(window.start) + " → " + dayText(window.end) +
    T(" · próxima janela: ", " · next window: ") + dayText(window.next) + T(" · datas de Brasília", " · Brasília dates");
  const active = pilots.filter(pilot => counts.get(pilot.name) > 0).length;
  if (window.active) {
    for (const [value, label, zero] of [[active, T("Pilotos com voo na janela", "Pilots with a flight this window"), false],
      [pilots.length - active, T("Pilotos sem voo registrado", "Pilots with no recorded flights"), pilots.length > active],
      [window.daysRemaining, T("Dias restantes, incluindo hoje", "Days left, including today"), false]]) {
      const tile = element("div", "stat" + (zero ? " activity-summary-zero" : ""));
      tile.append(element("strong", "", String(value)), element("span", "", label));
      summary.append(tile);
    }
  }
  note.textContent = T("Contador independente do desafio semanal: conta os voos concluídos lidos no histórico da companhia nesta janela. Vermelho somente com zero; um voo registrado retira o alerta. A contagem zera automaticamente a cada 30 dias. Fechar a janela com zero pode levar à exclusão, por decisão da administração. Os dados são parciais e dependem da sincronização; confirme o histórico e a data de ingresso antes de decidir.",
    "Independent of the weekly challenge: counts completed flights read from the company history in this window. Red only at zero; one recorded flight clears the alert. Counts reset automatically every 30 days. Finishing the window with zero may lead to removal at the administration’s discretion. Data is partial and depends on sync; verify the history and join date before deciding.");
}

async function start() {
  applyStaticTexts();
  try { localStorage.removeItem("vortex-simbrief-v1"); } catch { /* Limpa a integração descontinuada sem afetar a página. */ }
  document.querySelector("#snapshot-time").textContent = T("Carregando dados da Vortex…", "Loading Vortex data…");
  document.querySelector("#snapshot-note").textContent = T("A frota e as rotas vêm da última coleta no PilOps.",
    "Fleet and routes come from the last PilOps sync.");
  let data;
  try {
    // O parâmetro evita a cópia em cache do GitHub Pages e traz sempre a coleta mais recente.
    const response = await fetch("./dados.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error();
    data = await response.json();
  } catch {
    document.querySelector("#snapshot-time").textContent = T("Não foi possível carregar os dados da Vortex.", "Could not load the Vortex data.");
    document.querySelector("#snapshot-note").textContent = T("Confira a conexão e recarregue a página.", "Check your connection and reload the page.");
    return;
  }
  fleet = data.fleet;
  routes = data.routes;
  hubs = new Set(data.hubs);
  pilots = data.pilots || [];
  flightLog = data.flights || [];
  flightsSince = data.flightsSince || null;
  capturedAt = data.capturedAt || null;
  pilotsCapturedAt = data.pilotsCapturedAt || null;
  revenueMonitor = data.revenueMonitor || { readCount: 0, groups: [] };
  try {
    const response = await fetch("./operacao.json?t=" + Date.now(), { cache: "no-store" });
    if (response.ok) operationConfig = VortexOperation.read(await response.json(), routes);
  } catch { /* A operação é opcional; mapa, frota e demais seções continuam disponíveis. */ }
  try {
    const response = await fetch("./atividade.json?t=" + Date.now(), { cache: "no-store" });
    if (response.ok) activityConfig = VortexActivity.read(await response.json());
  } catch { /* Sem configuração válida, não se atribui alerta de inatividade. */ }
  coverage = new Map(routes.map(route => [route, routeCoverage(route)]));
  // Só entram no filtro e no mapa os aeroportos que a Vortex usa: posição da frota, rotas e hubs.
  airportCodes = [...new Set([
    ...hubs, ...fleet.map(plane => plane.airport),
    ...routes.flatMap(route => [route.origin, route.destination]),
  ])].filter(Boolean).sort();

  document.querySelector("#total-fleet").textContent = fleet.length;
  document.querySelector("#total-routes").textContent = routes.length;
  document.querySelector("#total-hubs").textContent = hubs.size;
  const shared = new URLSearchParams(location.search);
  const sharedRoute = routes.find(route => route.origin === shared.get("from") && route.destination === shared.get("to"));
  if (sharedRoute) {
    state.origin = sharedRoute.origin;
    state.focus = sharedRoute;
    state.prefix = fleet.some(plane => plane.prefix === shared.get("aircraft")) ? shared.get("aircraft") : "";
    const requestedLegs = (shared.get("legs") || "").split(",");
    const sharedPlan = requestedLegs.slice(0, 30).map(pair => routes.find(route => VortexOperation.pair(route) === pair));
    if (requestedLegs.length <= 30 && sharedPlan.length > 1 && sharedPlan[0] === sharedRoute &&
        sharedPlan.every((route, index) => route && (!index || sharedPlan[index - 1]?.destination === route.origin))) {
      state.plan = sharedPlan;
      state.focus = null;
    }
  }
  paintAll();
}

// Tudo o que depende do idioma: textos fixos, cabeçalho da coleta, listas dos filtros e todas as seções.
function paintAll() {
  applyStaticTexts();
  if (!fleet.length) return;
  // Em inglês a data sai por extenso ("7 Nov 2026"), sem a ambiguidade dia/mês do formato numérico.
  const date = new Intl.DateTimeFormat(locale(), {
    dateStyle: lang === "en" ? "medium" : "short", timeStyle: "short", timeZone: "America/Sao_Paulo",
  }).format(new Date(capturedAt));
  document.querySelector("#snapshot-time").textContent = T("Última coleta no PilOps · ", "Last PilOps sync · ") + date +
    T(" (Brasília)", " (Brasília time)");
  document.querySelector("#snapshot-note").textContent = T(
    fleet.length + (fleet.length === 1 ? " aeronave" : " aeronaves") + " e " + routes.length +
      (routes.length === 1 ? " rota mapeada" : " rotas mapeadas") + " nesta coleta.",
    fleet.length + " aircraft and " + routes.length + (routes.length === 1 ? " route" : " routes") + " mapped in this sync.");

  airportSelect.replaceChildren(new Option(T("Todos os aeroportos", "All airports"), ""));
  for (const code of airportCodes) {
    const planes = fleet.filter(plane => plane.airport === code).length;
    const departures = routes.filter(route => route.origin === code).length;
    const counts = [planes && planes + (planes > 1 ? T(" aeronaves", " aircraft") : T(" aeronave", " aircraft")),
      departures && departures + (departures > 1 ? T(" rotas", " routes") : T(" rota", " route"))].filter(Boolean).join(" · ");
    airportSelect.add(new Option(code + " · " + airportName(code) + (counts ? " — " + counts : ""), code));
  }
  aircraftSelect.replaceChildren(new Option(T("Toda a frota", "Whole fleet"), ""));
  for (const plane of [...fleet].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    aircraftSelect.add(new Option(plane.prefix + " · " + plane.model +
      (unavailable(plane) ? " (" + statusLabel(plane.status).toLowerCase() + ")" : ""), plane.prefix));
  }
  circuits = findCircuits();
  render(false);
  renderCoverage();
  renderAlerts();
  renderRanking();
  renderRealloc();
  renderRevenue();
  renderOperation();
}

function setLanguage(next) {
  if (next === lang) return;
  lang = next;
  try { localStorage.setItem(langKey, lang); } catch { /* navegador sem armazenamento */ }
  number = new Intl.NumberFormat(locale());
  const url = new URL(location.href);
  if (url.searchParams.has("lang")) { url.searchParams.set("lang", lang); history.replaceState(null, "", url); }
  paintAll();
}

for (const choice of document.querySelectorAll("#lang button")) {
  choice.addEventListener("click", () => setLanguage(choice.dataset.lang));
}

// ---------- Realocação de aeronaves ----------
// Para cada aeronave: quanto ela voou nos voos lidos e o que fazer com ela agora. Uma aeronave parada vai
// para onde há rota sem aeronave livre capaz (de preferência voando uma rota VTX no caminho); duas aeronaves
// não são mandadas para cobrir as mesmas rotas; as mais usadas recebem uma substituta parada.

const realloc = { view: "acoes", filter: "todas" };
const daysBetween = (from, to) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86_400_000);
const referenceDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })
  .format(capturedAt ? new Date(capturedAt) : new Date());
const agoText = days => days <= 0 ? T("hoje", "today") : days === 1 ? T("ontem", "yesterday")
  : T("há " + days + " dias", days + " days ago");
const where = code => code + " (" + placeName(code) + ")";
const plural = (count, one, many) => count + " " + (count === 1 ? one : many);
const flyableFrom = (plane, code) => routes.filter(route => route.origin === code && canFly(plane, route.origin, route.destination));
const legText = route => route.code + " " + route.origin + " → " + route.destination;
const blockText = (miles, plane, origin, destination) => nm(miles) + (blockLabel(miles, plane, origin, destination) ?
  ", " + blockLabel(miles, plane, origin, destination) : "");

const activityLevels = () => ({
  parada: [T("Parada", "Idle"), "bad"],
  pouco: [T("Pouco usada", "Little used"), "warn"],
  ativa: [T("Ativa", "Active"), "ok"],
  muito: [T("Muito usada", "Heavily used"), "hot"],
  indisponivel: [T("Indisponível", "Unavailable"), "neutral"],
});

const reallocKinds = () => ({
  realocar: { title: T("Precisam ser realocadas", "Need relocating"), hint: T("levar para onde falta aeronave", "take them where an aircraft is missing") },
  voar: { title: T("Prontas para voar", "Ready to fly"), hint: T("já estão no lugar certo: só falta piloto", "already in the right place: just need a pilot") },
  revezar: { title: T("Muito usadas", "Heavily used"), hint: T("dividir os voos com uma aeronave parada", "share the flying with an idle aircraft") },
  ok: { title: T("Em boa rotação", "In good rotation"), hint: T("voando normalmente: nada a fazer", "flying normally: nothing to do") },
  indisponivel: { title: T("Indisponíveis", "Unavailable"), hint: T("em uso ou em manutenção agora", "in use or in maintenance now") },
});

function fleetActivity() {
  const today = referenceDay();
  // "Muito usada": pelo menos 3 voos e o dobro da média de voos por aeronave no período.
  const busyLine = Math.max(3, Math.ceil(2 * flightLog.length / Math.max(1, fleet.length)));
  return fleet.map(plane => {
    const flights = flightLog.filter(flight => flight.prefix === plane.prefix).sort((a, b) => b.date.localeCompare(a.date));
    const last = flights[0] || null;
    const idleDays = last ? daysBetween(last.date, today) : null;
    const level = unavailable(plane) ? "indisponivel" : !flights.length ? "parada" : idleDays >= 3 ? "pouco"
      : flights.length >= busyLine ? "muito" : "ativa";
    return { plane, flights, last, idleDays, level, minutes: flights.reduce((sum, flight) => sum + flight.minutes, 0),
      longest: Math.max(0, ...flights.map(flight => flight.nm)) };
  });
}

const lastFlightText = item => item.last
  ? T("último voo ", "last flight ") + agoText(item.idleDays) + " (" + dayText(item.last.date) + T(") por @", ") by @") + item.last.pilot + ", " +
    item.last.origin + " → " + item.last.destination
  : T("nenhum voo registrado", "no flight recorded") + (flightsSince ? T(" desde ", " since ") + dayText(flightsSince) : "");

function reallocCards() {
  const items = fleetActivity();
  const network = networkAirports();
  const pairs = flownPairs();
  const claimed = new Set();   // rotas que já ganharam uma aeronave nesta rodada de sugestões
  const assigned = new Set();  // aeronaves que já receberam um destino
  const freeAt = code => fleet.filter(plane => plane.airport === code && !unavailable(plane));
  const cards = [];

  // 1. Paradas e fora da rede: primeiro as que estão fora da rede, depois as paradas há mais tempo.
  const idle = items.filter(item => item.level === "parada" || item.level === "pouco" ||
    (item.level !== "indisponivel" && !network.has(item.plane.airport)))
    .sort((a, b) => network.has(a.plane.airport) - network.has(b.plane.airport) || (b.idleDays ?? 999) - (a.idleDays ?? 999));
  for (const item of idle) {
    const { plane } = item;
    const outside = !network.has(plane.airport);
    const here = flyableFrom(plane, plane.airport);
    const departures = routes.filter(route => route.origin === plane.airport).length;
    const crowd = freeAt(plane.airport).length;
    const surplus = !outside && crowd > departures;
    const targets = [...network].filter(code => code !== plane.airport && airports[code]).map(code => ({
      code, miles: distance(plane.airport, code), direct: canFly(plane, plane.airport, code),
      via: routes.find(route => route.origin === plane.airport && route.destination === code && canFly(plane, route.origin, route.destination)) || null,
      needs: routes.filter(route => route.origin === code && !claimed.has(route) && coverage.get(route)?.status === "reposicionar" &&
        canFly(plane, route.origin, route.destination)),
    })).filter(target => target.needs.length && (target.via || target.direct))
      .sort((a, b) => b.needs.length - a.needs.length || Boolean(b.via) - Boolean(a.via) || a.miles - b.miles);

    const why = outside ? T("Ela está em " + where(plane.airport) + ", onde nenhuma rota da Vortex começa.",
      "It is at " + where(plane.airport) + ", where no Vortex route starts.")
      : !here.length ? T("Nenhuma rota que sai de " + plane.airport + " está ao alcance deste modelo.",
        "No route departing " + plane.airport + " is within this model's range.")
        : surplus ? T("Há " + crowd + " aeronaves livres em " + plane.airport + " para só " + plural(departures, "rota", "rotas") + " de partida.",
          "There are " + crowd + " free aircraft at " + plane.airport + " for only " + plural(departures, "departing route", "departing routes") + ".")
          : "";

    if (outside || !here.length || (surplus && targets.length)) {
      let target = targets[0];
      let fallback = null;
      if (!target) fallback = repositionOptions(plane)[0] || null;
      const code = target?.code || fallback?.code;
      if (!code) {
        cards.push({ kind: "realocar", item, action: T("Planeje um traslado com escala: nenhum aeroporto da rede está ao alcance sem parar.",
          "Plan a ferry with a stop: no network airport is within range non-stop."),
          why, button: [T("Abrir no mapa", "Open on map"), () => focusPlane(plane)] });
        continue;
      }
      assigned.add(plane.prefix);
      const via = target?.via || null;
      const leg = blockText(distance(plane.airport, code), plane, plane.airport, code);
      const action = via
        ? T("Voe a rota " + legText(via) + " (" + leg + "). Ela já deixa a aeronave em " + where(code) + ".",
          "Fly route " + legText(via) + " (" + leg + "). It leaves the aircraft at " + where(code) + ".")
        : T("Faça um traslado até " + where(code) + " (" + leg + ").", "Ferry it to " + where(code) + " (" + leg + ").");
      let reason;
      if (target) {
        target.needs.forEach(route => claimed.add(route));
        const listed = target.needs.slice(0, 3).map(route => route.origin + " → " + route.destination).join(", ");
        const extra = target.needs.length > 3 ? T(" e mais ", " and ") + (target.needs.length - 3) + T("", " more") : "";
        reason = T("Em " + code + ", " + (target.needs.length > 1 ? target.needs.length + " rotas esperam" : "1 rota espera") +
          " uma aeronave que ela alcança: " + listed + extra + ".",
          "At " + code + ", " + (target.needs.length > 1 ? target.needs.length + " routes are waiting" : "1 route is waiting") +
          " for an aircraft that can fly them: " + listed + extra + ".");
      } else {
        reason = T("De " + code + " saem " + plural(fallback.flyable.length, "rota que ela alcança", "rotas que ela alcança") + ".",
          code + " has " + plural(fallback.flyable.length, "departing route", "departing routes") + " within its range.");
      }
      cards.push({ kind: "realocar", item, action, why: [why, reason].filter(Boolean).join(" "), hangar: code === plane.base,
        button: [T("Ver no mapa", "Show on map"), () => via ? showPlan(plane, [via]) : planFerry(plane, code)] });
      continue;
    }

    // Tem rota daqui: sugere a melhor, priorizando rota nunca voada e destino onde falta aeronave.
    const needAirports = new Set(routes.filter(route => coverage.get(route)?.status === "reposicionar").map(route => route.origin));
    // Rota já sugerida para outra aeronave vai para o fim da fila.
    const score = route => (claimed.has(route) ? -10 : 0) + (pairs.has(route.origin + "-" + route.destination) ? 0 : 2) +
      (needAirports.has(route.destination) ? 1 : 0);
    const best = [...here].sort((a, b) => score(b) - score(a) ||
      (distance(a.origin, a.destination) ?? 0) - (distance(b.origin, b.destination) ?? 0));
    const route = best[0];
    claimed.add(route);
    const notes = [];
    if (!pairs.has(route.origin + "-" + route.destination)) notes.push(T("Essa rota ainda não tem voo registrado.", "This route has no recorded flight yet."));
    if (needAirports.has(route.destination)) notes.push(T("E ela chega a " + route.destination + ", onde falta aeronave para outras rotas.",
      "And it lands at " + route.destination + ", where other routes are missing an aircraft."));
    cards.push({ kind: "voar", item,
      action: T("Voe a rota ", "Fly route ") + legText(route) + " (" + blockText(distance(route.origin, route.destination), plane, route.origin, route.destination) + ").",
      why: [T((item.level === "parada" ? "Está parada" : "Está sem voar " + agoText(item.idleDays)) + " em " + where(plane.airport) +
        ", que tem rota ao alcance dela.",
        (item.level === "parada" ? "It is idle at " : "Its last flight was " + agoText(item.idleDays) + " and it sits at ") + where(plane.airport) +
        ", which has a route within its range."), ...notes].join(" "),
      others: best.slice(1, 4).map(other => other.origin + " → " + other.destination),
      button: [T("Ver no mapa", "Show on map"), () => showPlan(plane, [route])] });
  }

  // 2. Muito usadas: indica uma substituta parada que alcança as mesmas distâncias.
  const spare = items.filter(item => (item.level === "parada" || item.level === "pouco") && network.has(item.plane.airport) &&
    !assigned.has(item.plane.prefix));
  const usedSubs = new Set();
  for (const item of items.filter(entry => entry.level === "muito" && !idle.includes(entry))) {
    const { plane } = item;
    // Cada substituta é indicada para uma aeronave só, enquanto houver outras opções.
    const subs = spare.filter(other => ["ok", "limite"].includes(reach(other.plane, item.longest)))
      .sort((a, b) => usedSubs.has(a.plane.prefix) - usedSubs.has(b.plane.prefix) ||
        (b.plane.airport === plane.airport) - (a.plane.airport === plane.airport) ||
        (b.plane.model === plane.model) - (a.plane.model === plane.model) ||
        (distance(plane.airport, a.plane.airport) ?? Infinity) - (distance(plane.airport, b.plane.airport) ?? Infinity));
    const sub = subs[0]?.plane;
    if (sub) usedSubs.add(sub.prefix);
    const share = T("Fez " + item.flights.length + " dos " + flightLog.length + " voos lidos (" + hoursText(item.minutes) + " de voo).",
      "Flew " + item.flights.length + " of the " + flightLog.length + " flights read (" + hoursText(item.minutes) + " in the air).");
    cards.push({ kind: "revezar", item,
      action: sub
        ? T("Ofereça o próximo voo para a " + sub.prefix + " (" + sub.model + ", " +
          (sub.airport === plane.airport ? "parada no mesmo aeroporto, " + sub.airport : "parada em " + where(sub.airport)) + ").",
          "Give the next flight to " + sub.prefix + " (" + sub.model + ", " +
          (sub.airport === plane.airport ? "idle at the same airport, " + sub.airport : "idle at " + where(sub.airport)) + ").")
        : T("Siga usando, mas acompanhe o desgaste no PilOps: não há aeronave parada que cubra as mesmas distâncias.",
          "Keep using it, but watch its wear on PilOps: no idle aircraft covers the same distances."),
      why: share + (sub ? T(" Dividir os voos espalha o desgaste e deixa a frota inteira em uso.",
        " Sharing the flying spreads the wear and keeps the whole fleet in use.") : ""),
      button: sub ? [T("Ver a substituta", "Show the substitute"), () => focusPlane(sub)] : [T("Abrir no mapa", "Open on map"), () => focusPlane(plane)] });
  }

  for (const item of items.filter(entry => entry.level === "ativa" && !idle.includes(entry))) {
    cards.push({ kind: "ok", item, action: T("está voando normalmente, nada a fazer.", "flying normally, nothing to do."), why: "",
      button: [T("Abrir no mapa", "Open on map"), () => focusPlane(item.plane)] });
  }
  for (const item of items.filter(entry => entry.level === "indisponivel")) {
    cards.push({ kind: "indisponivel", item,
      action: /manuten/i.test(item.plane.status)
        ? T("em manutenção. Volta às sugestões quando sair.", "in maintenance. It comes back to the suggestions when it is out.")
        : T("em uso por um piloto agora. Volta às sugestões quando pousar.", "in use by a pilot right now. It comes back to the suggestions after landing."),
      why: "", button: null });
  }
  return { cards, items };
}

function focusPlane(plane) {
  chooseAircraft(plane.prefix);
  document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function showPlan(plane, legs) {
  Object.assign(state, { prefix: plane.prefix, origin: plane.airport, focus: null, tab: "routes", plan: [...legs] });
  render();
  document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function reallocRow(card) {
  const { plane } = card.item;
  const row = element("li", "realloc-item kind-" + card.kind);
  const head = element("div", "row-head");
  head.append(button(plane.prefix + " · " + plane.model, "item-heading", () => focusPlane(plane)));
  const tags = element("div", "tags");
  const [levelLabel, levelTone] = activityLevels()[card.item.level];
  tags.append(element("span", "tag " + levelTone, levelLabel));
  if (card.hangar) tags.append(element("span", "tag neutral", T("Volta ao hangar", "Back to its hangar")));
  const attention = plane.status.split(" · ").filter(part => /atenção/i.test(part));
  if (attention.length) tags.append(element("span", "tag warn", statusLabel(attention.join(" · "))));
  head.append(tags);
  row.append(head);
  row.append(element("span", "meta", T("Agora em ", "Now at ") + where(plane.airport) + " · hangar " + (plane.base || T("não informado", "not given")) +
    " · " + lastFlightText(card.item)));
  const action = element("p", "todo");
  action.append(element("strong", "", card.kind === "ok" || card.kind === "indisponivel" ? T("Situação: ", "Status: ") : T("O que fazer: ", "What to do: ")),
    card.action);
  row.append(action);
  if (card.why) row.append(element("p", "why", T("Por quê: ", "Why: ") + card.why));
  if (card.others?.length) row.append(element("span", "meta", T("Outras rotas daqui ao alcance: ", "Other routes from here within range: ") +
    card.others.join(", ") + "."));
  if (card.button) {
    const actions = element("div", "plan-actions");
    actions.append(button(card.button[0], "secondary small", card.button[1]));
    row.append(actions);
  }
  return row;
}

function renderRealloc() {
  const list = document.querySelector("#realloc");
  if (!list || !fleet.length) return;
  const { cards, items } = reallocCards();
  const kinds = reallocKinds();
  const levels = activityLevels();
  const order = Object.keys(kinds);

  // Contadores que também servem de filtro.
  const stats = document.querySelector("#realloc-stats");
  stats.replaceChildren(...order.map(kind => {
    const count = cards.filter(card => card.kind === kind).length;
    const tile = button("", "stat stat-" + kind, () => {
      realloc.filter = realloc.filter === kind ? "todas" : kind;
      realloc.view = "acoes";
      renderRealloc();
    });
    tile.setAttribute("aria-pressed", String(realloc.filter === kind));
    tile.append(element("strong", "", String(count)), element("span", "", kinds[kind].title),
      element("small", "", kinds[kind].hint));
    return tile;
  }));
  for (const tab of document.querySelectorAll("#realloc-tabs button")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.view === realloc.view));
  }

  const days = flightsSince ? daysBetween(flightsSince, referenceDay()) + 1 : 0;
  const period = flightsSince ? T(" desde ", " since ") + dayText(flightsSince) + " (" + plural(days, T("dia", "day"), T("dias", "days")) + ")" : "";
  const summary = document.querySelector("#realloc-summary");
  const rows = [];
  if (realloc.view === "acoes") {
    summary.textContent = T("Sugestões calculadas com a posição de cada aeronave na última coleta e os " + flightLog.length +
      " voos lidos" + period + ". Os grupos de cima são os mais urgentes. Elas são recalculadas a cada sincronização.",
      "Suggestions based on each aircraft's position in the last sync and the " + flightLog.length +
      " flights read" + period + ". The groups at the top are the most urgent. They are recalculated with every sync.") +
      (realloc.filter !== "todas" ? T(" Filtro: ", " Filter: ") + kinds[realloc.filter].title.toLowerCase() +
        T(" (clique de novo no quadro para ver tudo).", " (click the box again to see everything).") : "");
    for (const kind of order) {
      if (realloc.filter !== "todas" && realloc.filter !== kind) continue;
      const group = cards.filter(card => card.kind === kind);
      if (!group.length) continue;
      rows.push(element("li", "group", kinds[kind].title + " · " + kinds[kind].hint));
      rows.push(...group.map(reallocRow));
    }
    if (!rows.length) rows.push(element("li", "meta", T("Nenhuma aeronave neste grupo agora.", "No aircraft in this group right now.")));
  } else {
    summary.textContent = T("Voos de cada aeronave" + period + ", da mais usada para a menos usada. O PilOps mostra só os 10 voos " +
      "mais recentes da companhia, então a contagem cresce a cada sincronização.",
      "Flights per aircraft" + period + ", from most to least used. PilOps only shows the company's 10 most recent " +
      "flights, so the count grows with every sync.");
    const sorted = [...items].sort((a, b) => b.flights.length - a.flights.length || b.minutes - a.minutes ||
      a.plane.prefix.localeCompare(b.plane.prefix));
    const max = Math.max(1, ...sorted.map(item => item.flights.length));
    for (const item of sorted) {
      const row = element("li", "activity");
      const head = element("div", "row-head");
      head.append(button(item.plane.prefix + " · " + item.plane.model, "item-heading", () => focusPlane(item.plane)));
      const [label, tone] = levels[item.level];
      head.append(element("span", "tag " + tone, label));
      const flightsText = plural(item.flights.length, T("voo", "flight"), T("voos", "flights"));
      const bar = element("div", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", flightsText);
      const fill = element("i", "fill-" + item.level);
      fill.style.width = (item.flights.length / max * 100) + "%";
      bar.append(fill);
      row.append(head, bar, element("span", "meta", (item.flights.length
        ? flightsText + " · " + hoursText(item.minutes) + T(" de voo · ", " flown · ")
        : "") + lastFlightText(item) + T(" · agora em ", " · now at ") + item.plane.airport));
      rows.push(row);
    }
  }
  list.replaceChildren(...rows);
}

for (const tab of document.querySelectorAll("#realloc-tabs button")) {
  tab.addEventListener("click", () => { realloc.view = tab.dataset.view; renderRealloc(); });
}

// ---------- Variações percentuais de receita ----------
// Os valores financeiros são processados no coletor local. O arquivo público só contém variações.
const percent = value => (value > 0 ? "+" : value < 0 ? "−" : "") +
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(Math.abs(value * 100)) + "%";
const revenueStates = () => ({
  queda: [T("Queda de 10% ou mais", "Drop of 10% or more"), "bad"],
  recuperada: [T("Queda anterior, recuperada", "Earlier drop, recovered"), "warn"],
  alta: [T("Alta de 10% ou mais", "Rise of 10% or more"), "ok"],
  estavel: [T("Estável", "Stable"), "neutral"],
});
function revenueRow(group) {
  const row = element("li", "revenue-item state-" + group.state);
  const head = element("div", "row-head");
  head.append(element("strong", "circuit", group.origin + " → " + group.destination + " · " + group.model));
  const [label, tone] = revenueStates()[group.state];
  head.append(element("span", "tag " + tone, label));
  row.append(head, element("p", "why", percent(group.change) + T(" em relação à referência dos voos anteriores.",
    " against the reference from earlier flights.")), element("span", "meta", group.count +
    T(" voos comparáveis · último: ", " comparable flights · last: ") + dayText(group.lastDate)));
  return row;
}
function renderRevenue() {
  const list = document.querySelector("#revenue");
  if (!list) return;
  const groups = revenueMonitor.groups || [];
  const compared = groups.filter(group => group.state !== "unico" && Number.isFinite(group.change));
  const count = key => compared.filter(group => group.state === key).length;
  const drops = compared.filter(group => group.state === "queda");
  const tile = (value, title, hint, kind) => {
    const box = element("div", "stat stat-" + kind);
    box.append(element("strong", "", String(value)), element("span", "", title), element("small", "", hint));
    return box;
  };
  document.querySelector("#revenue-stats").replaceChildren(
    tile(count("queda"), T("Rotas com queda", "Routes with a drop"), T("10% ou mais abaixo", "10% or more lower"), "queda"),
    tile(count("alta"), T("Rotas com alta", "Routes with a rise"), T("10% ou mais acima", "10% or more higher"), "alta"),
    tile(count("estavel") + count("recuperada"), T("Rotas estáveis", "Stable routes"), T("dentro da variação normal", "within normal variation"), "estavel"),
    tile(groups.length - compared.length, T("Aguardando 2º voo", "Waiting for a 2nd flight"), T("mesma rota e mesmo modelo", "same route and aircraft model"), "unico"));
  document.querySelector("#revenue-summary").textContent = T(
    "Somente variações percentuais. " + revenueMonitor.readCount + " voos analisados; " + compared.length + " combinações de rota e modelo com comparação. Os percentuais são atualizados a cada sincronização manual.",
    "Percentage changes only. " + revenueMonitor.readCount + " flights analysed; " + compared.length + " comparable route and aircraft combinations. Percentages are updated with each manual sync.");
  const order = { queda: 0, recuperada: 1, alta: 2, estavel: 3 };
  const rows = [...compared].sort((a, b) => order[a.state] - order[b.state] || a.change - b.change).map(revenueRow);
  if (!rows.length) rows.push(element("li", "meta", T("Aguardando dois voos comparáveis na mesma rota e modelo.", "Waiting for two comparable flights on the same route and aircraft model.")));
  list.replaceChildren(...rows);
  const banner = document.querySelector("#revenue-alert");
  banner.replaceChildren(); banner.hidden = !drops.length;
  if (drops.length) banner.append(button(T("⚠ Queda de 10% ou mais em ", "⚠ Drop of 10% or more on ") + drops.length +
    T(" rota(s) — ver percentuais", " route(s) — see percentages"), "alert-link", () => document.querySelector("#revenue-card").scrollIntoView({ behavior: "smooth", block: "start" })));
}

// ---------- Operação da semana e compartilhamento ----------

async function refreshData() {
  if (!fleet.length || refreshingData || document.hidden || document.querySelector("dialog[open]")) return;
  refreshingData = true;
  try {
    const response = await fetch("./dados.json?t=" + Date.now(), { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.fleet) || !data.fleet.length || !Array.isArray(data.routes) || !Array.isArray(data.hubs) ||
        data.capturedAt === capturedAt || !Number.isFinite(Date.parse(data.capturedAt))) return;
    fleet = data.fleet; routes = data.routes; hubs = new Set(data.hubs);
    pilots = data.pilots || []; flightLog = data.flights || []; flightsSince = data.flightsSince || null;
    capturedAt = data.capturedAt; pilotsCapturedAt = data.pilotsCapturedAt || null;
    revenueMonitor = data.revenueMonitor || { readCount: 0, groups: [] };
    const currentRoute = old => routes.find(route => VortexOperation.pair(route) === VortexOperation.pair(old));
    state.plan = state.plan.map(route => currentRoute(route) || (route.code === "Traslado" ? route : null)).filter(Boolean);
    state.focus = state.focus ? currentRoute(state.focus) || null : null;
    if (!fleet.some(plane => plane.prefix === state.prefix)) state.prefix = "";
    coverage = new Map(routes.map(route => [route, routeCoverage(route)]));
    airportCodes = [...new Set([...hubs, ...fleet.map(plane => plane.airport), ...routes.flatMap(route => [route.origin, route.destination])])].filter(Boolean).sort();
    if (!airportCodes.includes(state.origin)) state.origin = "";
    if (operationConfig) operationConfig = VortexOperation.read(operationConfig, routes);
    document.querySelector("#total-fleet").textContent = fleet.length;
    document.querySelector("#total-routes").textContent = routes.length;
    document.querySelector("#total-hubs").textContent = hubs.size;
    paintAll();
  } catch { /* Mantém a coleta anterior, seu horário e o aviso de dados antigos. */ }
  finally { refreshingData = false; }
}

function renderOperation() {
  const title = document.querySelector("#operation-title");
  const period = document.querySelector("#operation-period");
  const path = document.querySelector("#operation-path");
  const stats = document.querySelector("#operation-stats");
  const cards = document.querySelector("#operation-routes");
  const standings = document.querySelector("#operation-ranking");
  const note = document.querySelector("#operation-note");
  stats.replaceChildren();
  cards.replaceChildren();
  standings.replaceChildren();
  path.hidden = true;
  path.textContent = "";
  if (!operationConfig) {
    title.textContent = T("Aguardando definição da administração", "Awaiting the administration’s selection");
    period.textContent = "";
    note.textContent = T("A configuração da operação está indisponível ou inválida. A administração pode publicá-la em Editar operação.",
      "The operation configuration is unavailable or invalid. The administration can publish it through Edit operation.");
    return;
  }
  const operation = operationConfig;
  const challenge = VortexOperation.progress(operation, flightLog);
  const { completed } = challenge;
  const { ranking } = VortexOperation.weekly(operation, flightLog, routes);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const phase = today < operation.start ? T("Agendada", "Scheduled") : today > operation.end ? T("Encerrada", "Finished") : T("Em andamento", "In progress");
  title.textContent = operation.title[lang];
  period.textContent = dayText(operation.start) + " → " + dayText(operation.end) + T(" · datas de Brasília · ", " · Brasília dates · ") + phase;
  if (operation.routes.length > 1 && operation.routes.every((item, index) => item.route &&
      (!index || operation.routes[index - 1].destination === item.origin))) {
    path.textContent = [operation.routes[0].origin, ...operation.routes.map(item => item.destination)].join(" → ");
    path.hidden = false;
  }
  for (const [value, label] of [[completed.length + " / " + operation.goal, T("Meta de voos do desafio", "Challenge flight target")],
    [challenge.ranking.length, T("Pilotos no desafio", "Pilots in the challenge")],
    [new Set(completed.map(VortexOperation.pair)).size + " / " + operation.routes.length, T("Rotas do desafio realizadas", "Challenge routes flown")]]) {
    const tile = element("div", "stat");
    tile.append(element("strong", "", String(value)), element("span", "", label));
    stats.append(tile);
  }
  for (const [index, item] of operation.routes.entries()) {
    const card = element("article", "operation-route");
    card.append(element("h3", "", (index + 1) + ". " + item.origin + " → " + item.destination));
    const route = item.route;
    if (!route) {
      card.append(element("p", "meta", T("Rota fora da malha atual. A administração deve revisar a seleção.",
        "Route outside the current network. The administration should review the selection.")));
      cards.append(card);
      continue;
    }
    const available = coverage.get(route);
    const reference = available.here[0] || available.capable[0];
    const minutes = blockMinutes(available.miles, reference, route.origin, route.destination);
    card.append(element("p", "meta", route.code + " · " + nm(available.miles)),
      element("span", "tag " + coverageText()[available.status][1], coverageText()[available.status][0]));
    if (minutes !== null) card.append(element("p", "meta", blockLabel(available.miles, reference, route.origin, route.destination) + T(" · referência ", " · reference ") + reference.model));
    card.append(element("p", "meta", T("Voos lidos no período: ", "Flights read in the period: ") +
      completed.filter(flight => VortexOperation.pair(flight) === VortexOperation.pair(route)).length));
    const actions = element("div", "plan-actions");
    actions.append(button(T("Ver rota", "View route"), "secondary small", () => {
      Object.assign(state, { origin: route.origin, prefix: "", plan: [], focus: route, tab: "routes" });
      render(false);
      frame([available]);
      document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
    }), button(T("Compartilhar meu voo", "Share my flight"), "secondary small", () => openShare([route], available.here[0])));
    card.append(actions);
    cards.append(card);
  }
  if (ranking.length) {
    const table = element("table", "weekly-ranking");
    const head = element("tr");
    for (const text of [T("Posição", "Place"), T("Piloto", "Pilot"), T("Voos", "Flights"), T("Rotas diferentes", "Different routes")]) {
      const th = element("th", "", text);
      th.scope = "col";
      head.append(th);
    }
    const thead = element("thead");
    thead.append(head);
    const tbody = element("tbody");
    for (const pilot of ranking) {
      const row = element("tr");
      row.append(element("td", "", String(pilot.rank)), element("td", "", "@" + pilot.name),
        element("td", "", String(pilot.flights)), element("td", "", String(pilot.routes)));
      tbody.append(row);
    }
    table.append(thead, tbody);
    standings.append(table);
  } else standings.append(element("p", "meta", T("Nenhum voo remunerado concluído e sincronizado nas rotas da Vortex neste período.",
    "No completed and synced paid flights on Vortex routes in this period.")));
  note.textContent = T("Ranking semanal parcial: conta os voos remunerados concluídos e lidos em todas as rotas cadastradas da Vortex no período acima, até a última coleta. O desafio das rotas em destaque tem contagem separada. Mais voos vêm primeiro; a variedade de rotas e depois a ordem alfabética desempata. Posições consecutivas, sem repetição.",
    "Partial weekly ranking: counts completed paid flights read on all registered Vortex routes within the period above, up to the last sync. The featured-route challenge has separate counts. Most flights comes first; route variety, then alphabetical order break ties. Places are consecutive, with no shared positions.");
}

function openShare(legs, preferredPlane) {
  shareLegs = legs;
  const picker = document.querySelector("#share-aircraft");
  picker.replaceChildren(new Option(T("Sem aeronave definida", "Aircraft not chosen"), ""));
  for (const plane of fleet) picker.add(new Option(plane.prefix + " · " + plane.model + " · " + plane.airport + " · " + statusLabel(plane.status), plane.prefix));
  picker.value = preferredPlane?.prefix || "";
  document.querySelector("#share-status").value = "today";
  document.querySelector("#share-feedback").textContent = "";
  updateShare();
  document.querySelector("#share-dialog").showModal();
}

function updateShare() {
  if (!shareLegs.length) return;
  const plane = fleet.find(item => item.prefix === document.querySelector("#share-aircraft").value);
  const distances = shareLegs.map(leg => distance(leg.origin, leg.destination));
  const times = VortexTimes.summary(shareLegs.map((leg, index) => blockEstimate(distances[index], plane, leg.origin, leg.destination)));
  const url = new URL("https://vortexairways.github.io/vortex-planejador/");
  url.searchParams.set("from", shareLegs[0].origin);
  url.searchParams.set("to", shareLegs[0].destination);
  if (plane) url.searchParams.set("aircraft", plane.prefix);
  if (shareLegs.length > 1) url.searchParams.set("legs", shareLegs.map(VortexOperation.pair).join(","));
  url.hash = "map-title";
  document.querySelector("#share-message").value = VortexOperation.share({ legs: shareLegs, plane,
    pilot: document.querySelector("#share-pilot").value, status: document.querySelector("#share-status").value,
    minutes: times.minutes, timeSource: times.source, pilopsLegs: times.count,
    miles: distances.every(value => value !== null) ? distances.reduce((sum, value) => sum + value, 0) : null,
    url: url.href });
  shareFeedback();
}

function shareFeedback() {
  const length = document.querySelector("#share-message").value.length;
  document.querySelector("#share-copy").disabled = !length || length > 2000;
  document.querySelector("#share-feedback").textContent = length > 2000
    ? T("O Discord aceita até 2.000 caracteres. Encurte o texto para copiar.", "Discord accepts up to 2,000 characters. Shorten the text to copy it.")
    : T("Mensagem pronta para copiar e publicar no grupo.", "Message ready to copy and post to the group.");
}

for (const id of ["share-pilot", "share-aircraft", "share-status"]) document.getElementById(id).addEventListener("input", updateShare);
document.querySelector("#share-message").addEventListener("input", shareFeedback);
document.querySelector("#share-copy").addEventListener("click", async () => {
  const message = document.querySelector("#share-message");
  const feedback = document.querySelector("#share-feedback");
  try {
    await navigator.clipboard.writeText(message.value);
    feedback.textContent = T("Copiado! Abra o Discord da Vortex e cole no canal desejado.", "Copied! Open the Vortex Discord and paste into your chosen channel.");
  } catch {
    message.focus();
    message.select();
    feedback.textContent = T("Selecionei o texto. Use Ctrl+C para copiar e cole no Discord.", "The text is selected. Use Ctrl+C to copy and paste it into Discord.");
  }
});

// Atualiza a janela na virada do dia, inclusive quando a aba volta do segundo plano.
function refreshActivityDay() {
  if (activityDay && activityDay !== VortexActivity.today()) renderRanking();
}
setInterval(() => { refreshActivityDay(); void refreshData(); }, 60000);
document.addEventListener("visibilitychange", () => { refreshActivityDay(); void refreshData(); });

start();
