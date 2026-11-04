// Gera docs/aeroportos.js a partir do airports.csv do OurAirports (domínio público).
// Uso: node tools/gerar-aeroportos.mjs caminho/airports.csv
// Inclui aeroportos grandes e médios com código de 4 caracteres e os pequenos com ICAO oficial,
// para que qualquer destino novo da Vortex no PilOps já tenha coordenadas.
import { readFileSync, writeFileSync } from "node:fs";

const source = process.argv[2];
if (!source) throw new Error("Informe o caminho do airports.csv do OurAirports.");

function parse(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [header, ...lines] = parse(readFileSync(source, "utf8"));
const col = Object.fromEntries(header.map((name, i) => [name, i]));
const four = /^[A-Z0-9]{4}$/;
const rank = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const airports = new Map();
for (const r of lines) {
  const type = r[col.type];
  if (!rank[type] || (type === "small_airport" && !four.test(r[col.icao_code] || ""))) continue;
  const code = [r[col.icao_code], r[col.gps_code], r[col.ident]].find(value => four.test(value || ""));
  const lat = Number(r[col.latitude_deg]);
  const lon = Number(r[col.longitude_deg]);
  if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  const previous = airports.get(code);
  // Em códigos repetidos, prefere o registro com ICAO oficial e o aeroporto de maior porte.
  const score = rank[type] + (r[col.icao_code] === code ? 10 : 0);
  if (previous && previous.score >= score) continue;
  airports.set(code, {
    score, lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
    name: r[col.name].replace(/\|/g, "/"), city: (r[col.municipality] || "").replace(/\|/g, "/"),
  });
}

const body = [...airports].sort(([a], [b]) => a.localeCompare(b))
  .map(([code, a]) => [code, a.lat, a.lon, a.name, a.city].join("|")).join("\n");
writeFileSync(new URL("../docs/aeroportos.js", import.meta.url),
  "// Coordenadas de OurAirports (ourairports.com/data, domínio público). Gerado por tools/gerar-aeroportos.mjs.\n" +
  "// Código | Latitude | Longitude | Nome | Cidade\n" +
  "const airports = Object.fromEntries(" + JSON.stringify(body) + String.raw`.split("\n").map(line => {` + "\n" +
  '  const [code, lat, lon, name, city] = line.split("|");\n' +
  "  return [code, { lat: Number(lat), lon: Number(lon), name, city }];\n" +
  "}));\n");
console.log(airports.size + " aeroportos gravados.");
