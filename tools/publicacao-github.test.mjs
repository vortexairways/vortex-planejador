// Publicação num commit só (coletor/publicacao-github.mjs) contra um GitHub de mentira: todos os arquivos saem
// juntos, lidos da mesma versão; se outro autor publicar no meio, a montagem é refeita sobre a versão nova; um erro
// na montagem não grava nada (revisão do Codex, 28/11/2026, item 5).
// Rodar: node --test "tools/*.test.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { PublishError, newerThan, publishTogether } from "../coletor/publicacao-github.mjs";

const repo = "vortexairways/vortex-planejador";
const asText = data => JSON.stringify(data, null, 1) + "\n";

function fakeGithub(initial) {
  let next = 0;
  const trees = new Map(), commits = new Map(), calls = [];
  const sorted = files => JSON.stringify(Object.keys(files).sort().map(key => [key, files[key]]));
  const addTree = files => {
    const found = [...trees].find(([, other]) => sorted(other) === sorted(files));
    if (found) return found[0];
    const sha = "tree" + ++next;
    trees.set(sha, files);
    return sha;
  };
  const addCommit = (tree, parents) => {
    const sha = "commit" + ++next;
    commits.set(sha, { tree, parents });
    return sha;
  };
  const state = { main: addCommit(addTree({ ...initial }), []), calls, beforePatch: null, patchStatus: null, forced: null };
  const answer = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
  state.files = (sha = state.main) => trees.get(commits.get(sha).tree);
  state.parent = (sha = state.main) => commits.get(sha).parents[0];
  // Outro autor (o Rafael, outro admin) publica direto na main.
  state.other = changes => { state.main = addCommit(addTree({ ...state.files(), ...changes }), [state.main]); return state.main; };
  state.fetch = async (url, options = {}) => {
    assert.ok(url.startsWith("https://api.github.com/repos/" + repo + "/"), url);
    assert.equal(options.headers.Authorization, "Bearer token-de-teste");
    const path = url.slice(("https://api.github.com/repos/" + repo + "/").length), method = options.method || "GET";
    calls.push(method + " " + path);
    if (state.forced?.(method, path)) return answer(state.forced(method, path));
    let match;
    if (method === "GET" && path === "git/ref/heads/main") return answer(200, { object: { sha: state.main } });
    if (method === "GET" && (match = path.match(/^git\/commits\/(.+)$/))) {
      return commits.has(match[1]) ? answer(200, { tree: { sha: commits.get(match[1]).tree } }) : answer(404);
    }
    if (method === "GET" && (match = path.match(/^contents\/(.+)\?ref=(.+)$/))) {
      const files = state.files(match[2]);
      return match[1] in files ? answer(200, { type: "file", sha: "blob", content: Buffer.from(files[match[1]]).toString("base64") }) : answer(404);
    }
    const body = options.body ? JSON.parse(options.body) : null;
    if (method === "POST" && path === "git/trees") {
      const files = { ...trees.get(body.base_tree) };
      for (const entry of body.tree) {
        assert.deepEqual([entry.mode, entry.type], ["100644", "blob"]);
        files[entry.path] = entry.content;
      }
      return answer(201, { sha: addTree(files) });
    }
    if (method === "POST" && path === "git/commits") return answer(201, { sha: addCommit(body.tree, body.parents), message: body.message });
    if (method === "PATCH" && path === "git/refs/heads/main") {
      assert.equal(body.force, false, "a main nunca é forçada");
      state.beforePatch?.();
      if (state.patchStatus) return answer(state.patchStatus);
      if (commits.get(body.sha).parents[0] !== state.main) return answer(422, { message: "Update is not a fast forward" });
      state.main = body.sha;
      return answer(200, { object: { sha: body.sha } });
    }
    return answer(404);
  };
  return state;
}

const initial = {
  "docs/index.html": "<html></html>",
  "docs/dados.json": asText({ capturedAt: "2026-11-28T10:00:00.000Z", flights: ["a"] }),
  "docs/vagas.json": asText({ capturedAt: "2026-11-28T10:00:00.000Z", total: 1 }),
};
const publish = (github, build) => publishTogether({ repo, token: "token-de-teste", message: "Vortex ao vivo · teste",
  build, fetch: github.fetch, pause: async () => {} });

test("os arquivos saem num commit só, lidos da mesma versão do site, sem forçar a main", async () => {
  const github = fakeGithub(initial);
  const start = github.main;
  const result = await publish(github, async read => {
    const dados = await read("docs/dados.json");
    assert.deepEqual(dados.flights, ["a"]);
    assert.equal(await read("docs/reservado.json"), null, "arquivo que não existe vem como null");
    return { "docs/dados.json": { ...dados, flights: ["a", "b"] }, "docs/reservado.json": { v: 1 }, "docs/vagas.json": { total: 2 } };
  });
  assert.equal(result.attempts, 1);
  assert.equal(github.main, result.commit);
  assert.equal(github.parent(), start, "um commit só, em cima da versão lida");
  const files = github.files();
  assert.equal(files["docs/dados.json"], asText({ capturedAt: "2026-11-28T10:00:00.000Z", flights: ["a", "b"] }));
  assert.equal(files["docs/reservado.json"], asText({ v: 1 }));
  assert.equal(files["docs/vagas.json"], asText({ total: 2 }));
  assert.equal(files["docs/index.html"], "<html></html>", "o resto do site fica como estava");
  assert.deepEqual(github.calls.filter(call => /^(POST|PATCH)/.test(call)), ["POST git/trees", "POST git/commits", "PATCH git/refs/heads/main"]);
  assert.ok(github.calls.filter(call => call.startsWith("GET contents/")).every(call => call.endsWith("?ref=" + start)));
});

