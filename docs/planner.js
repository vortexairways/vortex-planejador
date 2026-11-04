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
}

start();
