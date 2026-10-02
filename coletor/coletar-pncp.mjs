#!/usr/bin/env node
// Coletor do Radar de Licitações | SMART SOLUTIONS by Nelson Rogério
// Consulta a API pública do PNCP e grava data/radar.json para a página ler.
// Requer Node 18 ou superior. Não usa nenhuma biblioteca externa.
//
// Uso:
//   node coletor/coletar-pncp.mjs --teste            (confere se a API responde como esperado)
//   node coletor/coletar-pncp.mjs                    (coleta completa)
//   node coletor/coletar-pncp.mjs --desde=2026-08-01 (primeira execução com histórico retroativo, mais lento)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE  = process.env.PNCP_BASE || 'https://pncp.gov.br/api/consulta/v1';
const TAM   = Number(process.env.PNCP_TAM_PAGINA || 50);   // itens por página
const PAUSA = Number(process.env.PNCP_PAUSA_MS || 500);    // pausa entre chamadas
const ESPERA = Number(process.env.PNCP_ESPERA_MS || 2000);  // espera base entre tentativas
const RODADA = Number(process.env.PNCP_RODADA_MS || 60000); // espera entre rodadas de nova tentativa
const SAIDA = process.env.RADAR_SAIDA || 'data/radar.json';
const HIST  = process.env.RADAR_HIST  || 'data/historico.json';

const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const MODALIDADES = [1,2,3,4,5,6,7,8,9,10,11,12,13];        // códigos da tabela de domínio do PNCP
const GRUPO = {1:'Leilão Eletrônico',4:'Concorrência',5:'Concorrência',6:'Pregão Eletrônico',8:'Dispensa',12:'Credenciamento'};
const OUTRAS = 'Outras modalidades';

const args = process.argv.slice(2);
const flag = n => (args.find(a => a.startsWith('--' + n + '=')) || '').split('=')[1];
const TESTE = args.includes('--teste');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const brAgora = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date());
const HOJE = brAgora().slice(0, 10);
const ymd = iso => iso.replaceAll('-', '');
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const brData = iso => iso.split('-').reverse().join('/');

async function get(path, params) {
  const url = BASE + path + '?' + new URLSearchParams(params);
  let ultimo = '';
  for (let t = 1; t <= 6; t++) {
    let espera = Math.min(ESPERA * 2 ** (t - 1), 60000);
    try {
      const r = await fetch(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(60000)});
      if (r.status === 204) return {data: [], totalPaginas: 0, paginasRestantes: 0};
      if (r.ok) return await r.json();
      const corpo = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      ultimo = 'HTTP ' + r.status + (corpo ? ' ' + corpo : '');
      if (![429, 500, 502, 503, 504].includes(r.status)) { const e = new Error(ultimo + ' em ' + url); e.fatal = true; throw e; }
      const ra = Number(r.headers.get('retry-after')); if (ra > 0) espera = Math.min(ra * 1000, 120000);
    } catch (e) { if (e.fatal) throw e; if (!ultimo.startsWith('HTTP')) ultimo = String(e.cause?.code || e.message); }
    if (t < 6) await sleep(espera);
  }
  throw new Error('Falha após várias tentativas (' + ultimo + '): ' + url);
}

async function paginar(path, params, onItem) {
  let p = 1, total = 0;
  for (;;) {
    const j = await get(path, {...params, pagina: p, tamanhoPagina: TAM});
    const arr = j.data || [];
    arr.forEach(onItem); total += arr.length;
    const restantes = j.paginasRestantes ?? ((j.totalPaginas || 0) - p);
    if (!arr.length || restantes <= 0) break;
    p++; await sleep(PAUSA);
  }
  return total;
}

const ufDe = it => String(it.unidadeOrgao?.ufSigla || it.ufSigla || '').toUpperCase();
const grupo = it => GRUPO[it.modalidadeId] || OUTRAS;
const valor = it => Number(it.valorTotalEstimado) || 0;
const vazio = () => ({mod: {}, modv: {}, prazo: [0,0,0,0], _abN: 0, _abV: 0});

