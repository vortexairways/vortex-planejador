# Planejador de rotas da Vortex Airways

Site estático (GitHub Pages) com o mapa, a frota e as rotas da Vortex no PilOps: distância e alcance de cada rota, tempo estimado, montagem de planos de trechos, sugestões de rotas (circuitos fechados com rotas cadastradas, classificados em nacionais, continentais e intercontinentais; rotas sem voo que só esperam piloto; aeroportos mais e menos voados), avisos de aeronaves fora da rede (com o piloto que as levou até lá e sugestões de traslado), cobertura das rotas pela frota (o que comprar ou reposicionar) e ranking de pilotos.

Em **Movimentações da frota**, voos não cadastrados que chegam fora da malha recebem advertência; retornos de fora para um aeroporto com rota de partida recebem selo verde **✓ Retorno à malha**, também junto ao piloto. Traslados entre aeroportos da malha são neutros. Retornos e reposicionamentos não entram no contador de advertências. Rotas cadastradas não atribuem advertência ao piloto. A classificação usa a malha atual, sem inferir intenção ou autorização. Validação: `node --test tools/movimentacoes.test.mjs`.

## Estrutura

- `docs/`: o site publicado pelo GitHub Pages.
  - `dados.json`: frota, rotas, hubs, pilotos, histórico operacional e variações percentuais, sem valores financeiros absolutos (gerado pelo coletor; não editar à mão).
  - `aeronaves.js`: catálogo do Mercado de Aeronaves do PilOps (135 modelos, sem preços publicados) e alcance/cruzeiro aproximados de cada um. Ajuste aqui se um modelo tiver valores diferentes ou se o PilOps lançar aeronaves novas.
  - `aeroportos.js`: coordenadas do OurAirports (gerado por `tools/gerar-aeroportos.mjs`). Ao regenerar, aumente o `?v=` dele em `index.html`.
- `coletor/`: lê a Vortex no PilOps pelo Chrome e publica o `dados.json`.
  - `extensao-chrome/`: extensão carregada sem compactação no Chrome.
  - `coletor-local.mjs`: serviço que recebe a leitura, grava e faz commit + push.
  - `dados.mjs`: validação da leitura e fusão do histórico de voos (sem repetir voos).
- `.vortex-local/dados.json`: histórico financeiro privado para calcular os percentuais. Fica fora de `docs/` e é ignorado pelo Git. Preserve esse arquivo ao mover o projeto.
- `Sincronizar Vortex.cmd`: roda uma coleta manual e publica somente o resultado reduzido.

## Atualizar os dados

1. Deixe o Chrome aberto e logado no PilOps, com a extensão "Coletor local da Vortex" ativa.
2. Rode `Sincronizar Vortex.cmd` (ou o atalho "Sincronizar Vortex" fixado no menu Iniciar). O projeto fica em `Documentos\vortex-planejador`; se mudar a pasta de lugar, atualize o atalho e recarregue a extensão no Chrome.
3. Em até 1 minuto a extensão lê a Vortex numa aba em segundo plano; o coletor grava, faz o commit e envia ao GitHub.
4. O site mostra os dados novos em 1 a 2 minutos.

Uma leitura incompleta é recusada e os dados publicados continuam os mesmos. Pilotos e voos são opcionais: se essas abas não carregarem, a frota e as rotas são publicadas e o histórico guardado é mantido.

O painel carrega pilotos em lotes de dez. O coletor percorre a lista até atingir o total informado pelo PilOps; uma relação parcial não substitui o cadastro. Durante essa leitura, ativa brevemente a aba da coleta para permitir o carregamento incremental e retorna à aba anterior, sem trazer a janela à frente. A tabela do planejador informa separadamente a data da última leitura dos pilotos, pois ela pode ser anterior à coleta da frota. Após atualizar o código da extensão, recarregue-a em `chrome://extensions`.

O PilOps mostra só os 10 voos mais recentes da companhia. O coletor guarda todos os que já leu, então sincronize com frequência (por exemplo, uma vez por dia) para o ranking não perder voos.

## Sincronização manual e privacidade

A sincronização automática permanece desativada, conforme decisão da administração. Use **Sincronizar Vortex** para atualizar os dados. O coletor valida o histórico e guarda a versão completa apenas em `.vortex-local/dados.json`. A publicação é criada por uma lista explícita de campos permitidos em `coletor/publicacao.mjs`: não inclui receitas, cargas, preços, valores por unidade ou voos em andamento. O ranking de pilotos também não publica receita.

O monitor publica somente o percentual do último voo contra a mediana dos anteriores na mesma rota e modelo, normalizado pela carga. Os números usados no cálculo ficam no arquivo privado. Sem esse arquivo, é possível recuperar o histórico operacional público, mas as referências financeiras só voltam a ser conhecidas conforme os voos são relidos. A migração inicial é feita por `node coletor/sanitizar-publicacao.mjs`, preservando os voos já registrados.

