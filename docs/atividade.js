// Janelas fixas de 30 dias. Datas de calendário, sem depender do fuso do navegador.
const VortexActivity = (() => {
  const dayMs = 86400000;
  const validDay = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const stamp = value => Date.parse(value + "T00:00:00Z");
  const iso = value => new Date(value).toISOString().slice(0, 10);
  const today = (now = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(now);

  function read(config) {
    return config && validDay(config.start) ? { start: config.start } : null;
  }

  function period(config, currentDay) {
    if (!config || !validDay(currentDay)) return null;
    const anchor = stamp(config.start);
    const current = stamp(currentDay);
    const cycle = Math.max(0, Math.floor((current - anchor) / (30 * dayMs)));
    const start = anchor + cycle * 30 * dayMs;
    const next = start + 30 * dayMs;
    return { start: iso(start), end: iso(next - dayMs), next: iso(next), active: current >= anchor,
      daysRemaining: Math.min(30, Math.max(0, Math.round((next - current) / dayMs))) };
  }

  function counts(window, flights, currentDay) {
    const totals = new Map();
    if (!window?.active) return totals;
    for (const flight of flights) {
      if (!validDay(flight.date) || flight.date < window.start || flight.date >= window.next ||
          flight.date > currentDay || !(flight.minutes > 0)) continue;
      totals.set(flight.pilot, (totals.get(flight.pilot) || 0) + 1);
    }
    return totals;
  }

  return { read, period, counts, today };
})();
