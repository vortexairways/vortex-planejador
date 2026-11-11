// Somente este resultado pode ser enviado ao GitHub. O histórico financeiro fica local.
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
  };
}
