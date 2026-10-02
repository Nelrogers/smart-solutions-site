#!/usr/bin/env node
// Coletor do Radar de Licitações | SMART SOLUTIONS by Nelson Rogério
// Consulta a API pública do PNCP e grava data/radar.json para a página ler.
// Requer Node 18 ou superior. Não usa nenhuma biblioteca externa.
//
//   node coletor/coletar-pncp.mjs --teste        confere se a API responde como esperado
//   node coletor/coletar-pncp.mjs                coleta completa
//   node coletor/coletar-pncp.mjs --desde=AAAA-MM-DD   primeira execução com histórico retroativo (mais lento)
//   node coletor/coletar-pncp.mjs --ufs=GO,DF    coleta só alguns estados (para testes)
//   node coletor/coletar-pncp.mjs --sem-dia      pula histórico e "publicadas hoje" (mais rápido)
//
// Se o tempo acabar antes de terminar, o coletor grava o que conseguiu e mantém os dados anteriores
// dos estados que faltaram. Assim a próxima execução continua de onde parou.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE     = process.env.PNCP_BASE || 'https://pncp.gov.br/api/consulta/v1';
const PAUSA    = Number(process.env.PNCP_PAUSA_MS || 300);      // pausa entre chamadas de cada fila
const ESPERA   = Number(process.env.PNCP_ESPERA_MS || 2000);    // espera base entre tentativas
const RODADA   = Number(process.env.PNCP_RODADA_MS || 60000);   // espera entre rodadas de nova tentativa
const PARALELO = Number(process.env.PNCP_PARALELO || 3);        // estados coletados ao mesmo tempo
const ORC      = Number(process.env.PNCP_ORCAMENTO_MIN || 105) * 60000;  // tempo máximo de coleta
const SAIDA    = process.env.RADAR_SAIDA || 'data/radar.json';
const HIST     = process.env.RADAR_HIST  || 'data/historico.json';
let TAM = Number(process.env.PNCP_TAM_PAGINA || 0);             // 0 = descobrir o maior tamanho aceito

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const MODALIDADES = [1,2,3,4,5,6,7,8,9,10,11,12,13];
const GRUPO = {1:'Leilão Eletrônico',4:'Concorrência',5:'Concorrência',6:'Pregão Eletrônico',8:'Dispensa',12:'Credenciamento'};
const OUTRAS = 'Outras modalidades';

const args = process.argv.slice(2);
const flag = n => (args.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
const T0 = Date.now(), restante = () => ORC - (Date.now() - T0);
const tempo = () => { const s = Math.round((Date.now() - T0) / 1000); return '[' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ']'; };
const log = (...a) => console.log(tempo(), ...a);
class TempoEsgotado extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const brAgora = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date());
const HOJE = brAgora().slice(0, 10);
const ymd = iso => iso.replaceAll('-', '');
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const brData = iso => iso.split('-').reverse().join('/');
const LIMITE = ymd(somaDias(HOJE, 730));

async function get(path, params) {
  const url = BASE + path + '?' + new URLSearchParams(params);
  let ultimo = '';
  for (let t = 1; t <= 6; t++) {
    if (restante() <= 0) throw new TempoEsgotado('tempo esgotado');
    let espera = Math.min(ESPERA * 2 ** (t - 1), 60000);
    try {
      const r = await fetch(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(60000)});
      if (r.status === 204) return {data: [], totalPaginas: 0, paginasRestantes: 0};
      if (r.ok) return await r.json();
      const corpo = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      ultimo = 'HTTP ' + r.status + (corpo ? ' ' + corpo : '');
      if (![429, 500, 502, 503, 504].includes(r.status)) { const e = new Error(ultimo + ' em ' + url); e.fatal = true; throw e; }
      const ra = Number(r.headers.get('retry-after')); if (ra > 0) espera = Math.min(ra * 1000, 120000);
    } catch (e) { if (e.fatal || e instanceof TempoEsgotado) throw e; if (!ultimo.startsWith('HTTP')) ultimo = String(e.cause?.code || e.message); }
    if (t < 6) await sleep(espera);
  }
  throw new Error('Falha após várias tentativas (' + ultimo + '): ' + url);
}

async function paginar(path, params, onItem) {
  let p = 1, total = 0, paginas = 0;
  for (;;) {
    const j = await get(path, {...params, pagina: p, tamanhoPagina: TAM});
    const arr = j.data || [];
    arr.forEach(onItem); total += arr.length; paginas++;
    const restantes = j.paginasRestantes ?? ((j.totalPaginas || 0) - p);
    if (!arr.length || restantes <= 0) break;
    p++; await sleep(PAUSA);
  }
  return {total, paginas};
}

