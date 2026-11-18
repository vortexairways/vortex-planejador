// Classifica o trajeto pela malha cadastrada, sem presumir intenção ou autorização do piloto.
const VortexMovements = (() => {
  function classify(flight, routes) {
    if (routes.some(route => route.origin === flight.origin && route.destination === flight.destination)) return "registered";
    const network = new Set(routes.map(route => route.origin));
    if (!network.has(flight.destination)) return "outside";
    if (!network.has(flight.origin)) return "return";
    return "reposition";
  }
  function outsideAircraft(fleet, flights, network) {
    const outside = fleet.filter(plane => !network.has(plane.airport));
    const latest = new Map(outside.map(plane => [plane.prefix, { date: "", flights: [] }]));
    for (const flight of flights) {
      const day = latest.get(flight.prefix);
      if (!day || flight.date < day.date) continue;
      if (flight.date > day.date) {
        day.date = flight.date;
        day.flights = [];
      }
      day.flights.push(flight);
    }
    return outside.map(plane => {
      const day = latest.get(plane.prefix).flights;
      const arrivals = day.filter(flight => flight.destination === plane.airport);
      // O histórico só traz a data. Se houver mais de uma chegada ou uma saída
      // no mesmo dia, não é possível atribuir o deslocamento com segurança.
      const departure = day.some(flight => flight.origin === plane.airport && flight.destination !== plane.airport);
      return { plane, arrival: arrivals.length === 1 && !departure ? arrivals[0] : null };
    });
  }
  return { classify, outsideAircraft };
})();
