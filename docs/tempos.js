const VortexTimes = (() => {
  const modelKey = value => typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
  const validDay = day => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

  // Referência histórica da mesma direção e modelo, sem promessa para o próximo voo.
  function estimate({ origin, destination, plane, miles, performance, flights = [] }) {
    const model = modelKey(plane?.model);
    const samples = model && origin && destination && Array.isArray(flights) ? flights.filter(flight =>
      flight && flight.origin === origin && flight.destination === destination && modelKey(flight.model) === model &&
      validDay(flight.date) && Number.isFinite(flight.minutes) && flight.minutes > 0 && flight.minutes <= 2880)
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10) : [];
    if (samples.length) {
      const values = samples.map(flight => flight.minutes).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      return { minutes: Math.round(median), source: "pilops", count: samples.length, lastDate: samples[0].date };
    }
    const minutes = plane && performance && Number.isFinite(performance.speed) && performance.speed > 0 &&
      Number.isFinite(miles) && miles >= 0 ? Math.round((miles / performance.speed + 0.5) * 12) * 5 : null;
    return { minutes, source: "catalog", count: 0, lastDate: null };
  }
  function summary(estimates) {
    const count = estimates.filter(item => item.source === "pilops").length;
    return { minutes: estimates.length && estimates.every(item => Number.isFinite(item.minutes))
      ? estimates.reduce((sum, item) => sum + item.minutes, 0) : null,
    source: count === estimates.length && count ? "pilops" : count ? "mixed" : "catalog", count, total: estimates.length };
  }
  return { estimate, summary };
})();