// Descobre o maior tamanho de página que a API aceita (menos chamadas, coleta mais rápida)
async function escolherTamanho() {
  if (TAM) return TAM;
  for (const t of [500, 200, 100, 50]) {
    try {
      const r = await fetch(BASE + '/contratacoes/proposta?' + new URLSearchParams({dataFinal: LIMITE, uf: 'DF', pagina: 1, tamanhoPagina: t}), {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(60000)});
      if (r.status === 204) { TAM = t; break; }
      if (r.ok) { const j = await r.json(); if ((j.data || []).length <= t) { TAM = t; break; } }
    } catch { /* tenta o próximo */ }
  }
  TAM = TAM || 50; log('tamanho de página escolhido:', TAM); return TAM;
}

const ufDe = it => String(it.unidadeOrgao?.ufSigla || it.ufSigla || '').toUpperCase();
const grupo = it => GRUPO[it.modalidadeId] || OUTRAS;
const valor = it => Number(it.valorTotalEstimado) || 0;
const vazio = () => ({mod: {}, modv: {}, prazo: [0,0,0,0], _abN: 0, _abV: 0});
async function lerJSON(f, padrao) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return padrao; } }
async function gravar(f, obj) { await mkdir(dirname(f), {recursive: true}); await writeFile(f, JSON.stringify(obj)); }
async function fila(itens, n, fn) { let i = 0; await Promise.all(Array.from({length: Math.min(n, itens.length)}, async () => { for (;;) { const k = i++; if (k >= itens.length) return; await fn(itens[k]); } })); }

// Editais com proposta aberta agora, por estado. Devolve os estados concluídos e os pendentes.
async function abertas(desde, alvo) {
  const res = {}, agora = Date.now();
  let pend = [...alvo];
  for (let rodada = 1; pend.length && rodada <= 3 && restante() > 0; rodada++) {
    const falhas = [];
    await fila(pend, PARALELO, async uf => {
      const a = vazio();
      try {
        const r = await paginar('/contratacoes/proposta', {dataFinal: LIMITE, uf}, it => {
          const enc = Date.parse(it.dataEncerramentoProposta);
          if (enc && enc < agora) return;
          const g = grupo(it);
          a.mod[g] = (a.mod[g] || 0) + 1; a.modv[g] = (a.modv[g] || 0) + valor(it);
          const dias = enc ? Math.ceil((enc - agora) / 864e5) : 99;
          a.prazo[dias <= 3 ? 0 : dias <= 7 ? 1 : dias <= 12 ? 2 : 3]++;
          if (String(it.dataPublicacaoPncp || '').slice(0, 10) >= desde) { a._abN++; a._abV += valor(it); }
        });
        res[uf] = a; log('abertas', uf, 'ok (' + r.total + ' itens em ' + r.paginas + ' páginas) | concluídos:', Object.keys(res).length + '/' + alvo.length);
      } catch (e) { if (!(e instanceof TempoEsgotado)) log('FALHA em', uf + ':', e.message.slice(0, 220)); falhas.push(uf); }
    });
    pend = falhas;
    if (pend.length && rodada < 3 && restante() > RODADA) { log('Nova tentativa para', pend.join(', '), 'após uma pausa'); await sleep(RODADA); }
  }
  return {res, pend};
}

// Editais publicados em um dia, por estado (cada modalidade é repetida se falhar)
async function publicadasDia(iso) {
  const por = Object.fromEntries(UFS.map(u => [u, {n: 0, v: 0}]));
  for (const m of MODALIDADES) {
    for (let t = 1; ; t++) {
      const loc = {};
      try {
        await paginar('/contratacoes/publicacao', {dataInicial: ymd(iso), dataFinal: ymd(iso), codigoModalidadeContratacao: m}, it => {
          const u = ufDe(it); if (!por[u]) return; (loc[u] ||= {n: 0, v: 0}); loc[u].n++; loc[u].v += valor(it);
        });
        for (const u in loc) { por[u].n += loc[u].n; por[u].v += loc[u].v; }
        break;
      } catch (e) { if (t >= 3 || e instanceof TempoEsgotado) throw e; log('Nova tentativa na modalidade', m); await sleep(RODADA); }
    }
  }
  return por;
}

// Histórico acumulado: soma os dias fechados desde a data de início
async function historico(desde) {
  let h = await lerJSON(HIST, null);
  if (!h) h = {desde, ate: somaDias(desde, -1), ufs: Object.fromEntries(UFS.map(u => [u, {n: 0, v: 0}]))};
  for (let d = somaDias(h.ate, 1); d < HOJE; d = somaDias(d, 1)) {
    const dia = await publicadasDia(d);
    for (const u of UFS) { h.ufs[u].n += dia[u].n; h.ufs[u].v += dia[u].v; }
    h.ate = d; await gravar(HIST, h); log('histórico', d, 'ok');
  }
  await gravar(HIST, h);
  return h;
}