test("outro autor publica no meio: a montagem é refeita sobre a versão nova e nada dele se perde", async () => {
  const github = fakeGithub(initial);
  let builds = 0, theirs;
  github.beforePatch = () => {
    github.beforePatch = null;
    theirs = github.other({ "docs/dados.json": asText({ capturedAt: "2026-11-28T10:05:00.000Z", flights: ["a", "dele"] }),
      "docs/operacao.json": "dele\n" });
  };
  const result = await publish(github, async read => {
    builds++;
    const dados = await read("docs/dados.json");
    return { "docs/dados.json": { ...dados, flights: [...dados.flights, "meu"] }, "docs/vagas.json": { total: 3 } };
  });
  assert.equal(builds, 2);
  assert.equal(result.attempts, 2);
  assert.equal(github.parent(), theirs, "o commit novo vem depois do dele");
  const files = github.files();
  assert.deepEqual(JSON.parse(files["docs/dados.json"]).flights, ["a", "dele", "meu"]);
  assert.equal(files["docs/operacao.json"], "dele\n");
  assert.equal(files["docs/vagas.json"], asText({ total: 3 }));
});

test("erro na montagem (leitura inválida, cifra que não confere): nada é gravado", async () => {
  const github = fakeGithub(initial);
  const start = github.main;
  await assert.rejects(publish(github, async read => {
    await read("docs/dados.json");
    throw new Error("A leitura da Vortex veio incompleta. Nada foi publicado.");
  }), /incompleta/);
  assert.equal(github.main, start);
  assert.equal(github.calls.filter(call => /^(POST|PATCH)/.test(call)).length, 0);
});

test("conteúdo igual ao do site: nenhum commit vazio", async () => {
  const github = fakeGithub(initial);
  const start = github.main;
  const result = await publish(github, async read => ({ "docs/vagas.json": await read("docs/vagas.json") }));
  assert.equal(result.commit, null);
  assert.equal(github.main, start);
  assert.ok(!github.calls.includes("POST git/commits"));
});

test("código recusado (401) e código sem permissão de gravar (403) param na hora, com o motivo", async () => {
  const refusedHub = fakeGithub(initial);
  refusedHub.forced = () => 401;
  await assert.rejects(publish(refusedHub, async () => ({ "docs/vagas.json": {} })),
    error => error instanceof PublishError && error.code === "token" && error.status === 401 && /recusou o acesso/.test(error.message));
  const readOnlyHub = fakeGithub(initial);
  readOnlyHub.forced = (method, path) => method === "POST" && path === "git/trees" ? 403 : null;
  await assert.rejects(publish(readOnlyHub, async () => ({ "docs/vagas.json": {} })),
    error => error.code === "token" && error.status === 403 && /não pode gravar/.test(error.message));
  assert.equal(readOnlyHub.calls.filter(call => call.startsWith("PATCH")).length, 0);
});

test("recusa sem outro autor (main parada) não fica repetindo; três publicações alheias seguidas desistem", async () => {
  const stuck = fakeGithub(initial);
  stuck.patchStatus = 422;
  await assert.rejects(publish(stuck, async () => ({ "docs/vagas.json": { total: 9 } })),
    error => error.code === "github" && error.status === 422 && /publicar/.test(error.message));
  assert.equal(stuck.calls.filter(call => call.startsWith("PATCH")).length, 1);

  const busy = fakeGithub(initial);
  let others = 0;
  busy.beforePatch = () => { others++; busy.other({ "docs/operacao.json": others + "\n" }); };
  await assert.rejects(publish(busy, async () => ({ "docs/vagas.json": { total: 9 } })), /três vezes seguidas/);
  assert.equal(others, 3);
  assert.equal(busy.files()["docs/vagas.json"], initial["docs/vagas.json"], "nada desta sincronização entrou");
});

test("hora de captura: parte publicada depois do início desta leitura é mais nova; relógio adiantado não trava", () => {
  const start = Date.parse("2026-11-28T12:00:00.000Z"), now = start + 60000;
  assert.equal(newerThan({ capturedAt: "2026-11-28T12:00:30.000Z" }, start, now), true);
  assert.equal(newerThan({ capturedAt: "2026-11-28T11:59:00.000Z" }, start, now), false);
  assert.equal(newerThan({ capturedAt: "2026-11-28T15:00:00.000Z" }, start, now), false, "3 horas no futuro: relógio errado");
  assert.equal(newerThan(null, start, now), false);
  assert.equal(newerThan({ capturedAt: "ontem" }, start, now), false);
});