A página consulta os dados publicados a cada minuto para refletir uma coleta manual nova; isso não inicia coleta no PilOps. A seção de voos em andamento foi removida. Os scripts opcionais de agendamento continuam no repositório, mas a tarefa está desabilitada.

A retirada dos dados atuais não apaga revisões antigas do GitHub. A limpeza do histórico exige uma operação separada de reescrita das revisões; não é feita pela sincronização.

## Publicar mudanças no site

Edite os arquivos em `docs/`, faça o commit e `git push`. O GitHub Pages publica sozinho.

## Tempos do SimBrief

O cálculo usa o **bloco estimado** (`times.est_block`) de um plano SimBrief datado, apenas para a mesma origem, destino e variante de aeronave. Não confunde o tempo no ar (`est_time_enroute`), o bloco agendado (`sched_block`) ou a duração realizada no PilOps. A referência LEMD → KRDU / B78X, conferida no plano de 10/11/2026, resulta em **8h45 de bloco** e **8h17 no ar**, arredondando para cima ao minuto. Apenas esses campos operacionais mínimos ficam em `docs/tempos-simbrief.json`, sem ID de conta, pesos, combustível, tripulação ou documento completo.

Cada piloto pode informar seu usuário ou Pilot ID em **Tempos do SimBrief → Importar último plano**. A consulta usa [o endpoint oficial de leitura](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data), `json=v2` e identificação do cliente. A [orientação oficial atualizada](https://forum.navigraph.com/t/fetching-a-users-latest-ofp-data/5297) exige ação do usuário: não há consulta periódica, geração de plano nem chave secreta no site. O usuário/ID e os tempos importados ficam somente no navegador do piloto; falhas preservam as referências anteriores. Limpar as importações não remove as referências publicadas pela companhia.

As referências valem por 30 dias. Sem referência válida para o mesmo trecho e variante, usa-se o catálogo com indicação explícita. Modelos genéricos sem variante inequívoca não são associados a um tipo SimBrief por aproximação. Um plano com vários trechos soma cada estimativa separadamente e identifica quando mistura SimBrief e catálogo, inclusive no texto compartilhado. Datas são exibidas pelo calendário de Brasília. Validação: `node --test tools/tempos.test.mjs tools/operacao.test.mjs`.

## Operação da semana e compartilhamento

A operação fica no início do planejador. O botão **Editar operação** abre `docs/operacao.json` no GitHub. Uma conta com acesso de edição ao repositório pode alterar o título em português e inglês, as datas de início e fim (inclusive, no calendário de Brasília), a meta de voos e até cinco pares de origem/destino já cadastrados. Os trechos são numerados na ordem da seleção; uma sequência contínua também mostra o percurso completo em destaque. Ao salvar no GitHub, o Pages publica a seleção para todos. A sincronização de dados preserva esse arquivo.

A classificação considera os voos remunerados concluídos e lidos nas rotas em destaque dentro do período. Mais voos vêm primeiro. A variedade de rotas desempata; persistindo o empate, usa a ordem alfabética dos nomes. As posições são sempre consecutivas (1, 2, 3), sem repetição. A tela identifica a classificação como parcial porque depende do histórico que o coletor conseguiu ler. Uma operação encerrada mantém seus resultados até a administração publicar a próxima.

Em uma rota ou plano, **Compartilhar voo/plano** abre uma mensagem editável em português e inglês. O piloto pode informar o nome, a aeronave e a situação do voo, copiar o texto e abrir o Discord da Vortex para publicar. O compartilhamento anuncia voos individuais. A duração usa a estimativa de bloco já existente no planejador.

Validação da operação e da mensagem: `node --test tools/operacao.test.mjs`.

## Atividade dos pilotos em 30 dias

O contador da tabela de pilotos é independente do desafio semanal. A data inicial fica em `docs/atividade.json`, definida como **01/11/2026**. As janelas têm exatamente 30 dias inclusivos: 01 a 30/11, 01 a 30/12, 31/12 a 29/01 e assim por diante, pelo calendário de Brasília. A janela renova automaticamente, inclusive com a página aberta.

Conta os voos concluídos com duração positiva no histórico da companhia, incluindo traslados; não depende de receita nem da seleção atual de rotas. Somente pilotos no painel atual recebem o aviso: **zero voos registrados fica vermelho**, e pelo menos um retira o alerta. O prazo inclui o dia atual. O histórico continua guardado; só a contagem da janela se renova. A coleta é parcial, portanto ausência de registro pede confirmação do histórico e do ingresso antes de uma decisão de exclusão. Não há exclusão automática.

Validação: `node --test tools/atividade.test.mjs tools/operacao.test.mjs`.

## Observação

Os dados ficam públicos para quem tiver o link (não há login). Alcance e tempo de bloco são aproximações para triagem; combustível, carga e vento são decididos no PilOps/MSFS.
