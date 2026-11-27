// Somente este resultado pode ser enviado ao GitHub. O histórico voo a voo fica local; desde 27/11/2026,
// por decisão do Rafael, a renda estimada sai publicada só como medianas por rota e modelo (sem voo individual).
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ratio = flight => flight.revenue / flight.payload;
const rounded = value => Number.isFinite(value) ? Math.round(value * 1000000) / 1000000 : null;

export function percentageMonitor(flights) {
  const groups = new Map();
  const paid = [...flights].reverse().filter(f => Number.isFinite(f.revenue) && f.revenue > 0 &&
    Number.isFinite(f.payload) && f.payload > 0).sort((a, b) => a.date.localeCompare(b.date));
  for (const flight of paid) {
    const key = [flight.origin, flight.destination, flight.model].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(flight);
  }
  return { readCount: paid.length, groups: [...groups.values()].map(list => {
    const changes = list.map((flight, i) => i ? ratio(flight) / median(list.slice(0, i).map(ratio)) - 1 : null);
    const change = rounded(changes.at(-1));
    const state = list.length < 2 ? "unico" : change <= -0.10 ? "queda" : change >= 0.10 ? "alta"
      : changes.some(value => value !== null && value <= -0.10) ? "recuperada" : "estavel";
    const { origin, destination, model } = list[0];
    return { origin, destination, model, count: list.length, lastDate: list.at(-1).date, change, state };
  }) };
}

// Renda de referência para o comparador de cargas: medianas dos últimos voos pagos (até 10 por rota e modelo,
// até 30 por modelo). Nada identifica um voo, um piloto ou uma data.
export function revenueEstimates(flights) {
  const paid = flights.filter(f => Number.isFinite(f.revenue) && f.revenue > 0 && Number.isFinite(f.payload) && f.payload > 0 &&
    Number.isFinite(f.minutes) && f.minutes > 0 && Number.isFinite(f.nm) && f.nm > 0 && typeof f.date === "string")
    .sort((a, b) => b.date.localeCompare(a.date));
  const grouped = keyOf => {
    const groups = new Map();
    for (const flight of paid) {
      const key = keyOf(flight);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(flight);
    }
    return [...groups.values()];
  };
  const routes = grouped(f => [f.origin, f.destination, f.model].join("|")).map(all => {
    const list = all.slice(0, 10), { origin, destination, model } = list[0];
    return { origin, destination, model, count: list.length,
      perFlight: Math.round(median(list.map(f => f.revenue))),
      perHour: Math.round(median(list.map(f => f.revenue / f.minutes * 60))),
      perLb: Math.round(median(list.map(ratio)) * 100) / 100,
      lbs: Math.round(median(list.map(f => f.payload))) };
  });
  const models = grouped(f => f.model).map(all => {
    const list = all.slice(0, 30);
    return { model: list[0].model, count: list.length,
      perLbNm: rounded(median(list.map(f => ratio(f) / f.nm))),
      lbs: Math.round(median(list.map(f => f.payload))) };
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
  };
}
