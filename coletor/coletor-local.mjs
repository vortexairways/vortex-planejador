// Coleta única: espera a extensão do Chrome ler a Vortex no PilOps, grava docs/dados.json
// e publica no GitHub (commit + push). Rode pelo atalho "Sincronizar Vortex".
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const dataFile = new URL("../docs/dados.json", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("./extensao-chrome/manifest.json", import.meta.url), "utf8"));
const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
const extensionOrigin = "chrome-extension://" + [...hex].map(n => String.fromCharCode(97 + parseInt(n, 16))).join("");
const waitMinutes = 5;
const maxAttempts = 2;

const airportCode = /^[A-Z0-9]{3,5}$/;
const tailCode = /^[A-Z0-9-]{2,12}$/;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const label = (value, limit) => typeof value === "string" && value.trim() && value.length <= limit;

// Mesmas regras de validação do site antigo: uma leitura incompleta nunca substitui os dados publicados.
function cleanSnapshot(data) {
  if (!isRecord(data) || !Array.isArray(data.fleet) || data.fleet.length < 1 || data.fleet.length > 250 ||
      !Array.isArray(data.routes) || data.routes.length > 1000 ||
      !Array.isArray(data.hubs) || data.hubs.length < 1 || data.hubs.length > 20 ||
      !Number.isInteger(data.reportedFleet) || data.reportedFleet < data.fleet.length || data.reportedFleet > 250) return null;
  const validCode = code => typeof code === "string" && airportCode.test(code);
  const { fleet, routes, hubs } = data;
  if (!fleet.every(p => isRecord(p) && typeof p.prefix === "string" && tailCode.test(p.prefix) &&
    label(p.model, 120) && validCode(p.airport) && (p.base === null || validCode(p.base)) && label(p.status, 180)) ||
    new Set(fleet.map(p => p.prefix)).size !== fleet.length ||
    !routes.every(r => isRecord(r) && validCode(r.origin) && validCode(r.destination) &&
      r.origin !== r.destination && typeof r.code === "string" && /^VTX[0-9]{1,12}$/.test(r.code)) ||
    !hubs.every(validCode) || new Set(hubs).size !== hubs.length) return null;
  return {
    capturedAt: new Date().toISOString(),
    reportedFleet: data.reportedFleet,
    fleet: fleet.map(({ prefix, model, airport, base, status }) => ({ prefix, model, airport, base, status })),
    routes: routes.map(({ origin, destination, code }) => ({ origin, destination, code })),
    hubs,
  };
}

function git(...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function publish(snapshot) {
  writeFileSync(dataFile, JSON.stringify(snapshot, null, 1) + "\n");
  console.log("Coleta gravada: " + snapshot.fleet.length + " aeronaves, " + snapshot.routes.length +
    " rotas e " + snapshot.hubs.length + " hubs.");
  if (snapshot.reportedFleet !== snapshot.fleet.length) {
    // Em 04/11/2026 a API do PilOps listava 15 aeronaves com o contador em 16: a diferença é do PilOps.
    console.log("Observação: o contador do PilOps mostra " + snapshot.reportedFleet + " aeronaves, mas o PilOps lista " +
      snapshot.fleet.length + ". A coleta usa as listadas.");
  }
  git("add", "docs/dados.json");
  const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short",
    timeZone: "America/Sao_Paulo" }).format(new Date(snapshot.capturedAt));
  git("commit", "-q", "-m", "Dados da Vortex · coleta de " + stamp);
  console.log("Enviando ao GitHub…");
  // stdio herdado: na primeira vez o Git abre o login do GitHub no navegador.
  execFileSync("git", ["-C", repo, "push", "-q"], { stdio: "inherit" });
  console.log("Publicado. O site atualiza em 1 a 2 minutos.");
}

let lease = { id: randomUUID(), given: false, attempts: 0 };
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  console.log(message);
  server.close();
  setTimeout(() => process.exit(code), 200);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": extensionOrigin, Vary: "Origin" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 150_000) throw new Error("Leitura excede o limite.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (req, res) => {
  // Só a extensão da Vortex, por 127.0.0.1, conversa com este serviço.
  if (req.headers.origin !== extensionOrigin || req.headers.host !== "127.0.0.1:8768") {
    json(res, 403, { error: "Acesso restrito ao coletor Chrome." });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": extensionOrigin, "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST", Vary: "Origin" }).end();
    return;
  }
  if (req.method !== "POST" || !["/job", "/failed", "/snapshot"].includes(req.url)) {
    json(res, 404, {});
    return;
  }
  try {
    const input = await body(req);
    if (req.url === "/job") {
      if (finished || lease.given) return json(res, 200, {});
      lease.given = true;
      console.log("A extensão começou a ler a Vortex no PilOps…");
      return json(res, 200, { lease: lease.id });
    }
    if (input.lease !== lease.id) return json(res, 409, { error: "Pedido de coleta vencido." });
    if (req.url === "/failed") {
      lease = { id: randomUUID(), given: false, attempts: lease.attempts + 1 };
      json(res, 200, {});
      if (lease.attempts >= maxAttempts) {
        finish(1, "A leitura no PilOps falhou duas vezes. Confira se você está logado no PilOps no Chrome. Nada foi publicado.");
      } else {
        console.log("A leitura falhou; tentando de novo no próximo ciclo da extensão (até 1 minuto)…");
      }
      return;
    }
    const { fleet, routes, hubs, reportedFleet } = input;
    const snapshot = cleanSnapshot({ fleet, routes, hubs, reportedFleet });
    if (!snapshot) {
      json(res, 422, { error: "Leitura incompleta." });
      return finish(1, "A leitura veio incompleta ou inválida. Os dados publicados foram mantidos.");
    }
    publish(snapshot);
    json(res, 200, { capturedAt: snapshot.capturedAt, fleet: snapshot.fleet.length, routes: snapshot.routes.length });
    finish(0, "Sincronização concluída.");
  } catch (error) {
    json(res, 503, { error: "Atualização não concluída." });
    finish(1, "Falha ao gravar ou publicar: " + error.message);
  }
});

server.on("error", error => {
  console.log(error.code === "EADDRINUSE"
    ? "A porta 8768 já está em uso. Feche outro coletor da Vortex aberto e tente de novo."
    : "Não foi possível iniciar o coletor: " + error.message);
  process.exit(1);
});
server.requestTimeout = 20_000;
server.listen(8768, "127.0.0.1", () => {
  console.log("Coletor da Vortex pronto. Deixe o Chrome aberto e logado no PilOps.");
  console.log("A extensão começa a leitura em até 1 minuto (limite de " + waitMinutes + " minutos).");
});
setTimeout(() => finish(1, "A extensão do Chrome não respondeu em " + waitMinutes +
  " minutos. Confira se o Chrome está aberto e a extensão \"Coletor local da Vortex\" está ativa."), waitMinutes * 60_000).unref();
