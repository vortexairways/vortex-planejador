const VortexNetwork = (() => {
  const pathLabel = legs => [legs[0].origin, ...legs.map(leg => leg.destination)].join(" → ");
  const direct = (routes, from, to) => routes.find(route => route.origin === from && route.destination === to);
  const ferried = (origin, destination) => ({ origin, destination, code: "Traslado" });

  function graph(routes, distance, allowed = () => true) {
    const departures = new Map();
    for (const route of routes) {
      const miles = distance(route.origin, route.destination);
      if (!Number.isFinite(miles) || !allowed(route, miles)) continue;
      if (!departures.has(route.origin)) departures.set(route.origin, []);
      departures.get(route.origin).push({ route, miles });
    }
    return departures;
  }

  function shortest(departures, from, to) {
    const pending = new Map([[from, { legs: [], miles: 0 }]]);
    const visited = new Set();
    while (pending.size) {
      let best;
      for (const entry of pending) {
        if (!best || entry[1].miles < best[1].miles) best = entry;
      }
      const [airport, current] = best;
      if (airport === to) return current.legs;
      pending.delete(airport);
      visited.add(airport);
      for (const { route, miles } of departures.get(airport) || []) {
        const total = current.miles + miles;
        if (!visited.has(route.destination) && total < (pending.get(route.destination)?.miles ?? Infinity)) {
          pending.set(route.destination, { legs: [...current.legs, route], miles: total });
        }
      }
    }
    return null;
  }

  function returnOptions(route, routes, distance, allowed = () => true) {
    const { origin, destination } = route;
    const reverse = direct(routes, destination, origin);
    const back = graph(routes.filter(leg => leg.origin !== destination || leg.destination !== origin), distance, allowed);
    const miles = distance(destination, origin);
    const options = [];
    if (reverse && Number.isFinite(miles) && allowed(reverse, miles)) {
      options.push({ kind: "direct", legs: [route, reverse] });
    }
    const connection = shortest(back, destination, origin);
    if (connection) options.push({ kind: "connection", legs: [route, ...connection] });
    const ferry = ferried(destination, origin);
    if (!reverse && Number.isFinite(miles) && allowed(ferry, miles)) {
      options.push({ kind: "ferry", legs: [route, ferry] });
    }
    return { reverse, options };
  }

  function newCircuits(route, routes, distance) {
    const departures = graph(routes, distance);
    const returning = shortest(departures, route.destination, route.origin);
    if (!returning) return [];
    const found = new Map();
    function include(legs) {
      const cycle = [route, ...legs];
      found.set(pathLabel(cycle), cycle);
    }
    include(returning);
    let remaining = 5000;
    function visit(airport, path, seen) {
      remaining--;
      for (const { route: leg } of departures.get(airport) || []) {
        if (found.size >= 5 || remaining <= 0) return;
        if (leg.destination === route.origin) include([...path, leg]);
        else if (path.length < 4 && !seen.has(leg.destination)) {
          visit(leg.destination, [...path, leg], new Set([...seen, leg.destination]));
        }
      }
    }
    visit(route.destination, [], new Set([route.destination]));
    return [...found.values()].sort((a, b) => a.length - b.length);
  }

  // C/D/E/F se referem à envergadura. Este cadastro só sinaliza os modelos revisados.
  const modelCodes = [
    [/\b(?:A300|A310)\b/i, "D"], [/\bA330(?:neo)?\b/i, "E"], [/\bA350\b/i, "E"],
    [/\bA380\b/i, "F"], [/\b(?:707|757|767)\b/i, "D"], [/\b(?:777|787)\b/i, "E"],
    [/\b(?:MD[ -]?11|DC[ -]?10)\b/i, "D"],
  ];
  const congonhas = "https://aisweb.decea.mil.br/?codigo=SBSP&i=aerodromos";
  function airportReview(route, model = "") {
    if (route.origin !== "SBSP" && route.destination !== "SBSP") return null;
    const code = modelCodes.find(([pattern]) => pattern.test(model))?.[1] || null;
    return { code, source: congonhas };
  }

  function readSharedPlan(value, routes, from, to, knownAirport) {
    if (!value) return null;
    const pairs = value.split(",");
    if (pairs.length > 30) return null;
    const legs = [];
    for (const pair of pairs) {
      const match = /^(F:)?([A-Z0-9]{3,5})-([A-Z0-9]{3,5})$/.exec(pair);
      if (!match) return null;
      const [, ferry, origin, destination] = match;
      if (origin === destination || origin !== (legs.at(-1)?.destination || from) ||
          (!legs.length && destination !== to)) return null;
      const route = ferry ? knownAirport(origin) && knownAirport(destination) && ferried(origin, destination)
        : direct(routes, origin, destination);
      if (!route) return null;
      legs.push(route);
    }
    return legs;
  }

  return { pathLabel, direct, ferried, returnOptions, newCircuits, airportReview, readSharedPlan };
})();
