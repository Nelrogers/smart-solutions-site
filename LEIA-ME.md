# Pacote de hospedagem: SMART SOLUTIONS by Nelson Rogério

Este pacote coloca a sua página no ar em um endereço próprio e faz o Radar de Licitações
se atualizar sozinho com dados do PNCP, duas vezes por dia. Tudo isso pode ser gratuito.

## O que tem aqui

| Arquivo | Para que serve |
|---|---|
| index.html | A página completa |
| favicon.png, apple-touch-icon.png | Ícone da aba do navegador e do celular |
| assets/og-image.png | Imagem que aparece na prévia do link (WhatsApp, LinkedIn, Instagram) |
| robots.txt, sitemap.xml | Ajudam o Google a encontrar a página |
| CNAME | Informa ao GitHub Pages o endereço do site |
| coletor/coletar-pncp.mjs | Programa que consulta o PNCP e gera os números do Radar |
| .github/workflows/atualizar-radar.yml | Agenda o coletor para rodar sozinho todo dia |
| data/radar.exemplo.json | Exemplo do formato dos dados (o real é gerado pelo coletor) |

## Antes de começar

Você vai precisar de:
- Uma conta gratuita no GitHub (github.com).
- Um domínio (veja o passo 1).
- Um computador comum. Só precisa instalar o Node 20 (nodejs.org) se for rodar o coletor por conta própria.

## Passo 1. Domínio

O domínio **nelsonrogerio.com.br** já está registrado e já foi aplicado nos arquivos deste pacote.
Mais adiante você pode registrar **smartsolutionsbynelsonrogerio.com.br** e fazê-lo redirecionar para este.
Se um dia trocar o domínio principal, substitua `nelsonrogerio.com.br` em index.html, robots.txt, sitemap.xml e CNAME.

## Passo 2. Colocar os arquivos no GitHub

1. Entre no GitHub e clique em **New repository**.
2. Nome sugerido: smart-solutions-site. Marque **Public** (necessário para o GitHub Pages gratuito). Crie.
3. Na página do repositório, clique em **uploading an existing file**.
4. Arraste todo o conteúdo desta pasta para a janela. Atenção: a pasta oculta **.github** também precisa subir.
   Se o navegador não a mostrar, use o botão **Add file > Upload files** e escolha a pasta inteira.
5. Clique em **Commit changes**.

## Passo 3. Ligar o site (GitHub Pages)

1. No repositório: **Settings > Pages**.
2. Em **Build and deployment**, escolha **Deploy from a branch**, branch **main**, pasta **/ (root)**. Salve.
3. Em 1 a 2 minutos aparece o endereço provisório, algo como `seu-usuario.github.io/smart-solutions-site`.
4. Em **Settings > Actions > General > Workflow permissions**, marque **Read and write permissions** e salve.

## Passo 4. Primeira coleta do Radar

1. Aba **Actions** do repositório > **Atualizar Radar de Licitações** > **Run workflow**.
2. Aguarde terminar (pode levar de alguns minutos a cerca de 1 hora, na primeira vez).
3. Quando terminar, abra a página e confira se o selo do Radar mostra **Captura** com a data, e não **Demonstração**.

Depois disso o coletor roda sozinho às 08:00 e às 22:00 (horário de Brasília).

**Não divulgue a página antes de ver o selo "Captura".** Sem o arquivo de dados, a página mostra números de demonstração.

### Se a coleta falhar

O servidor do GitHub fica fora do Brasil, e o PNCP pode bloquear ou limitar acessos de fora.
Se o Actions mostrar erro de conexão (403, timeout), rode o coletor no seu computador:

1. Instale o Node 20 em nodejs.org.
2. Abra um terminal na pasta do pacote.
3. Teste: `node coletor/coletar-pncp.mjs --teste`
   Se aparecer "TESTE OK", a API respondeu como esperado.
   Se aparecer "ATENÇÃO", copie a mensagem e envie para quem faz a manutenção.
4. Coleta completa: `node coletor/coletar-pncp.mjs`
5. No GitHub, envie os dois arquivos gerados na pasta data (radar.json e historico.json) com **Add file > Upload files**.

## Passo 5. Ligar o domínio nelsonrogerio.com.br

No Registro.br, abra o domínio no painel e vá em **DNS > Editar zona** (modo avançado).
Com o domínio usando os servidores do próprio Registro.br, crie estes registros:

| Tipo | Nome | Valor |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | SEU-USUARIO.github.io |

Troque SEU-USUARIO pelo nome da sua conta no GitHub.

Depois, no GitHub: **Settings > Pages > Custom domain**, digite `nelsonrogerio.com.br` e salve.
O arquivo CNAME deste pacote já indica esse domínio. Quando o GitHub liberar (pode levar de minutos a algumas horas),
marque **Enforce HTTPS**.

## Passo 6. Conferir a prévia do link

O endereço já está nos arquivos. Quando o site estiver no ar, cole o link no WhatsApp e confira se a logo aparece.
Se a prévia antiga ficar guardada, use o depurador de compartilhamento do Facebook ou do LinkedIn para renovar o cache.

## Como o Radar funciona

- **Abertas agora:** editais com proposta aberta, por estado e modalidade (API do PNCP, endpoint de propostas).
- **Publicadas hoje:** editais publicados no dia (endpoint de publicação).
- **Publicadas desde [data]:** soma acumulada a partir do dia da primeira coleta. Para começar com histórico anterior,
  rode uma vez `node coletor/coletar-pncp.mjs --desde=AAAA-MM-DD`. Quanto mais distante a data, mais demorado.
  Teste primeiro com poucos dias.
- **Já disputadas:** editais publicados no período que já não estão com proposta aberta. Inclui também os
  cancelados, desertos e revogados. É uma aproximação e vem com esse nome na página.
- **Valores em R$:** é o **valor total estimado** informado no edital, não o valor contratado.
- Modalidades fora das cinco principais são somadas em "Outras modalidades".

## Atualizando textos e contatos

Tudo está no arquivo index.html. Telefone, e-mail e redes ficam em `const C={...}` perto do final do arquivo.
Os versículos ficam na lista `const V=[...]`, no mesmo bloco de scripts.

## Cuidados

- A página não coleta dados dos visitantes. As mensagens só são enviadas se a pessoa tocar em enviar no WhatsApp.
- O navegador guarda no próprio aparelho apenas preferências, como o painel recolhido e perfis criados pelo visitante.
- A API do PNCP pode mudar. Se o Radar parar de atualizar, veja a aba Actions e rode o `--teste`.
- O GitHub pode pausar agendamentos de repositórios sem atividade por muito tempo. Confira a aba Actions de vez em quando.
- Texto bíblico: os versículos estão na Almeida Revista e Corrigida. Para usar a NAA, é preciso conferir
  as condições de uso com a Sociedade Bíblica do Brasil e incluir o crédito exigido.

## Outras opções de hospedagem

Cloudflare Pages e Netlify também aceitam este repositório e têm plano gratuito.
O agendamento diário continua sendo feito pelo GitHub Actions, que grava os arquivos de dados no repositório.
