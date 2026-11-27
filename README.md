# Planejador de rotas da Vortex Airways

Site estático (GitHub Pages) com o mapa, a frota e as rotas da Vortex no PilOps: distância e alcance de cada rota, tempo estimado, montagem de planos de trechos, sugestões de rotas (circuitos fechados com rotas cadastradas, classificados em nacionais, continentais e intercontinentais; rotas sem voo que só esperam piloto; aeroportos mais e menos voados), avisos de aeronaves fora da rede (com o piloto que as levou até lá e sugestões de traslado), cobertura das rotas pela frota (o que comprar ou reposicionar) e ranking de pilotos.

Em **Movimentações da frota**, o aviso fica ativo enquanto a última posição coletada da aeronave estiver fora da malha. Ele é encerrado quando uma coleta confirma a aeronave em um aeroporto com rota de partida. O piloto aparece no aviso quando o histórico permite identificar o voo que levou a aeronave até a posição atual. Os voos continuam no histórico, e os retornos recebem o selo verde **✓ Retorno à malha**. Traslados entre aeroportos da malha são neutros. A classificação usa a malha atual. Validação: `node --test tools/movimentacoes.test.mjs`.

## Estrutura

Em **Planejar ida e volta**, cada rota permite montar um retorno direto cadastrado, uma conexão na malha ou um traslado direto. A aeronave escolhida determina a triagem por trecho. Em **Simular nova rota**, informe dois códigos ICAO para ver os circuitos que a ligação fecharia, os modelos com alcance e as opções de reposicionamento segundo a última coleta. A simulação é local ao navegador. O aviso de compatibilidade começa por Congonhas e pelos modelos de código D, E e F catalogados no planejador. Sua referência é a [ficha do DECEA](https://aisweb.decea.mil.br/?codigo=SBSP&i=aerodromos). Alcance e porte são triagem para simulação. Validação: `node --test tools/malha.test.mjs`.

- `docs/`: o site publicado pelo GitHub Pages.
  - `dados.json`: frota, rotas, hubs, pilotos, histórico operacional, variações percentuais e, desde 27/11/2026, a renda e o consumo de referência do comparador de cargas (medianas por rota e modelo, sem voo, piloto ou data individual) (gerado pelo coletor; não editar à mão).
  - `aeronaves.js`: catálogo do Mercado de Aeronaves do PilOps (135 modelos, sem preços publicados) e alcance/cruzeiro aproximados de cada um. Ajuste aqui se um modelo tiver valores diferentes ou se o PilOps lançar aeronaves novas.
  - `aeroportos.js`: coordenadas do OurAirports (gerado por `tools/gerar-aeroportos.mjs`). Ao regenerar, aumente o `?v=` dele em `index.html`.
- `coletor/`: lê a Vortex no PilOps pelo Chrome e publica o `dados.json`.
  - `extensao-chrome/`: extensão carregada sem compactação no Chrome.
  - `coletor-local.mjs`: serviço que recebe a leitura, grava e faz commit + push.
  - `dados.mjs`: validação da leitura e fusão do histórico de voos (sem repetir voos).
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

A sincronização automática permanece desativada, conforme decisão da administração. Use **Sincronizar Vortex** para atualizar os dados. O coletor valida o histórico e guarda a versão completa apenas em `.vortex-local/dados.json`. A publicação é criada por uma lista explícita de campos permitidos em `coletor/publicacao.mjs`: não inclui receitas ou cargas de cada voo, preços de ofertas nem voos em andamento. Por decisão do Rafael (27/11/2026), publica a renda de referência do comparador: mediana de P$ por voo e por hora dos últimos 10 voos pagos de cada rota e modelo, e P$ por nm e por hora de cada modelo. Publica também o consumo real (`fuelStats`): as "lbs" do histórico de voos do PilOps são o combustível utilizado (conferido na página do voo), então sai a mediana do combustível gasto em cada rota e modelo e o lb/h e lb/nm de cada modelo. O ranking de pilotos não publica receita.

O comparador de rotas e cargas mostra toda a frota na rota escolhida: tempo pelo histórico, combustível previsto pelo histórico da Vortex (gasto mediano na mesma rota e modelo; sem voos na rota, o lb/h medido do modelo × tempo; modelo que nunca voou usa o catálogo de `docs/combustivel.js`; sempre + 45 min de reserva; tanque e limite combinado do Mercado de Aeronaves do PilOps, lidos em 27/11/2026), renda estimada e renda por hora. Com ofertas coladas, calcula a melhor combinação de lotes para cada aeronave. O campo aceita a lista copiada direto do passo "Selecione carga & rota" do PilOps (cada oferta em linhas: passageiros ou Cargo, destino, P$, NM, LBS); ofertas para outro destino e as bloqueadas ficam de fora, e o resultado indica a posição das ofertas na lista. Abrir esse passo no PilOps cria um voo ativo para o avião: cancele o planejamento depois de copiar; se o piloto digitar outro limite, ele vale só no navegador dele.

O monitor publica somente o percentual do último voo contra a mediana dos anteriores na mesma rota e modelo, pelo P$ pago por voo. Os números usados no cálculo ficam no arquivo privado. Sem esse arquivo, é possível recuperar o histórico operacional público, mas as referências financeiras só voltam a ser conhecidas conforme os voos são relidos. A migração inicial é feita por `node coletor/sanitizar-publicacao.mjs`, preservando os voos já registrados.

A página consulta os dados publicados a cada minuto para refletir uma coleta manual nova; isso não inicia coleta no PilOps. A seção de voos em andamento foi removida. Os scripts opcionais de agendamento continuam no repositório, mas a tarefa está desabilitada.

A retirada dos dados atuais não apaga revisões antigas do GitHub. A limpeza do histórico exige uma operação separada de reescrita das revisões; não é feita pela sincronização.

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
