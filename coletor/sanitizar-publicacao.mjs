import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { publicSnapshot } from "./publicacao.mjs";
import { withFuel } from "./dados.mjs";

const publicFile = new URL("../docs/dados.json", import.meta.url);
const privateDir = new URL("../.vortex-local/", import.meta.url);
const privateFile = new URL("dados.json", privateDir);
const published = JSON.parse(readFileSync(publicFile, "utf8"));
let privateData;
try { privateData = JSON.parse(readFileSync(privateFile, "utf8")); } catch { }
const legacyFinancial = (published.flights || []).some(flight => Number.isFinite(flight.revenue));
const source = legacyFinancial && (!privateData || published.capturedAt >= privateData.capturedAt) ? published : privateData || published;
const { activeFlights, activeFlightsCapturedAt, ...history } = source;
// Voos lidos até a extensão 1.5.0 guardavam o combustível utilizado como "payload".
history.flights = (history.flights || []).map(flight => Number.isFinite(flight.revenue) ? withFuel(flight) : flight);
mkdirSync(privateDir, { recursive: true });
writeFileSync(privateFile, JSON.stringify(history, null, 1) + "\n");
const safe = publicSnapshot(history);
writeFileSync(publicFile, JSON.stringify(safe, null, 1) + "\n");
console.log("Publicação reduzida: " + safe.flights.length + " voos preservados; financeiro só em percentuais e medianas por rota e modelo. Histórico completo guardado localmente fora do Git.");
