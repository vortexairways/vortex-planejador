// Somente este resultado pode ser enviado ao GitHub. O histórico voo a voo fica local; desde 27/11/2026,
// por decisão do Rafael, a renda estimada sai publicada só como medianas por rota e modelo (sem voo individual).
// As "lbs" do histórico do PilOps são o COMBUSTÍVEL UTILIZADO em cada voo (campo fuel), não a carga.
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const rounded = value => Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : null;
const positive = value => Number.isFinite(value) && value > 0;
const fuelOf = flight => flight.fuel ?? flight.payload;
const routeKey = flight => [flight.origin, flight.destination, flight.model].join("|");
const newestFirst = list => [...list].sort((a, b) => b.date.localeCompare(a.date));
function grouped(list, keyOf) {
  const groups = new Map();
  for (const flight of list) {
    const key = keyOf(flight);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(flight);
  }
  return [...groups.values()];
}

// Na mesma rota e modelo a distância não muda, então o P$ por voo é comparável de um voo para outro. Medido em
// 27/11/2026, ele oscila menos (5–15%) do que o P$ dividido pelo combustível (12–35%).
export function percentageMonitor(flights) {
  const paid = [...flights].reverse().filter(f => positive(f.revenue)).sort((a, b) => a.date.localeCompare(b.date));
  return { readCount: paid.length, groups: grouped(paid, routeKey).map(list => {
    const changes = list.map((flight, i) => i ? flight.revenue / median(list.slice(0, i).map(f => f.revenue)) - 1 : null);
    const change = rounded(changes.at(-1));
    const state = list.length < 2 ? "unico" : change <= -0.10 ? "queda" : change >= 0.10 ? "alta"
      : changes.some(value => value !== null && value <= -0.10) ? "recuperada" : "estavel";
    const { origin, destination, model } = list[0];
    return { origin, destination, model, count: list.length, lastDate: list.at(-1).date, change, state };
  }) };
}

// Renda de referência para o comparador: medianas dos últimos voos pagos (até 10 por rota e modelo, até 30 por
// modelo). Nada identifica um voo, um piloto ou uma data.
export function revenueEstimates(flights) {
  const paid = newestFirst(flights.filter(f => positive(f.revenue) && positive(f.minutes) && positive(f.nm) &&
    typeof f.date === "string"));
  const routes = grouped(paid, routeKey).map(all => {
    const list = all.slice(0, 10), { origin, destination, model } = list[0];
    return { origin, destination, model, count: list.length,
      perFlight: Math.round(median(list.map(f => f.revenue))),
      perHour: Math.round(median(list.map(f => f.revenue / f.minutes * 60))) };
  });
  const models = grouped(paid, f => f.model).map(all => {
    const list = all.slice(0, 30);
    return { model: list[0].model, count: list.length,
      perNm: Math.round(median(list.map(f => f.revenue / f.nm)) * 100) / 100,
      perHour: Math.round(median(list.map(f => f.revenue / f.minutes * 60))) };
  });
  return { routes, models };
}

// Consumo real da frota: combustível utilizado nos voos da Vortex. Por modelo, lb por hora e por nm (voos de
// 30 min ou mais, incluindo traslados, últimos 30); por rota e modelo, a mediana do combustível dos últimos
// 10 voos pagos.
export function fuelStats(flights) {
  const valid = newestFirst(flights.filter(f => positive(fuelOf(f)) && positive(f.minutes) && positive(f.nm) &&
    typeof f.date === "string"));
  const models = grouped(valid.filter(f => f.minutes >= 30), f => f.model).map(all => {
    const list = all.slice(0, 30);
    return { model: list[0].model, count: list.length,
      perHour: Math.round(median(list.map(f => fuelOf(f) / f.minutes * 60))),
      perNm: Math.round(median(list.map(f => fuelOf(f) / f.nm)) * 10) / 10 };
  });
  const routes = grouped(valid.filter(f => positive(f.revenue)), routeKey).map(all => {
    const list = all.slice(0, 10), { origin, destination, model } = list[0];
    return { origin, destination, model, count: list.length, fuel: Math.round(median(list.map(fuelOf))) };
  });
  return { routes, models };
}

export function publicSnapshot(data) {
  return {
    capturedAt: data.capturedAt, reportedFleet: data.reportedFleet,
    fleet: data.fleet.map(({ prefix, model, airport, base, status }) => ({ prefix, model, airport, base, status })),
    routes: data.routes.map(({ origin, destination, code }) => ({ origin, destination, code })),
    hubs: [...data.hubs],
    pilots: (data.pilots || []).map(({ name, role, level, totalMinutes, companyMinutes, joined }) =>
      ({ name, role, level, totalMinutes, companyMinutes, joined })),
    pilotsCapturedAt: data.pilotsCapturedAt || null,
    flights: (data.flights || []).map(f => ({ pilot: f.pilot, prefix: f.prefix, model: f.model,
      origin: f.origin, destination: f.destination, date: f.date, minutes: f.minutes, nm: f.nm,
      paid: Number.isFinite(f.revenue) ? f.revenue > 0 : f.paid === true })),
    flightsSince: data.flightsSince || null,
    revenueMonitor: percentageMonitor(data.flights || []),
    revenueEstimates: revenueEstimates(data.flights || []),
    fuelStats: fuelStats(data.flights || []),
  };
}
