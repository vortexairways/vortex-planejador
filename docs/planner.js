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
// Circuitos fechados formados por rotas cadastradas (preenchidos em start()).
let circuits = [];
const ideas = { view: "circuitos", scope: "todas", limit: 12 };

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
    const tip = element("span", "", code + " · " + airports[code].name + (planes.length ? " · " + planes.length + " na frota" : "") +
      (outside ? " · fora da rede" : ""));
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
    return { code, miles, flyable, needed, minutes: blockMinutes(miles, plane) };
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

function renderAlerts() {
  const list = document.querySelector("#alerts");
  if (!list) return;
  const network = networkAirports();
  const outside = fleet.filter(plane => !network.has(plane.airport));
  const offRoute = flightLog.filter(flight => !isRegistered(flight.origin, flight.destination))
    .sort((a, b) => b.date.localeCompare(a.date));

  const alert = document.querySelector("#fleet-alert");
  alert.replaceChildren();
  alert.hidden = !outside.length && !offRoute.length;
  if (!alert.hidden) {
    alert.append(button("⚠ " + [outside.length && outside.length + (outside.length > 1 ? " aeronaves fora da rede" : " aeronave fora da rede"),
      offRoute.length && offRoute.length + (offRoute.length > 1 ? " voos fora das rotas cadastradas" : " voo fora das rotas cadastradas")]
      .filter(Boolean).join(" · ") + " — ver avisos", "alert-link",
      () => document.querySelector("#alerts-card").scrollIntoView({ behavior: "smooth", block: "start" })));
  }

  document.querySelector("#alerts-summary").textContent = outside.length
    ? outside.length + (outside.length > 1 ? " aeronaves estão em aeroportos" : " aeronave está em aeroporto") +
      " sem nenhuma rota cadastrada de partida. Abaixo, quem levou cada uma até lá (quando o voo foi lido) e para onde reposicionar."
    : "Todas as aeronaves estão em aeroportos com rotas cadastradas de partida.";

  const rows = [];
  for (const plane of outside) {
    const row = element("li");
    const head = element("div", "row-head");
    head.append(button(plane.prefix + " · " + plane.model, "item-heading", () => chooseAircraft(plane.prefix)));
    head.append(element("span", "tag bad", "Fora da rede em " + plane.airport));
    row.append(head);
    const place = airports[plane.airport];
    row.append(element("span", "meta", (place ? place.name + " · " + countryName(place.country) : plane.airport) +
      (hubs.has(plane.airport) ? " · hub sem rotas de partida" : "") + " · " + statusLabel(plane.status) +
      (plane.base ? " · hangar em " + plane.base : "")));
    const arrival = lastArrival(plane);
    row.append(element("span", "meta who", arrival
      ? "Levada até " + plane.airport + " por @" + arrival.pilot + " em " + dayText(arrival.date) + " (voo " + arrival.origin + " → " +
        arrival.destination + (isRegistered(arrival.origin, arrival.destination) ? ")." : ", fora das rotas cadastradas).")
      : "Chegou a " + plane.airport + " antes dos voos lidos" + (flightsSince ? " (desde " + dayText(flightsSince) + ")" : "") +
        ": o piloto responsável não aparece no histórico do PilOps."));
    const options = repositionOptions(plane);
    const box = element("div", "ferries");
    if (!options.length) {
      box.append(element("span", "meta", "Nenhum aeroporto da rede ao alcance desta aeronave sem escala."));
    }
    for (const option of options) {
      const line = element("div", "ferry");
      line.append(element("span", "", "Traslado para " + option.code + " (" + (airports[option.code].city || airportName(option.code)) + ") · " +
        nm(option.miles) + (option.minutes ? " · " + clock(option.minutes) : "") + " · " +
        (option.needed.length ? option.needed.length + (option.needed.length > 1 ? " rotas" : " rota") + " sem aeronave livre ali"
          : option.flyable.length + (option.flyable.length > 1 ? " rotas de partida" : " rota de partida"))));
      if (option.needed.length) line.append(element("span", "tag ok", "Necessária"));
      if (option.hangar) line.append(element("span", "tag neutral", "Hangar da aeronave"));
      line.append(button("Planejar traslado", "secondary small", () => planFerry(plane, option.code)));
      box.append(line);
    }
    row.append(box);
    rows.push(row);
  }
  if (offRoute.length) {
    rows.push(element("li", "group", "Voos fora das rotas cadastradas"));
    for (const flight of offRoute) {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(element("strong", "", flight.origin + " → " + flight.destination));
      if (!network.has(flight.destination)) head.append(element("span", "tag bad", "Deixou a aeronave fora da rede"));
      row.append(head, element("span", "meta", dayText(flight.date) + " · @" + flight.pilot + " · " + flight.prefix + " (" + flight.model + ") · " +
        nm(flight.nm)));
      rows.push(row);
    }
  }
  if (!rows.length) rows.push(element("li", "meta", "Nenhum aviso no momento."));
  list.replaceChildren(...rows);
}

