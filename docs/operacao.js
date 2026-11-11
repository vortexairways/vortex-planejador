// Regras da operação e texto de compartilhamento, também usados na validação local.
const VortexOperation = (() => {
  const pair = route => route.origin + "-" + route.destination;
  const validDay = day => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

  function read(config, routes) {
    if (!config || !validDay(config.start) || !validDay(config.end) || config.start > config.end ||
        !Number.isInteger(config.goal) || config.goal < 1 || config.goal > 10000 ||
        ![config.title?.pt, config.title?.en].every(value => typeof value === "string" && value.trim() && value.length <= 100) ||
        !Array.isArray(config.routes) || !config.routes.length || config.routes.length > 5 ||
        !config.routes.every(route => route && /^[A-Z0-9]{3,5}$/.test(route.origin || "") &&
          /^[A-Z0-9]{3,5}$/.test(route.destination || "") && route.origin !== route.destination) ||
        new Set(config.routes.map(pair)).size !== config.routes.length) return null;
    return { ...config, routes: config.routes.map(item => ({ ...item,
      route: routes.find(route => pair(route) === pair(item)) || null })) };
  }

  function progress(operation, flights) {
    const eligible = new Set(operation.routes.filter(item => item.route).map(pair));
    const completed = flights.filter(flight => eligible.has(pair(flight)) && flight.date >= operation.start &&
      flight.date <= operation.end && flight.paid === true && flight.minutes > 0);
    const pilots = new Map();
    for (const flight of completed) {
      const pilot = pilots.get(flight.pilot) || { name: flight.pilot, flights: 0, routes: new Set() };
      pilot.flights++;
      pilot.routes.add(pair(flight));
      pilots.set(pilot.name, pilot);
    }
    const ranking = [...pilots.values()].map(pilot => ({ ...pilot, routes: pilot.routes.size }))
      .sort((a, b) => b.flights - a.flights || b.routes - a.routes || a.name.localeCompare(b.name));
    for (let i = 0; i < ranking.length; i++) ranking[i].rank = i + 1;
    return { completed, ranking };
  }

  function share({ legs, plane, pilot, status = "today", minutes, miles, url, timeSource = "catalog", simbriefLegs = 0 }) {
    const name = String(pilot || "").trim().replace(/^@/, "").replace(/[@`*<>\r\n]/g, "").slice(0, 40);
    const headings = legs.length > 1 ? {
      today: ["Meu plano de voos pela Vortex", "My Vortex flight plan"],
      planned: ["Meus próximos voos pela Vortex", "My next Vortex flights"],
      airborne: ["Meu plano de voos em andamento pela Vortex", "My Vortex flight plan in progress"],
      completed: ["Plano de voos concluído pela Vortex", "Vortex flight plan completed"],
    } : {
      today: ["Meu voo pela Vortex", "My Vortex flight"],
      planned: ["Próximo voo pela Vortex", "My next Vortex flight"],
      airborne: ["Meu voo em andamento pela Vortex", "My Vortex flight in progress"],
      completed: ["Voo concluído pela Vortex", "Vortex flight completed"],
    };
    const heading = headings[status] || headings.today;
    const routeLines = legs.map(leg => leg.origin + " → " + leg.destination + " · " + leg.code).join("\n");
    const aircraft = plane ? plane.model + " · " + plane.prefix : "";
    const duration = Number.isFinite(minutes) ? Math.floor(minutes / 60) + "h" + String(minutes % 60).padStart(2, "0") : null;
    const distance = Number.isFinite(miles) ? Math.round(miles) + " nm" : null;
    const facts = [name && "@" + name, routeLines, aircraft].filter(Boolean).join("\n");
    const basisPT = timeSource === "simbrief" ? "bloco planejado no SimBrief ≈ " : "duração estimada ≈ ";
    const basisEN = timeSource === "simbrief" ? "SimBrief planned block time ≈ " : "estimated duration ≈ ";
    const mixedPT = timeSource === "mixed" ? "SimBrief em " + simbriefLegs + "/" + legs.length + " trechos; demais por catálogo" : null;
    const mixedEN = timeSource === "mixed" ? "SimBrief on " + simbriefLegs + "/" + legs.length + " legs; others from catalogue" : null;
    const estimatePT = [distance, duration && basisPT + duration, duration && mixedPT].filter(Boolean).join(" · ");
    const estimateEN = [distance, duration && basisEN + duration, duration && mixedEN].filter(Boolean).join(" · ");
    return ["✈️ " + heading[0], facts, estimatePT,
      "Quem vai somar mais um trecho hoje? Escolham suas rotas e compartilhem seus próprios voos no grupo!", "",
      "✈️ " + heading[1], facts, estimateEN,
      "Who’s logging another leg today? Pick your routes and share your own flights with the group!", "",
      "Planejador / Planner · " + url].filter(line => line !== null).join("\n");
  }

  return { read, progress, share, pair };
})();
