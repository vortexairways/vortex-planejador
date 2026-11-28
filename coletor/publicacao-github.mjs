// Publicação no GitHub num commit só (revisão do Codex, 28/11/2026, item 5). Antes, cada arquivo da sincronização
// (dados.json, reservado.json, vagas.json) era um commit separado: uma falha no meio deixava o site com partes de
// coletas diferentes, e dois autores podiam intercalar arquivos. Agora:
//  - todos os arquivos são montados a partir da MESMA versão do site (o commit da ponta da main);
//  - saem juntos, num commit só, e a main avança SEM forçar;
//  - se outro autor publicou no meio (o Rafael pelo coletor, outro admin, o dono), a montagem é refeita sobre a
//    versão nova, até 3 vezes. Ou entram todos os arquivos, ou nenhum.
// Usado pelas extensões Vortex · Dono (coletor/extensao-astro, cópia publicacao-github.js gerada por
// tools/empacotar-extensao-vagas.ps1) e Vortex · Admin (cópia gerada pelo montador dela). O coletor do Rafael já
// publica num commit só, pelo git.

export class PublishError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

// Hora de captura de cada parte: uma parte publicada por outro autor DEPOIS que esta leitura começou é mais nova e
// não recebe uma leitura mais velha por cima. Uma hora mais de 5 minutos no futuro (relógio errado no computador de
// quem publicou) não trava as sincronizações dos outros.
export function newerThan(published, startedAt, now = Date.now()) {
  const at = Date.parse(published?.capturedAt);
  return Number.isFinite(at) && at > startedAt && at <= now + 5 * 60 * 1000;
}

const fromBase64 = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), c => c.charCodeAt(0)));
const asText = data => JSON.stringify(data, null, 1) + "\n";

// build(read): read(path) lê um arquivo JSON do site NA MESMA VERSÃO (null se ele não existir). build devolve
// { "docs/arquivo.json": conteúdo, ... } e pode lançar um erro para não publicar nada. Devolve
// { files, commit, attempts }; commit é null quando nada mudou (nenhum commit vazio é criado).
export async function publishTogether({ repo, token, message, build, branch = "main", fetch: request = globalThis.fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  refused = "O GitHub recusou o acesso (código vencido ou apagado).",
  readOnly = "O acesso ao GitHub deste código não pode gravar no planejador." }) {
  const api = async (path, options = {}) => {
    const response = await request("https://api.github.com/repos/" + repo + "/" + path, { ...options, cache: "no-store", headers: {
      Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    if (response.status === 401) throw new PublishError("token", 401, refused);
    return response;
  };
  const fail = (response, what) => {
    if (response.status === 403 || response.status === 404) throw new PublishError("token", response.status, readOnly);
    throw new PublishError("github", response.status, "O GitHub respondeu " + response.status + " ao " + what + ". Nada foi publicado.");
  };
  const tipNow = async () => {
    const response = await api("git/ref/heads/" + branch);
    if (!response.ok) fail(response, "consultar a versão do site");
    return (await response.json()).object.sha;
  };
  const post = async (path, body, what) => {
    const response = await api(path, { method: "POST", body: JSON.stringify(body) });
    if (!response.ok) fail(response, what);
    return response.json();
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const tip = await tipNow();
    const head = await api("git/commits/" + tip);
    if (!head.ok) fail(head, "consultar a versão do site");
    const baseTree = (await head.json()).tree.sha;
    const read = async path => {
      const response = await api("contents/" + path + "?ref=" + tip);
      if (response.status === 404) return null;
      if (!response.ok) fail(response, "consultar " + path);
      const body = await response.json();
      let content = body.content;
      // Acima de 1 MB a API de conteúdo não traz o arquivo: lê o blob.
      if (!content && body.sha) {
        const blob = await api("git/blobs/" + body.sha);
        if (!blob.ok) fail(blob, "consultar " + path);
        content = (await blob.json()).content;
      }
      return JSON.parse(fromBase64(content));
    };
    const files = await build(read);
    const paths = Object.keys(files);
    if (!paths.length) return { files, commit: null, attempts: attempt };
    const tree = await post("git/trees", { base_tree: baseTree,
      tree: paths.map(path => ({ path, mode: "100644", type: "blob", content: asText(files[path]) })) }, "montar a publicação");
    if (tree.sha === baseTree) return { files, commit: null, attempts: attempt };
    const commit = await post("git/commits", { message, tree: tree.sha, parents: [tip] }, "criar o commit");
    const moved = await api("git/refs/heads/" + branch, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    if (moved.ok) return { files, commit: commit.sha, attempts: attempt };
    // 422/409 com a main no mesmo lugar não é outro autor: é erro de verdade, e repetir não adianta.
    if ((moved.status !== 409 && moved.status !== 422) || (await tipNow()) === tip) fail(moved, "publicar");
    if (attempt < 3) await pause(1500);
  }
  throw new PublishError("github", 422, "Outra publicação entrou no GitHub durante o envio três vezes seguidas. Nada foi publicado; tente de novo.");
}