// ---------- Sugestões de rotas ----------

const continentName = { SA: "Sul-americana", NA: "Norte-americana", EU: "Europeia", AS: "Asiática",
  AF: "Africana", OC: "Oceânica", AN: "Antártica" };
const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["pt-BR"], { type: "region" });
    return code => { try { return names.of(code); } catch { return code; } };
  } catch { return code => code; }
})();

// nacional: um só país · continental: um só continente · intercontinental: mais de um continente.
function scopeOf(codes) {
  const places = codes.map(code => airports[code]);
  if (places.some(place => !place?.country)) return { kind: "indefinida", label: "Sem classificação" };
  const countries = new Set(places.map(place => place.country));
  const continents = new Set(places.map(place => place.continent));
  if (countries.size === 1) return { kind: "nacional", label: "Nacional · " + countryName([...countries][0]) };
  if (continents.size === 1) return { kind: "continental", label: continentName[[...continents][0]] || "Continental" };
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
  head.append(button("Montar no plano", "secondary small", () => {
    Object.assign(state, { origin: circuit.start, prefix: plane?.prefix || "", plan: [...circuit.legs], focus: null, tab: "routes" });
    render();
    document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  row.append(head);
  const times = plane ? circuit.legs.map((leg, i) => blockMinutes(circuit.miles[i], plane)) : [];
  const total = times.length && times.every(value => value !== null) ? clock(times.reduce((a, b) => a + b, 0)) + " de bloco com " + plane.model : "";
  row.append(element("span", "meta", [circuit.legs.length + " trechos", nm(circuit.total), "maior trecho " + nm(circuit.longest), total]
    .filter(Boolean).join(" · ")));
  const never = circuit.legs.filter(leg => !pairs.has(leg.origin + "-" + leg.destination)).length;
  const tags = element("div", "tags");
  tags.append(element("span", "tag neutral", circuit.scope.label));
  if (circuit.ready.length) {
    tags.append(element("span", "tag ok", "Pronta em " + circuit.start + ": " + circuit.ready.map(p => p.prefix).join(", ")));
  } else if (circuit.capable.length) {
    tags.append(element("span", "tag warn", "Aeronave capaz em outro aeroporto: " +
      circuit.capable.slice(0, 3).map(p => p.prefix + " em " + p.airport).join(", ")));
  } else if (circuit.anyCapable.length) {
    tags.append(element("span", "tag warn", "Só com aeronave indisponível agora"));
  } else {
    tags.append(element("span", "tag bad", "A frota não alcança o maior trecho"));
  }
  if (never) tags.append(element("span", "tag warn", never === circuit.legs.length ? "Nenhum trecho voado ainda"
    : never + (never > 1 ? " trechos nunca voados" : " trecho nunca voado")));
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
    suggestionChip("todas", "Todas", count("todas")), suggestionChip("nacional", "Nacionais", count("nacional")),
    suggestionChip("continental", "Continentais", count("continental")),
    suggestionChip("intercontinental", "Intercontinentais", count("intercontinental")));
  for (const tabButton of document.querySelectorAll("#idea-tabs button")) {
    tabButton.setAttribute("aria-pressed", String(tabButton.dataset.view === ideas.view));
  }

  const summary = document.querySelector("#ideas-summary");
  const rows = [];
  if (ideas.view === "circuitos") {
    const order = circuit => circuit.ready.length ? 0 : circuit.capable.length ? 1 : circuit.anyCapable.length ? 2 : 3;
    const shown = visibleCircuits.filter(circuit => scopeMatches(circuit.scope))
      .sort((a, b) => order(a) - order(b) || b.legs.length - a.legs.length || a.total - b.total);
    summary.textContent = (start ? "Circuitos que começam e terminam em " + start + ". " : "Escolha um aeroporto de partida no filtro acima para ver só os circuitos que saem e voltam a ele. ") +
      shown.length + (shown.length === 1 ? " circuito fechado" : " circuitos fechados") + " com rotas já cadastradas na Vortex.";
    rows.push(...shown.slice(0, ideas.limit).map(circuit => circuitRow(circuit, pairs)));
    if (shown.length > ideas.limit) {
      const more = element("li", "more");
      more.append(button("Mostrar mais " + Math.min(12, shown.length - ideas.limit) + " de " + (shown.length - ideas.limit),
        "secondary small", () => { ideas.limit += 12; renderSuggestions(); }));
      rows.push(more);
    }
  } else if (ideas.view === "pilotos") {
    const order = { pronta: 0, reposicionar: 1, indisponivel: 2, comprar: 3 };
    const waiting = routeScopes.filter(item => !pairs.has(item.route.origin + "-" + item.route.destination) && scopeMatches(item.scope))
      .map(item => ({ ...item, cover: coverage.get(item.route) }))
      .sort((a, b) => order[a.cover.status] - order[b.cover.status] || (b.cover.miles ?? 0) - (a.cover.miles ?? 0));
    summary.textContent = "Rotas cadastradas sem nenhum voo registrado " + (flightsSince ? "desde " + dayText(flightsSince) : "nas coletas") +
      ". As de aeronave pronta na origem só esperam um piloto.";
    rows.push(...waiting.map(item => {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(button(item.route.origin + " → " + item.route.destination, "item-heading", () => {
        Object.assign(state, { origin: item.route.origin, plan: [], focus: item.route, tab: "routes" });
        render(false);
        frame(listedRoutes());
        document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });
      }));
      head.append(element("span", "tag " + coverageText[item.cover.status][1], coverageText[item.cover.status][0]));
      row.append(head, element("span", "meta", item.route.code + " · " + nm(item.cover.miles) + " · " + item.scope.label +
        (item.cover.here.length ? " · livre na origem: " + item.cover.here.map(p => p.prefix).join(", ") : "")));
      return row;
    }));
    if (!waiting.length) rows.push(element("li", "meta", "Todas as rotas deste tipo já têm voo registrado."));
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
    summary.textContent = "Pousos e decolagens nos " + flightLog.length + " voos lidos" +
      (flightsSince ? " desde " + dayText(flightsSince) : "") + ". Aeroportos pouco voados são boas oportunidades de voo." +
      (ideas.scope === "nacional" ? " Filtro: aeroportos no Brasil." : ideas.scope === "continental" ? " Filtro: resto da América do Sul." :
        ideas.scope === "intercontinental" ? " Filtro: fora da América do Sul." : "");
    const airportRow = item => {
      const row = element("li");
      const head = element("div", "row-head");
      head.append(button(item.code + " · " + (airports[item.code].city || airportName(item.code)), "item-heading", () => chooseAirport(item.code)));
      head.append(element("span", "tag " + (item.total ? "neutral" : "warn"), item.total ? item.total + (item.total > 1 ? " movimentos" : " movimento") : "Nunca voado"));
      row.append(head, element("span", "meta", airportName(item.code) + " · " + countryName(airports[item.code].country) + " · " +
        item.departures + (item.departures === 1 ? " rota de partida" : " rotas de partida") + " · " +
        item.planes + (item.planes === 1 ? " aeronave aqui" : " aeronaves aqui")));
      return row;
    };
    rows.push(element("li", "group", "Mais voados"), ...(most.length ? most.map(airportRow) : [element("li", "meta", "Nenhum voo lido ainda.")]),
      element("li", "group", "Menos voados"), ...least.map(airportRow));
  }
  list.replaceChildren(...rows);
}

for (const tabButton of document.querySelectorAll("#idea-tabs button")) {
  tabButton.addEventListener("click", () => { ideas.view = tabButton.dataset.view; ideas.limit = 12; renderSuggestions(); });
}

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
  ["companyMinutes", "Horas na Vortex (total)"],
  ["flights", "Voos lidos*"],
  ["minutes", "Horas nos voos lidos*"],
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
    "\"Horas na Vortex (total)\" vem do PilOps e soma tudo desde a entrada do piloto na companhia. " +
    "* As colunas com asterisco contam só os voos que o planejador já leu " +
    (flightsSince ? "desde " + dayText(flightsSince) : "nas sincronizações") + " (" + flightLog.length + " voos), " +
    "por isso são bem menores: o PilOps mostra só os 10 voos mais recentes, e elas crescem a cada sincronização.";

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
  circuits = findCircuits();
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
  renderAlerts();
  renderRanking();
}

start();
