"use strict";

// Roda dentro da página do PilOps (mundo MAIN), antes dos scripts dela. A página guarda o login só na memória
// e manda o token em cada chamada a apiv2.pilops.com; este script só observa o cabeçalho Authorization dessas
// chamadas e o entrega à ponte da extensão (ponte.js) na mesma aba. Não muda nenhuma chamada da página.
(() => {
  const api = "https://apiv2.pilops.com/";
  let last = null;
  const deliver = () => { if (last) window.postMessage({ vortexCarga: "token", token: last }, location.origin); };
  const remember = value => {
    const match = /^Bearer\s+([\w.~+/=-]{20,8000})$/i.exec(String(value ?? "").trim());
    if (!match || match[1] === last) return;
    last = match[1];
    deliver();
  };
  const authorization = headers => {
    if (!headers) return null;
    if (headers instanceof Headers) return headers.get("authorization");
    if (Array.isArray(headers)) return headers.find(pair => String(pair?.[0]).toLowerCase() === "authorization")?.[1] ?? null;
    if (typeof headers === "object") {
      const key = Object.keys(headers).find(name => name.toLowerCase() === "authorization");
      return key ? headers[key] : null;
    }
    return null;
  };

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      if (typeof url === "string" && url.startsWith(api)) {
        remember(authorization(init?.headers) ?? (input instanceof Request ? input.headers.get("authorization") : null));
      }
    } catch { /* nunca atrapalha a página */ }
    return originalFetch.apply(this, arguments);
  };

  const open = XMLHttpRequest.prototype.open, setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__vortexCargaApi = String(url).startsWith(api); } catch { /* idem */ }
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { if (this.__vortexCargaApi && String(name).toLowerCase() === "authorization") remember(value); } catch { /* idem */ }
    return setHeader.apply(this, arguments);
  };

  // A ponte pede o token quando chega depois da primeira chamada da página.
  window.addEventListener("message", event => {
    if (event.source === window && event.data?.vortexCarga === "pedir") deliver();
  });
})();
