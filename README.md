# Planejador de rotas da Vortex Airways

Site estático (GitHub Pages) com o mapa, a frota e as rotas da Vortex no PilOps: distância e alcance de cada rota, tempo estimado, montagem de planos de trechos, sugestões de rotas (circuitos fechados com rotas cadastradas, classificados em nacionais, continentais e intercontinentais; rotas sem voo que só esperam piloto; aeroportos mais e menos voados), avisos de aeronaves fora da rede (com o piloto que as levou até lá e sugestões de traslado), cobertura das rotas pela frota (o que comprar ou reposicionar) e ranking de pilotos.

## Estrutura

- `docs/`: o site publicado pelo GitHub Pages.
  - `dados.json`: frota, rotas, hubs, pilotos e histórico de voos acumulado (gerado pelo coletor; não editar à mão).
  - `aeronaves.js`: catálogo do Mercado de Aeronaves do PilOps (135 modelos, com preço) e alcance/cruzeiro aproximados de cada um. Ajuste aqui se um modelo tiver valores diferentes ou se o PilOps lançar aeronaves novas.
  - `aeroportos.js`: coordenadas do OurAirports (gerado por `tools/gerar-aeroportos.mjs`). Ao regenerar, aumente o `?v=` dele em `index.html`.
- `coletor/`: lê a Vortex no PilOps pelo Chrome e publica o `dados.json`.
  - `extensao-chrome/`: extensão carregada sem compactação no Chrome.
  - `coletor-local.mjs`: serviço que recebe a leitura, grava e faz commit + push.
  - `dados.mjs`: validação da leitura e fusão do histórico de voos (sem repetir voos).
- `Sincronizar Vortex.cmd`: roda uma coleta e publica.

## Atualizar os dados

1. Deixe o Chrome aberto e logado no PilOps, com a extensão "Coletor local da Vortex" ativa.
2. Rode `Sincronizar Vortex.cmd` (ou o atalho "Sincronizar Vortex" fixado no menu Iniciar). O projeto fica em `Documentos\vortex-planejador`; se mudar a pasta de lugar, atualize o atalho e recarregue a extensão no Chrome.
3. Em até 1 minuto a extensão lê a Vortex numa aba em segundo plano; o coletor grava, faz o commit e envia ao GitHub.
4. O site mostra os dados novos em 1 a 2 minutos.

Uma leitura incompleta é recusada e os dados publicados continuam os mesmos. Pilotos e voos são opcionais: se essas abas não carregarem, a frota e as rotas são publicadas e o histórico guardado é mantido.

O PilOps mostra só os 10 voos mais recentes da companhia. O coletor guarda todos os que já leu, então sincronize com frequência (por exemplo, uma vez por dia) para o ranking não perder voos.

## Publicar mudanças no site

Edite os arquivos em `docs/`, faça o commit e `git push`. O GitHub Pages publica sozinho.

## Operação da semana e compartilhamento

A operação fica no início do planejador. O botão **Editar operação** abre `docs/operacao.json` no GitHub. Uma conta com acesso de edição ao repositório pode alterar o título em português e inglês, as datas de início e fim (inclusive, no calendário de Brasília), a meta de voos e até três pares de origem/destino já cadastrados. Ao salvar no GitHub, o Pages publica a seleção para todos. A sincronização de dados preserva esse arquivo.

A classificação considera os voos remunerados concluídos e lidos nas rotas em destaque dentro do período. Mais voos vêm primeiro. A variedade de rotas desempata e empates completos dividem a posição. A tela identifica a classificação como parcial porque depende do histórico que o coletor conseguiu ler. Uma operação encerrada mantém seus resultados até a administração publicar a próxima.

Em uma rota ou plano, **Compartilhar voo/plano** abre uma mensagem editável em português e inglês. O piloto pode informar o nome, a aeronave e a situação do voo, copiar o texto e abrir o Discord da Vortex para publicar. O compartilhamento anuncia voos individuais. A duração usa a estimativa de bloco já existente no planejador.

Validação da operação e da mensagem: `node --test tools/operacao.test.mjs`.

## Observação

Os dados ficam públicos para quem tiver o link (não há login). Alcance e tempo de bloco são aproximações para triagem; combustível, carga e vento são decididos no PilOps/MSFS.
