"use strict";

// Ponte da extensão na aba do PilOps (mundo isolado). Recebe de pagina.js o token que a própria página usa,
// guarda só na memória desta aba e faz as chamadas do enchimento (enchimento.js) quando o serviço pede.
// As chamadas saem desta aba, com a origem pilops.com, como as da página.
let pilopsToken = null;

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.vortexCarga === "token" && typeof data.token === "string" && /^[\w.~+/=-]{20,8000}$/.test(data.token)) {
    pilopsToken = data.token;
  }
});
window.postMessage({ vortexCarga: "pedir" }, location.origin);

async function pilopsApi(path, body) {
  if (!pilopsToken) throw new VortexFill.FillError("auth");
  const response = await fetch("https://apiv2.pilops.com" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + pilopsToken },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await response.json(); } catch { /* resposta sem JSON */ }
  if (response.status === 401) throw new VortexFill.FillError("auth");
  if (!response.ok) {
    throw new VortexFill.FillError("api", { status: response.status, message: typeof data?.message === "string" ? data.message.slice(0, 120) : null });
  }
  return data;
}

const progress = info => { try { chrome.runtime.sendMessage({ type: "progresso", info }); } catch { /* serviço dormindo */ } };

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "status") {
    reply({ token: Boolean(pilopsToken) });
    return false;
  }
  if (message?.type === "encher") {
    // "wrote" avisa o serviço para recarregar as abas do voo sempre que houve tentativa de gravar, mesmo com erro.
    let wrote = false;
    const api = (path, body) => { if (body) wrote = true; return pilopsApi(path, body); };
    VortexFill.run({ api, progress }, message.request)
      .then(result => reply({ ...result, wrote }), error => reply({ ...VortexFill.failure(error), wrote }));
    return true;
  }
  return false;
});
