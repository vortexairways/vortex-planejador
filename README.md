# Planejador de rotas da Vortex Airways

Site estático (GitHub Pages) com o mapa, a frota e as rotas da Vortex no PilOps: distância e alcance de cada rota, tempo estimado, montagem de planos de trechos, sugestões de rotas (circuitos fechados com rotas cadastradas, classificados em nacionais, continentais e intercontinentais; rotas sem voo que só esperam piloto; aeroportos mais e menos voados), avisos de aeronaves fora da rede (com o piloto que as levou até lá e sugestões de traslado), cobertura das rotas pela frota (o que comprar ou reposicionar) e ranking de pilotos.

Em **Movimentações da frota**, o aviso fica ativo enquanto a última posição coletada da aeronave estiver fora da malha. Ele é encerrado quando uma coleta confirma a aeronave em um aeroporto com rota de partida. O piloto aparece no aviso quando o histórico permite identificar o voo que levou a aeronave até a posição atual. Os voos continuam no histórico, e os retornos recebem o selo verde **✓ Retorno à malha**. Traslados entre aeroportos da malha são neutros. A classificação usa a malha atual. Validação: `node --test tools/movimentacoes.test.mjs`.

## Estrutura

Em **Planejar ida e volta**, cada rota permite montar um retorno direto cadastrado, uma conexão na malha ou um traslado direto. A aeronave escolhida determina a triagem por trecho. Em **Simular nova rota**, informe dois códigos ICAO para ver os circuitos que a ligação fecharia, os modelos com alcance e as opções de reposicionamento segundo a última coleta. A simulação é local ao navegador. O aviso de compatibilidade começa por Congonhas e pelos modelos de código D, E e F catalogados no planejador. Sua referência é a [ficha do DECEA](https://aisweb.decea.mil.br/?codigo=SBSP&i=aerodromos). Alcance e porte são triagem para simulação. Validação: `node --test tools/malha.test.mjs`.

- `docs/`: o site publicado pelo GitHub Pages.
  - `dados.json`: frota, rotas, hubs, pilotos, histórico operacional, variações percentuais e o consumo de referência do comparador de cargas (medianas de combustível por rota e modelo, sem voo, piloto ou data individual) (gerado pelo coletor; não editar à mão). Não leva renda em P$.
  - `reservado.json`: histórico financeiro dos admins, cifrado (AES-GCM). Sem a chave, que fica só com os admins, é ilegível; quem lê é a extensão Vortex · Admin (fora deste repositório).
  - `aeronaves.js`: catálogo do Mercado de Aeronaves do PilOps (135 modelos, sem preços publicados) e alcance/cruzeiro aproximados de cada um. Ajuste aqui se um modelo tiver valores diferentes ou se o PilOps lançar aeronaves novas.
  - `aeroportos.js`: coordenadas do OurAirports (gerado por `tools/gerar-aeroportos.mjs`). Ao regenerar, aumente o `?v=` dele em `index.html`.
- `coletor/`: lê a Vortex no PilOps pelo Chrome e publica o `dados.json`.
  - `extensao-chrome/`: extensão carregada sem compactação no Chrome.
  - `coletor-local.mjs`: serviço que recebe a leitura, grava e faz commit + push.
  - `dados.mjs`: validação da leitura e fusão do histórico de voos (sem repetir voos).
  - `extensao-astro/`: extensão "Vortex · Dono", do dono da companhia (ver "Dono da Vortex: frota ao vivo, voos e vagas"). O pacote para baixar é `docs/extensao-vagas.zip`, gerado por `tools/empacotar-extensao-vagas.ps1`.
- `docs/vagas.json`: carga e passageiros de cada vaga, publicados pela extensão do dono (não editar à mão).
- `.vortex-local/dados.json`: histórico financeiro privado, voo a voo, para calcular os percentuais e as medianas publicadas. Fica fora de `docs/` e é ignorado pelo Git. Preserve esse arquivo ao mover o projeto.
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

A sincronização automática permanece desativada, conforme decisão da administração. Use **Sincronizar Vortex** para atualizar os dados. O coletor valida o histórico e guarda a versão completa apenas em `.vortex-local/dados.json`. A publicação é criada por uma lista explícita de campos permitidos em `coletor/publicacao.mjs`: não inclui receitas ou cargas de cada voo, preços de ofertas nem voos em andamento. A renda de referência do comparador (medianas de P$ por rota e modelo) chegou a ser publicada em 27/11/2026; no mesmo dia, por decisão do Rafael, saiu do site aberto e passou a existir só cifrada, em `reservado.json`, para os admins. Publica também o consumo real (`fuelStats`): as "lbs" do histórico de voos do PilOps são o combustível utilizado (conferido na página do voo), então sai a mediana do combustível gasto em cada rota e modelo e o lb/h e lb/nm de cada modelo. Desde 28/11/2026 (revisão do Codex) só entram grupos com 3 voos ou mais, com valores arredondados (rota: 100 lb; modelo: 50 lb/h e 0,5 lb/nm): num grupo de um voo só a mediana era o combustível exato de um voo que aparece na lista pública. O ranking de pilotos não publica receita.

O comparador de rotas e cargas mostra toda a frota na rota escolhida: tempo pelo histórico, combustível previsto pelo histórico da Vortex (gasto mediano na mesma rota e modelo; sem voos na rota, o lb/h medido do modelo × tempo; modelo que nunca voou usa o catálogo de `docs/combustivel.js`; sempre + 45 min de reserva; tanque e limite combinado do Mercado de Aeronaves do PilOps, lidos em 27/11/2026). Com ofertas coladas, cada cenário do cálculo projeta o lucro do voo. A renda estimada de cada avião, a carga sugerida oferta por oferta e o preenchimento da carga no PilOps ficam só na versão dos admins. O campo aceita a lista copiada direto do passo "Selecione carga & rota" do PilOps (cada oferta em linhas: passageiros ou Cargo, destino, P$, NM, LBS); ofertas para outro destino e as bloqueadas ficam de fora, e o resultado indica a posição das ofertas na lista. Abrir esse passo no PilOps cria um voo ativo para o avião: cancele o planejamento depois de copiar; se o piloto digitar outro limite, ele vale só no navegador dele.

O monitor publica somente o percentual do último voo contra a mediana dos anteriores na mesma rota e modelo, pelo P$ pago por voo. Os números usados no cálculo ficam no arquivo privado. Sem esse arquivo, é possível recuperar o histórico operacional público, mas as referências financeiras só voltam a ser conhecidas conforme os voos são relidos. A migração inicial é feita por `node coletor/sanitizar-publicacao.mjs`, preservando os voos já registrados.

A página consulta os dados publicados a cada minuto para refletir uma coleta manual nova; isso não inicia coleta no PilOps. A seção de voos em andamento foi removida. Os scripts opcionais de agendamento continuam no repositório, mas a tarefa está desabilitada.

A retirada dos dados atuais não apaga revisões antigas do GitHub. A limpeza do histórico exige uma operação separada de reescrita das revisões; não é feita pela sincronização.

## Dono da Vortex: frota ao vivo, voos e vagas

O botão **Sincronizar Vortex (dono)**, logo abaixo da "Última coleta" no planejador, pede à extensão "Vortex · Dono", instalada no Chrome do dono, que faça a parte ao vivo do "Sincronizar Vortex" sem depender do PC do Rafael:

- **Frota ao vivo**: aeronaves, posição, status, base e hangares, hubs, rotas e pilotos.
- **Fila de voos**: os 10 últimos voos da aba Voos entram no planejador já na versão pública (sem P$, sem combustível, só "pago" ou não). Contam para o ranking, o desafio e a atividade dos pilotos.
- **Vagas**: a aba **Vagas** mostra a carga e os passageiros de cada vaga (duas barras, cheia ou não) só para o dono; para os outros aparecem "—". A extensão publica `docs/vagas.json`, e o comparador de rotas e cargas mostra o que há nas vagas da origem e quanto cada avião levaria (assentos e peso livre, limite − combustível).

O consumo de referência (medianas de combustível) e as variações percentuais continuam saindo só do histórico privado; a extensão do dono mantém os valores já publicados. Renda em P$ não é publicada.

Desde 28/11/2026 (revisão do Codex, Vortex · Dono 2.1.0 e Vortex · Admin 2.0.9) os arquivos de uma sincronização saem **num commit só** (`coletor/publicacao-github.mjs`): lidos da mesma versão do site, publicados juntos com a main avançando sem forçar, e remontados sobre a versão nova se outro autor publicar no meio. Uma leitura mais nova já publicada não recebe uma mais velha por cima; vagas mais novas no site ficam, com aviso.

Quando o Rafael roda o "Sincronizar Vortex" dele, o coletor traz antes os commits do dono (`git pull --rebase`) e junta ao histórico privado os voos que o dono publicou. Se o voo ainda estiver entre os 10 últimos, a leitura do Rafael devolve o P$ e o combustível a ele. Se já tiver saído da lista, fica no histórico sem P$ e sem combustível: conta para ranking e atividade, mas não para as medianas de renda e consumo.

Instalação, uma vez, no Chrome do dono:

1. Baixe `extensao-vagas.zip` (link no próprio botão do planejador, ou em `docs/` neste repositório) e extraia. Sai a pasta `vortex-dono`. Se a versão antiga ("Vortex · Vagas", pasta `vortex-vagas`) estiver instalada, remova-a antes em `chrome://extensions`.
2. Abra `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `vortex-dono`.
3. Crie um token do GitHub (quem tem acesso de escrita ao repositório cria; ninguém mais precisa vê-lo): GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Em *Repository access*, escolha **Only select repositories** → `vortexairways/vortex-planejador`. Em *Permissions → Repository permissions*, **Contents: Read and write**. Dê uma validade (por exemplo, 1 ano).
4. Clique no ícone da extensão (abre as opções), cole o token e salve. Ele fica guardado só naquele Chrome.

Para sincronizar: com o PilOps logado no mesmo Chrome, clique em **Sincronizar Vortex (dono)** no planejador (ou em **Sincronizar agora** nas opções da extensão). A extensão abre a Vortex numa aba em segundo plano (que fica ativa por alguns segundos durante a leitura dos pilotos), lê tudo, fecha a aba e grava `docs/dados.json` e `docs/vagas.json` no GitHub. Leva cerca de um minuto; os outros pilotos veem em 1 a 2 minutos.

- Se a conta não for a do dono, as barras das vagas vêm vazias e `vagas.json` não é publicado; a frota e os voos são publicados normalmente.
- Das vagas, publica-se: código, aeroporto e cidade, tamanho, as leituras das barras de carga e passageiros (número, limite, percentual e o texto curto mostrado), as rotas ligadas e a validade.
- A extensão recusa publicar se algum voo levar receita, combustível ou carga.
- A extensão guarda, só localmente, uma amostra do HTML da primeira vaga com números (botão **Copiar amostra** nas opções), para ajustar a leitura se o PilOps mudar o formato das barras.
- Só o planejador publicado em `https://vortexairways.github.io/vortex-planejador/` pode chamar a extensão.
- Se o dono e o Rafael publicarem no mesmo instante, a extensão tenta de novo sozinha; o coletor do Rafael desfaz o próprio commit e pede para rodar o "Sincronizar Vortex" outra vez.
- A extensão usa cópias dos arquivos do coletor (`leitura-vortex.js`, `dados.mjs`, `publicacao.mjs`). Ao mudar qualquer um deles ou a extensão, rode `tools/empacotar-extensao-vagas.ps1` (os testes em `tools/vagas.test.mjs` acusam cópia ou zip desatualizados) e peça ao dono para baixar de novo e recarregar em `chrome://extensions`.

## Publicar mudanças no site

Edite os arquivos em `docs/`, faça o commit e `git push`. O GitHub Pages publica sozinho.

## Tempos pelo histórico do PilOps

O cálculo usa a mediana dos últimos **até 10 voos concluídos** lidos no PilOps para a mesma origem, destino e modelo de aeronave. A direção inversa e outros modelos não são misturados. Um único registro já serve de referência, com sua quantidade e a data do último voo visíveis. Durações inválidas, nulas, negativas ou superiores a 48 horas são ignoradas. Sem histórico válido, o tempo é identificado como estimativa de catálogo. Não se presume que a duração registrada seja tempo no ar ou de bloco.

Na coleta atual, LEMD → KRDU resulta em **8h45 no 787-10** e **8h27 no MD-11**, a partir dos registros de cada modelo. A referência é histórica e não garante o tempo do próximo voo. Planos somam os trechos individualmente e informam quando misturam PilOps e catálogo, inclusive na mensagem compartilhada. Os tempos acompanham a **sincronização manual** já existente. A integração e a seção do SimBrief foram removidas, sem consultas à conta ou dependência de importações locais. Validação: `node --test tools/tempos.test.mjs tools/operacao.test.mjs`.

## Operação da semana e compartilhamento

A operação fica no início do planejador. A página dos pilotos não tem botão de edição: a operação é alterada em `docs/operacao.json` direto no GitHub. Uma conta com acesso de edição ao repositório pode alterar o título em português e inglês, as datas de início e fim (inclusive, no calendário de Brasília), a meta de voos e até cinco pares de origem/destino já cadastrados. Os trechos são numerados na ordem da seleção; uma sequência contínua também mostra o percurso completo em destaque. Ao salvar no GitHub, o Pages publica a seleção para todos. A sincronização de dados preserva esse arquivo.

O desafio considera os voos remunerados concluídos e lidos nas rotas em destaque dentro das datas configuradas. O **ranking semanal** conta voos remunerados concluídos em **todas as rotas cadastradas da Vortex** de segunda a domingo, pelo calendário de Brasília. O ranking vira automaticamente às segundas-feiras, inclusive com a página aberta, e usa os voos da última coleta. A variedade de rotas e depois a ordem alfabética desempatarão pilotos com o mesmo número de voos. As posições são consecutivas (1, 2, 3). Uma operação encerrada mantém seus resultados até a administração publicar a próxima.

Em uma rota ou plano, **Compartilhar voo/plano** abre uma mensagem editável em português e inglês. O piloto pode informar o nome, a aeronave e a situação do voo, copiar o texto e abrir o Discord da Vortex para publicar. O compartilhamento anuncia voos individuais. A duração estimada identifica a referência do histórico do PilOps ou do catálogo, inclusive quando combina ambas.

Validação da operação e da mensagem: `node --test tools/operacao.test.mjs`.

## Atividade dos pilotos em 30 dias

O contador da tabela de pilotos é independente do desafio semanal. A data inicial fica em `docs/atividade.json`, definida como **01/11/2026**. As janelas têm exatamente 30 dias inclusivos: 01 a 30/11, 01 a 30/12, 31/12 a 29/01 e assim por diante, pelo calendário de Brasília. A janela renova automaticamente, inclusive com a página aberta.

Conta os voos concluídos com duração positiva no histórico da companhia, incluindo traslados; não depende de receita nem da seleção atual de rotas. Somente pilotos no painel atual recebem o aviso: **zero voos registrados fica vermelho**, e pelo menos um retira o alerta. O prazo inclui o dia atual. O histórico continua guardado; só a contagem da janela se renova. A coleta é parcial, portanto ausência de registro pede confirmação do histórico e do ingresso antes de uma decisão de exclusão. Não há exclusão automática.

Validação: `node --test tools/atividade.test.mjs tools/operacao.test.mjs`.

## Observação

Os dados ficam públicos para quem tiver o link (não há login). Alcance e tempo de bloco são aproximações para triagem; combustível, carga e vento são decididos no PilOps/MSFS.
