// Validação e montagem do docs/dados.json. Uma leitura incompleta nunca substitui os dados publicados.
const airportCode = /^[A-Z0-9]{3,5}$/;
const tailCode = /^[A-Z0-9-]{2,12}$/;
const pilotName = /^[\w.-]{1,40}$/;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit;
const validCode = code => typeof code === "string" && airportCode.test(code);
const count = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const amount = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// O PilOps mostra só os 10 últimos voos; guardamos tudo o que já foi lido, sem repetir.
const flightKey = f => [f.date, f.pilot, f.prefix, f.origin, f.destination, f.minutes, f.revenue].join("|");
const maxStoredFlights = 20000;

function cleanPilots(pilots) {
  if (!Array.isArray(pilots) || pilots.length < 1 || pilots.length > 500) return null;
  if (!pilots.every(p => isRecord(p) && pilotName.test(p.name || "") && (p.role === null || label(p.role, 20)) &&
      (p.level === null || count(p.level, 1000)) && count(p.totalMinutes, 10_000_000) && count(p.companyMinutes, 10_000_000) &&
      (p.joined === null || isoDay.test(p.joined || ""))) || new Set(pilots.map(p => p.name)).size !== pilots.length) return null;
  return pilots.map(({ name, role, level, totalMinutes, companyMinutes, joined }) =>
    ({ name, role, level, totalMinutes, companyMinutes, joined }));
}

function cleanFlights(flights) {
  if (!Array.isArray(flights) || flights.length > 200) return null;
  if (!flights.every(f => isRecord(f) && pilotName.test(f.pilot || "") && tailCode.test(f.prefix || "") && label(f.model, 120) &&
      validCode(f.origin) && validCode(f.destination) && isoDay.test(f.date || "") && count(f.minutes, 3000) &&
      amount(f.nm, 0, 20000) && (f.payload === null || amount(f.payload, 0, 2_000_000)) && amount(f.revenue, -1e10, 1e10))) return null;
  return flights.map(({ pilot, prefix, model, origin, destination, date, minutes, nm, payload, revenue }) =>
    ({ pilot, prefix, model, origin, destination, date, minutes, nm, payload, revenue }));
}

// input: leitura da extensão; previous: dados.json publicado (ou null).
export function buildSnapshot(input, previous, now = new Date()) {
  const data = input;
  if (!isRecord(data) || !Array.isArray(data.fleet) || data.fleet.length < 1 || data.fleet.length > 250 ||
      !Array.isArray(data.routes) || data.routes.length > 1000 ||
      !Array.isArray(data.hubs) || data.hubs.length < 1 || data.hubs.length > 20 ||
      !Number.isInteger(data.reportedFleet) || data.reportedFleet < data.fleet.length || data.reportedFleet > 250) return null;
  const { fleet, routes, hubs } = data;
  if (!fleet.every(p => isRecord(p) && typeof p.prefix === "string" && tailCode.test(p.prefix) &&
    label(p.model, 120) && validCode(p.airport) && (p.base === null || validCode(p.base)) && label(p.status, 180)) ||
    new Set(fleet.map(p => p.prefix)).size !== fleet.length ||
    !routes.every(r => isRecord(r) && validCode(r.origin) && validCode(r.destination) &&
      r.origin !== r.destination && typeof r.code === "string" && /^VTX[0-9]{1,12}$/.test(r.code)) ||
    !hubs.every(validCode) || new Set(hubs).size !== hubs.length) return null;

  // Pilotos e voos são opcionais: se a leitura falhar, mantemos o que já estava publicado.
  const pilots = data.pilots === undefined || data.pilots === null ? null : cleanPilots(data.pilots);
  const newFlights = data.flights === undefined || data.flights === null ? null : cleanFlights(data.flights);
  const merged = new Map((previous?.flights || []).map(f => [flightKey(f), f]));
  let added = 0;
  for (const f of newFlights || []) {
    if (!merged.has(flightKey(f))) { merged.set(flightKey(f), f); added++; }
  }
  const flights = [...merged.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxStoredFlights);
  const today = now.toISOString().slice(0, 10);

  return {
    snapshot: {
      capturedAt: now.toISOString(),
      reportedFleet: data.reportedFleet,
      fleet: fleet.map(({ prefix, model, airport, base, status }) => ({ prefix, model, airport, base, status })),
      routes: routes.map(({ origin, destination, code }) => ({ origin, destination, code })),
      hubs,
      pilots: pilots || previous?.pilots || [],
      pilotsCapturedAt: pilots ? now.toISOString() : previous?.pilotsCapturedAt || null,
      flights,
      // Primeiro dia em que o histórico de voos foi lido: o ranking por voos vale a partir daqui.
      flightsSince: previous?.flightsSince || (newFlights ? (flights.at(-1)?.date || today) : null),
    },
    report: { pilotsRead: Boolean(pilots), pilotsInvalid: data.pilots != null && !pilots,
      flightsRead: Boolean(newFlights), flightsInvalid: data.flights != null && !newFlights, flightsAdded: added },
  };
}
