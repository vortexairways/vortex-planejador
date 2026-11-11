const VortexTimes = (() => {
  const maxAge = 30 * 86400000;
  // Apenas modelos sem ambiguidade de variante. Modelos genéricos continuam no catálogo.
  const types = {
    "Boeing 787-10 Dreamliner": "B78X", "Boeing 787-9 Dreamliner": "B789",
    "Boeing 787-8 Dreamliner": "B788", "Douglas MD-11": "MD11",
    "Airbus A220-300": "BCS3", "Airbus A220-100": "BCS1", "Airbus A321": "A321",
    "Airbus A320neo": "A20N", "Airbus A320": "A320", "Airbus A321neo": "A21N",
    "Embraer E195": "E195", "Boeing 707-320C": "B703",
  };
  const typeOf = model => types[model] || null;
  function seconds(value) {
    if (typeof value === "string" && /^\d{1,2}:\d{2}:\d{2}$/.test(value)) {
      const [h, m, s] = value.split(":").map(Number);
      return m < 60 && s < 60 ? h * 3600 + m * 60 + s : null;
    }
    return (typeof value === "number" || typeof value === "string" && /^\d+$/.test(value)) &&
      Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  }
  function reference(item) {
    if (!item || ![item.origin, item.destination].every(code => typeof code === "string" && /^[A-Z0-9]{3,5}$/.test(code)) ||
        item.origin === item.destination || typeof item.aircraftType !== "string" || !/^[A-Z0-9]{2,4}$/.test(item.aircraftType) ||
        !Number.isFinite(item.blockSeconds) || item.blockSeconds <= 0 || item.blockSeconds > 172800 ||
        typeof item.generatedAt !== "string" || !Number.isFinite(Date.parse(item.generatedAt))) return null;
    const enroute = Number.isFinite(item.enrouteSeconds) && item.enrouteSeconds > 0 && item.enrouteSeconds <= item.blockSeconds
      ? item.enrouteSeconds : null;
    return { origin: item.origin, destination: item.destination, aircraftType: item.aircraftType,
      blockSeconds: item.blockSeconds, enrouteSeconds: enroute, generatedAt: new Date(item.generatedAt).toISOString() };
  }
  function readOFP(data) {
    if (data?.fetch?.status !== "Success") return null;
    const generated = data.params?.time_generated;
    const date = new Date(typeof generated === "string" && /^\d{4}-/.test(generated) ? generated : Number(generated) * 1000);
    const generatedAt = generated && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    return reference({ origin: data.origin?.icao_code, destination: data.destination?.icao_code,
      aircraftType: data.aircraft?.icaocode, blockSeconds: seconds(data.times?.est_block),
      enrouteSeconds: seconds(data.times?.est_time_enroute), generatedAt });
  }
  const key = item => [item.origin, item.destination, item.aircraftType].join("-");
  function records(items) {
    const unique = new Map();
    for (const input of (Array.isArray(items) ? items : []).slice(0, 1000)) {
      const item = reference(input);
      if (item && (!unique.has(key(item)) || Date.parse(item.generatedAt) > Date.parse(unique.get(key(item)).generatedAt))) unique.set(key(item), item);
    }
    return [...unique.values()].sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).slice(0, 100);
  }
  function active(item, now = Date.now()) {
    const age = now - Date.parse(item.generatedAt);
    return age >= -300000 && age <= maxAge;
  }
  function estimate({ origin, destination, plane, miles, performance, references = [], now = Date.now() }) {
    const aircraftType = typeOf(plane?.model);
    const record = aircraftType && records(references).find(item => item.origin === origin && item.destination === destination &&
      item.aircraftType === aircraftType && active(item, now));
    if (record) return { minutes: Math.ceil(record.blockSeconds / 60), source: "simbrief", record };
    const minutes = performance && Number.isFinite(performance.speed) && performance.speed > 0 &&
      Number.isFinite(miles) && miles >= 0 ? Math.round((miles / performance.speed + 0.5) * 12) * 5 : null;
    return { minutes, source: "catalog", record: null };
  }
  function summary(estimates) {
    const count = estimates.filter(item => item.source === "simbrief").length;
    return { minutes: estimates.length && estimates.every(item => Number.isFinite(item.minutes))
      ? estimates.reduce((sum, item) => sum + item.minutes, 0) : null,
    source: count === estimates.length && count ? "simbrief" : count ? "mixed" : "catalog", count, total: estimates.length };
  }
  function endpoint(identifier) {
    const value = String(identifier || "").trim();
    if (!value || value.length > 80 || /[\x00-\x1f\x7f]/.test(value)) return null;
    const url = new URL("https://www.simbrief.com/api/xml.fetcher.php");
    url.search = new URLSearchParams({ [/^\d+$/.test(value) ? "userid" : "username"]: value,
      client: "vortex-planejador-1.0", json: "v2" });
    return url.href;
  }
  return { typeOf, seconds, reference, readOFP, records, active, estimate, summary, endpoint };
})();
