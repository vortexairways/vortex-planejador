import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const input = { reportedFleet: 1,
  fleet: [{ prefix: "NABCDE", model: "Test Plane", airport: "LEMD", base: "LEMD", status: "Disponivel" }],
  hubs: ["LEMD"], routes: [{ origin: "LEMD", destination: "KRDU", code: "VTX0001" }], pilots: [], flights: [], activeFlights: [],
};
const manifest = JSON.parse(readFileSync(path.join(project, "coletor/extensao-chrome/manifest.json")));
const hash = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
const origin = "chrome-extension://" + [...hash].map(n => String.fromCharCode(97 + parseInt(n, 16))).join("");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "vortex-sync-test-"));
  const repo = path.join(root, "work"), remote = path.join(root, "remote.git");
  mkdirSync(path.join(repo, "coletor/extensao-chrome"), { recursive: true });
  mkdirSync(path.join(repo, "docs"));
  for (const file of [".gitignore", "coletor/coletor-local.mjs", "coletor/dados.mjs", "coletor/publicacao.mjs", "coletor/extensao-chrome/manifest.json"]) copyFileSync(path.join(project, file), path.join(repo, file));
  const original = JSON.stringify({ ...input, capturedAt: "2026-11-09T12:00:00Z" });
  writeFileSync(path.join(repo, "docs/dados.json"), original);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Vortex Test"); git(repo, "config", "user.email", "test@example.invalid");
  git(repo, "add", "."); git(repo, "commit", "-m", "Fixture");
  git(repo, "init", "--bare", remote); git(repo, "remote", "add", "origin", remote); git(repo, "push", "-u", "origin", "main");
  const portServer = net.createServer();
  await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const children = [];
  const launch = () => {
    const child = spawn(process.execPath, ["coletor/coletor-local.mjs", "--automatic"], {
      cwd: repo, env: { ...process.env, VORTEX_COLLECTOR_PORT: String(port) }, windowsHide: true,
    });
    child.output = "";
    child.stdout.on("data", data => { child.output += data; }); child.stderr.on("data", data => { child.output += data; });
    child.done = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    children.push(child); return child;
  };
  const ready = async child => {
    for (let i = 0; i < 100; i++) { if (child.output.includes("Coletor da Vortex pronto")) return; if (child.exitCode !== null) break; await delay(50); }
    throw new Error("Coletor nao iniciou: " + child.output);
  };
  const post = async (endpoint, body, sender = origin) => fetch("http://127.0.0.1:" + port + "/" + endpoint, {
    method: "POST", headers: { Origin: sender, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const cleanup = async () => {
    for (const child of children) { if (child.exitCode === null) child.kill(); await child.done.catch(() => {}); }
    const resolved = realpathSync(root), parent = realpathSync(tmpdir());
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith("vortex-sync-test-"));
    rmSync(resolved, { recursive: true, force: true });
  };
  return { root, repo, remote, original, launch, ready, post, cleanup };
}

// Pasta privada de teste ao lado do repositório (o coletor procura ../../vortex-privado/coletor.js).
function privateHook(root, body) {
  mkdirSync(path.join(root, "vortex-privado"));
  writeFileSync(path.join(root, "vortex-privado/coletor.js"), body);
}

test("origem restrita, pedido exclusivo e porta unica protegem coleta manual e automatica", async () => {
  const f = await fixture();
  try {
    const first = f.launch(); await f.ready(first);
    const second = f.launch(); assert.equal(await second.done, 75);
    assert.equal((await f.post("job", {}, "https://example.com")).status, 403);
    assert.equal((await f.post("snapshot", { lease: "inventado" })).status, 409);
    const job = await (await f.post("job", {})).json(); assert.ok(job.lease);
    assert.deepEqual(await (await f.post("job", {})).json(), {});
    assert.equal((await f.post("snapshot", { lease: job.lease })).status, 422);
    assert.equal(await first.done, 1);
    assert.equal(readFileSync(path.join(f.repo, "docs/dados.json"), "utf8"), f.original);
  } finally { await f.cleanup(); }
});

test("modo automatico publica somente a coleta validada em um remoto de teste local", async () => {
  const f = await fixture();
  try {
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    const response = await f.post("snapshot", { ...input, lease, activeFlights: [{ pilot: "Privado" }],
      flights: [{ pilot: "Piloto", prefix: "NABCDE", model: "Test Plane", origin: "LEMD", destination: "KRDU",
        date: "2026-11-10", minutes: 60, nm: 3000, fuel: 100, revenue: 53123.47 }] });
    assert.equal(response.status, 200); assert.equal(await child.done, 0);
    const data = JSON.parse(readFileSync(path.join(f.repo, "docs/dados.json")));
    assert.ok(data.revenueMonitor); assert.equal(data.flights.length, 1); assert.equal("activeFlights" in data, false);
    assert.equal(data.flights[0].paid, true); assert.equal("revenue" in data.flights[0], false);
    assert.equal("payload" in data.flights[0], false); assert.equal("fuel" in data.flights[0], false);
    const privateData = JSON.parse(readFileSync(path.join(f.repo, ".vortex-local/dados.json")));
    assert.equal(privateData.flights[0].revenue, 53123.47);
    assert.equal(git(f.repo, "ls-files", ".vortex-local"), "");
    const local = git(f.repo, "rev-parse", "HEAD");
    const remote = execFileSync("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(local, remote); assert.equal(git(f.repo, "status", "--porcelain"), "");
  } finally { await f.cleanup(); }
});

test("arquivos editados pelo usuario permanecem intactos e nao entram no commit automatico", async () => {
  const f = await fixture();
  try {
    writeFileSync(path.join(f.repo, "nota-do-usuario.txt"), "Preservar esta alteracao");
    git(f.repo, "add", "nota-do-usuario.txt");
    const before = git(f.repo, "rev-parse", "HEAD");
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    assert.equal((await f.post("snapshot", { ...input, lease })).status, 503);
    assert.equal(await child.done, 1); assert.equal(git(f.repo, "rev-parse", "HEAD"), before);
    assert.equal(readFileSync(path.join(f.repo, "docs/dados.json"), "utf8"), f.original);
    assert.equal(readFileSync(path.join(f.repo, "nota-do-usuario.txt"), "utf8"), "Preservar esta alteracao");
  } finally { await f.cleanup(); }
});

test("coleta junta o commit de vagas publicado pelo dono antes de enviar", async () => {
  const f = await fixture();
  try {
    // Outro clone simula a extensão do dono gravando docs/vagas.json direto no GitHub.
    const other = path.join(path.dirname(f.repo), "dono");
    execFileSync("git", ["clone", "-q", "-b", "main", f.remote, other], { windowsHide: true, timeout: 10000 });
    git(other, "config", "user.name", "Dono"); git(other, "config", "user.email", "dono@example.invalid");
    writeFileSync(path.join(other, "docs/vagas.json"), JSON.stringify({ version: 1, stands: [] }));
    git(other, "add", "docs/vagas.json"); git(other, "commit", "-m", "Vagas"); git(other, "push", "-q", "origin", "main");
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    assert.equal((await f.post("snapshot", { ...input, lease })).status, 200);
    assert.equal(await child.done, 0);
    const remote = execFileSync("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(git(f.repo, "rev-parse", "HEAD"), remote);
    assert.match(git(f.repo, "log", "--format=%s", "-3"), /Vagas/);
    assert.equal(JSON.parse(readFileSync(path.join(f.repo, "docs/vagas.json"))).version, 1);
    assert.equal(git(f.repo, "status", "--porcelain"), "");
  } finally { await f.cleanup(); }
});

test("voo publicado pelo dono entra no histórico privado sem receita e continua publicado", async () => {
  const f = await fixture();
  try {
    const other = path.join(path.dirname(f.repo), "dono");
    execFileSync("git", ["clone", "-q", "-b", "main", f.remote, other], { windowsHide: true, timeout: 10000 });
    git(other, "config", "user.name", "Dono"); git(other, "config", "user.email", "dono@example.invalid");
    const published = JSON.parse(readFileSync(path.join(other, "docs/dados.json"), "utf8"));
    published.flights = [{ pilot: "astronauta", prefix: "NABCDE", model: "Test Plane", origin: "LEMD", destination: "KRDU",
      date: "2026-11-26", minutes: 480, nm: 3400, paid: true }];
    writeFileSync(path.join(other, "docs/dados.json"), JSON.stringify(published));
    git(other, "add", "docs/dados.json"); git(other, "commit", "-m", "Vortex ao vivo"); git(other, "push", "-q", "origin", "main");
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    // O Rafael relê só um voo novo; o do dono já saiu da lista dos 10 últimos.
    const response = await f.post("snapshot", { ...input, lease, flights: [{ pilot: "Piloto", prefix: "NABCDE", model: "Test Plane",
      origin: "KRDU", destination: "LEMD", date: "2026-11-27", minutes: 470, nm: 3400, fuel: 100000, revenue: 900000 }] });
    assert.equal(response.status, 200); assert.equal(await child.done, 0);
    const privateData = JSON.parse(readFileSync(path.join(f.repo, ".vortex-local/dados.json")));
    const fromOwner = privateData.flights.find(flight => flight.pilot === "astronauta");
    assert.equal(fromOwner.paid, true); assert.equal("revenue" in fromOwner, false);
    assert.equal(privateData.flights.length, 2);
    const data = JSON.parse(readFileSync(path.join(f.repo, "docs/dados.json")));
    assert.deepEqual(data.flights.map(flight => [flight.pilot, flight.paid]), [["Piloto", true], ["astronauta", true]]);
    const remote = execFileSync("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(git(f.repo, "rev-parse", "HEAD"), remote);
  } finally { await f.cleanup(); }
});

test("pasta privada junta o histórico e publica o arquivo cifrado no mesmo commit da coleta", async () => {
  const f = await fixture();
  try {
    privateHook(f.root, `export async function historico(previous) {
  return { ...previous, flights: [...(previous.flights || []), { pilot: "Admin", prefix: "NABCDE", model: "Test Plane",
    origin: "LEMD", destination: "KRDU", date: "2026-11-20", minutes: 480, nm: 3400, fuel: 90000, revenue: 800000 }] };
}
export async function arquivos(snapshot) {
  return [{ path: "docs/reservado.json", content: JSON.stringify({ versao: 1, voos: snapshot.flights.length }) + "\\n" }];
}
`);
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    const response = await f.post("snapshot", { ...input, lease, flights: [{ pilot: "Piloto", prefix: "NABCDE", model: "Test Plane",
      origin: "KRDU", destination: "LEMD", date: "2026-11-27", minutes: 470, nm: 3400, fuel: 100000, revenue: 900000 }] });
    assert.equal(response.status, 200, child.output); assert.equal(await child.done, 0, child.output);
    assert.deepEqual(JSON.parse(readFileSync(path.join(f.repo, "docs/reservado.json"))), { versao: 1, voos: 2 });
    assert.deepEqual(git(f.repo, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), ["docs/dados.json", "docs/reservado.json"]);
    const data = JSON.parse(readFileSync(path.join(f.repo, "docs/dados.json")));
    assert.deepEqual(data.flights.map(flight => flight.pilot), ["Piloto", "Admin"]);
    assert.ok(!JSON.stringify(data).includes("800000") && !("revenueEstimates" in data));
    const remote = execFileSync("git", ["--git-dir", f.remote, "rev-parse", "refs/heads/main"], { encoding: "utf8", windowsHide: true }).trim();
    assert.equal(git(f.repo, "rev-parse", "HEAD"), remote);
  } finally { await f.cleanup(); }
});

test("pasta privada não consegue publicar arquivo fora do combinado", async () => {
  const f = await fixture();
  try {
    privateHook(f.root, `export async function historico(previous) { return previous; }
export async function arquivos() { return [{ path: "docs/segredo.json", content: "{}" }]; }
`);
    const child = f.launch(); await f.ready(child);
    const { lease } = await (await f.post("job", {})).json();
    const response = await f.post("snapshot", { ...input, lease });
    assert.equal(response.status, 503); assert.equal(await child.done, 1);
    assert.match(child.output, /arquivo inesperado/);
    assert.equal(git(f.repo, "log", "-1", "--format=%s"), "Fixture");
  } finally { await f.cleanup(); }
});