async function lerJSON(f, padrao) { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return padrao; } }
async function gravar(f, obj) { await mkdir(dirname(f), {recursive: true}); await writeFile(f, JSON.stringify(obj)); }

// Editais com proposta aberta agora, por estado (repete os estados que falharem)
async function abertas(desde) {
  const out = Object.fromEntries(UFS.map(u => [u, vazio()]));
  const agora = Date.now(), limite = ymd(somaDias(HOJE, 730));
  let pend = [...UFS];
  for (let rodada = 1; pend.length && rodada <= 3; rodada++) {
    const falhas = [];
    for (const uf of pend) {
      out[uf] = vazio();
      try {
        await paginar('/contratacoes/proposta', {dataFinal: limite, uf}, it => {
          const enc = Date.parse(it.dataEncerramentoProposta);
          if (enc && enc < agora) return;                       // já encerrado
          const a = out[uf], g = grupo(it);
          a.mod[g] = (a.mod[g] || 0) + 1; a.modv[g] = (a.modv[g] || 0) + valor(it);
          const dias = enc ? Math.ceil((enc - agora) / 864e5) : 99;
          a.prazo[dias <= 3 ? 0 : dias <= 7 ? 1 : dias <= 12 ? 2 : 3]++;
          if (String(it.dataPublicacaoPncp || '').slice(0, 10) >= desde) { a._abN++; a._abV += valor(it); }
        });
        process.stdout.write('abertas ' + uf + ' ok\n');
      } catch (e) { process.stdout.write('FALHA em ' + uf + ': ' + e.message + '\n'); falhas.push(uf); }
    }
    pend = falhas;
    if (pend.length && rodada < 3) { process.stdout.write('Nova tentativa para ' + pend.join(', ') + ' após uma pausa\n'); await sleep(RODADA); }
  }
  if (pend.length) throw new Error('Não foi possível coletar os estados: ' + pend.join(', '));
  return out;
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
      } catch (e) {
        if (t >= 3) throw e;
        process.stdout.write('Nova tentativa na modalidade ' + m + ': ' + e.message + '\n'); await sleep(RODADA);
      }
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
    h.ate = d; await gravar(HIST, h);                       // guarda o progresso a cada dia concluído
    process.stdout.write('histórico ' + d + ' ok\n');
  }
  return h;
}

async function teste() {
  console.log('Base:', BASE, '| data de hoje (Brasília):', HOJE);
  const a = await get('/contratacoes/proposta', {dataFinal: ymd(somaDias(HOJE, 730)), uf: 'GO', pagina: 1, tamanhoPagina: TAM});
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
  if (TESTE) return teste();
  const h0 = await lerJSON(HIST, null);
  const desde = h0?.desde || flag('desde') || HOJE;
  const ab = await abertas(desde);
  const h = await historico(desde);
  const hoje = await publicadasDia(HOJE);
  const ufs = {};
  for (const u of UFS) {
    const a = ab[u], pubN = h.ufs[u].n + hoje[u].n, pubV = h.ufs[u].v + hoje[u].v;
    const modv = {}; for (const k of Object.keys(a.modv)) modv[k] = Math.round(a.modv[k]);
    ufs[u] = {mod: a.mod, modv, prazo: a.prazo,
      hist: [pubN, Math.max(0, pubN - a._abN), hoje[u].n],
      histv: [Math.round(pubV), Math.max(0, Math.round(pubV - a._abV)), Math.round(hoje[u].v)]};
  }
  await gravar(SAIDA, {captura: brData(HOJE) + ' ' + brAgora().slice(11, 16), desde: brData(desde), fonte: 'PNCP (API de Consulta)', ufs});
  console.log('Radar gravado em', SAIDA);
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