async function teste() {
  console.log('Base:', BASE, '| hoje (Brasília):', HOJE);
  await escolherTamanho();
  const a = await get('/contratacoes/proposta', {dataFinal: LIMITE, uf: 'GO', pagina: 1, tamanhoPagina: TAM});
  const it = (a.data || [])[0];
  console.log('proposta/GO: itens na página =', (a.data || []).length, '| totalRegistros =', a.totalRegistros, '| totalPaginas =', a.totalPaginas);
  if (it) console.log('campos:', {modalidadeId: it.modalidadeId, valorTotalEstimado: it.valorTotalEstimado, dataEncerramentoProposta: it.dataEncerramentoProposta, dataPublicacaoPncp: it.dataPublicacaoPncp, ufSigla: it.unidadeOrgao?.ufSigla});
  const b = await get('/contratacoes/publicacao', {dataInicial: ymd(HOJE), dataFinal: ymd(HOJE), codigoModalidadeContratacao: 6, pagina: 1, tamanhoPagina: TAM});
  console.log('publicacao/pregão hoje: itens na página =', (b.data || []).length, '| totalRegistros =', b.totalRegistros);
  const ok = it && it.modalidadeId != null && it.unidadeOrgao?.ufSigla && 'valorTotalEstimado' in it;
  console.log(ok ? 'TESTE OK: a API respondeu no formato esperado.' : 'ATENÇÃO: formato diferente do esperado. Envie esta saída para ajustarmos o coletor.');
  process.exit(ok ? 0 : 2);
}

async function main() {
  if (args.includes('--teste')) return teste();
  const alvo = flag('ufs') ? flag('ufs').split(',').map(s => s.trim().toUpperCase()).filter(u => UFS.includes(u)) : UFS;
  const h0 = await lerJSON(HIST, null), base = await lerJSON(SAIDA, null);
  const desde = h0?.desde || flag('desde') || HOJE;
  log('início | estados:', alvo.length, '| paralelo:', PARALELO, '| tempo máximo:', Math.round(ORC / 60000), 'min');
  await escolherTamanho();
  const {res, pend} = await abertas(desde, alvo);
  if (!Object.keys(res).length && !base) throw new Error('Nenhum estado foi coletado e não há dados anteriores para manter.');

  let hist = null, hoje = null;
  if (!args.includes('--sem-dia') && restante() > 10 * 60000) {
    try { hist = await historico(desde); hoje = await publicadasDia(HOJE); }
    catch (e) { hist = hoje = null; log('Histórico e publicadas hoje não concluídos:', e.message.slice(0, 200)); }
  }

  const ufs = {};
  for (const u of UFS) {
    const a = res[u], ant = base?.ufs?.[u] || {};
    const modv = {}; for (const k of Object.keys(a ? a.modv : (ant.modv || {}))) modv[k] = Math.round((a ? a.modv : ant.modv)[k]);
    const ab = a ? [a._abN, a._abV] : (ant.ab || [0, 0]);
    let h = ant.hist || [0, 0, 0], hv = ant.histv || [0, 0, 0];
    if (hist && hoje) {
      const pubN = hist.ufs[u].n + hoje[u].n, pubV = hist.ufs[u].v + hoje[u].v;
      h = [pubN, Math.max(0, pubN - ab[0]), hoje[u].n];
      hv = [Math.round(pubV), Math.max(0, Math.round(pubV - ab[1])), Math.round(hoje[u].v)];
    }
    ufs[u] = {mod: a ? a.mod : (ant.mod || {}), modv, prazo: a ? a.prazo : (ant.prazo || [0,0,0,0]), hist: h, histv: hv, ab};
  }
  const faltam = [...new Set([...pend, ...(alvo.length === UFS.length ? [] : [])])];
  const sufixo = faltam.length ? ' (parcial: sem atualização em ' + faltam.join(', ') + ')' : (hist && hoje) || args.includes('--sem-dia') ? '' : ' (parcial: histórico e publicadas hoje)';
  await gravar(SAIDA, {captura: brData(HOJE) + ' ' + brAgora().slice(11, 16) + sufixo, desde: brData(desde), fonte: 'PNCP (API de Consulta)', parcial: faltam, ufs});
  log('Radar gravado em', SAIDA, faltam.length ? '| ATENÇÃO, estados pendentes: ' + faltam.join(', ') : '| completo');
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
