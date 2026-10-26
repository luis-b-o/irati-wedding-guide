// Testes do raspador da lista da Afubra: node --test .github/scripts/
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  chaveDoNome,
  contarProdutos,
  descreverPagina,
  embelezarNome,
  lerItens,
  listaEncerrada,
  montarFeed,
  urlDaLista,
  validarFeed,
} from './atualizar-presentes.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
// Trecho real da página da loja, com um presente já comprado (cinza, sem link).
const FIXTURE = path.join(aqui, 'fixtures', 'lista-afubra.html');
const html = await readFile(FIXTURE, 'utf8');
// O que a loja mostra no lugar da lista depois de tirá-la do ar.
const ENCERRADA = path.join(aqui, 'fixtures', 'lista-encerrada.html');
const htmlEncerrada = await readFile(ENCERRADA, 'utf8');
const base = urlDaLista(96);

test('lê todos os blocos, inclusive o comprado sem link', () => {
  assert.equal(contarProdutos(html), 3);
  const { itens, descartados, blocos } = lerItens(html, base);
  assert.equal(blocos, 3);
  assert.equal(descartados.length, 0);
  assert.deepEqual(
    itens.map((i) => [i.name, i.status, i.priceBRL, i.price]),
    [
      ['Conj.Copo Agua 400Ml 6Pc Full Fit', 'available', '164,90', 164.9],
      ['Conj.Panela 5Pc Natural Stone Rochedo', 'fully-purchased', '629,90', 629.9],
      ['Conj.Panela 5Pc Titanium Nat.Alum.Injet. Mta', 'available', '1.409,90', 1409.9],
    ],
  );
  assert.equal(itens[0].id, '34331');
  assert.match(itens[0].url, /\/lista-presente-produto\/2391,7,34331\//);
});

test('aceita &nbsp; e atributos em outra ordem, como o Chrome serializa', () => {
  const variante = html
    .replaceAll('R$ ', () => 'R$&nbsp;')
    .replaceAll('Solicitado(s): <strong>', () => 'Solicitado(s):&nbsp;<strong>')
    .replace('<div class="col-md-4', () => '<div id="p1" class="col-md-4');
  const { itens, blocos } = lerItens(variante, base);
  assert.equal(blocos, 3);
  assert.deepEqual(itens.map((i) => i.priceBRL), ['164,90', '629,90', '1.409,90']);
});

test('recupera id e link do comprado pelo feed anterior (imagem ou nome)', () => {
  const anterior = {
    id: '34400',
    name: 'Conj.Panela 5Pc Natural Stone Rochedo',
    url: 'https://www.listapresentes.lojasafubra.com.br/lista-presente-produto/2391,13,34400/conj.html',
    image: 'https://outra-imagem.example/x.jpg',
  };
  const { itens } = lerItens(html, base, [anterior]);
  assert.equal(itens[1].id, '34400');
  assert.equal(itens[1].url, anterior.url);
});

test('sem histórico, o comprado ganha id sintético e o link da lista', () => {
  const { itens } = lerItens(html, base);
  assert.equal(itens[1].id, 'img-176564');
  assert.equal(itens[1].url, base);
});

test('presente cinza sem estar comprado sai da lista', () => {
  const indisponivel = html.replace(
    'Comprado(s): <strong>1</strong>',
    'Comprado(s): <strong>0</strong>',
  );
  const { itens, descartados } = lerItens(indisponivel, base);
  assert.equal(itens.length, 2);
  assert.equal(descartados[0].name, 'Conj.Panela 5Pc Natural Stone Rochedo');
});

test('presente ativo sem link é erro de layout', () => {
  const quebrado = html.replace(/<a href="[^"]*34331[^"]*"[^>]*>/, '');
  assert.throws(() => lerItens(quebrado, base), /sem link de produto/);
});

test('nomes no formato que o guia sempre mostrou', () => {
  const casos = {
    'APARELHO DE JANTAR E CHÁ BIONA DONNA LÍRIOS, CERÂMICA, 30 PEÇAS - 127234':
      'Aparelho de Jantar e Chá Biona Donna Lírios, Cerâmica, 30 Peças',
    'ASSADEIRA ALTA COM GRELHA MTA Nº3, 4,6L , ALUMÍNIO, GRAFITE - 7004':
      'Assadeira Alta com Grelha Mta Nº3, 4,6L, Alumínio, Grafite',
    'ASSADEIRA RETANGULAR FUNDA, LARANJA 35X24CM HERCULES - PA9000-A 35L':
      'Assadeira Retangular Funda, Laranja 35X24Cm Hercules - Pa9000-a 35L',
    'CAÇAROLA STONEFLON GRANITO NÚMERO 28 MTA*8433': 'Caçarola Stoneflon Granito Número 28 Mta',
    'PENTEADEIRA HENN AGNES*D921-190 BR/JEQUITIBA': 'Penteadeira Henn Agnes D921-190 Br/Jequitiba',
    "CONJUNTO DE TAÇAS PARA ÁGUA L'HERMITAGE CAMERATTA 365ML, VIDRO, 6 PEÇAS - 29063":
      "Conjunto de Taças para Água L'Hermitage Cameratta 365Ml, Vidro, 6 Peças",
    'Nome já com caixa mista': 'Nome já com caixa mista',
  };
  for (const [loja, guia] of Object.entries(casos)) assert.equal(embelezarNome(loja), guia);
  assert.equal(
    chaveDoNome('CAÇAROLA STONEFLON GRANITO NÚMERO 28 MTA*8433'),
    chaveDoNome('Caçarola Stoneflon Granito Número 28 Mta'),
  );
});

test('página que não é a lista é descrita pelo título e pelo texto visível', () => {
  const pagina = `<html><head><title>Lojas Afubra - Lista de presente</title>
    <style>.x{color:red}</style></head><body><script>var a = 1;</script>
    <h2>Lista&nbsp;não encontrada</h2>  <p>Procure   outra lista.</p><!-- fim --></body></html>`;
  assert.equal(
    descreverPagina(pagina),
    'título "Lojas Afubra - Lista de presente", texto "Lista não encontrada Procure outra lista."',
  );
  assert.match(descreverPagina(`<body>${'a'.repeat(500)}</body>`, 10), /texto "a{10}…"$/);
});

test('"Evento não encontrado" é a lista encerrada, e não layout novo', () => {
  assert.equal(listaEncerrada(htmlEncerrada), true);
  assert.equal(listaEncerrada(html), false);
  // Outra página sem a lista (erro, bloqueio) continua sendo falha.
  assert.equal(listaEncerrada('<body><h1>Erro 503</h1></body>'), false);
  assert.match(descreverPagina(htmlEncerrada), /texto "energia solar .* Evento não encontrado\. Retorne e tente novamente\."$/);
});

test('validação barra lista vazia e preço fora do formato', () => {
  assert.deepEqual(validarFeed(montarFeed({ itens: [], fonte: base })), [
    'nenhum presente lido: o layout da loja mudou?',
  ]);
  const { itens } = lerItens(html, base);
  itens[0].priceBRL = '164.90';
  assert.match(validarFeed(montarFeed({ itens, fonte: base })).join(), /fora do formato/);
});

test('linha de comando gera um feed no formato que o guia carrega', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'presentes-'));
  const saida = path.join(pasta, 'gift-feed.json');
  await promisify(execFile)(process.execPath, [
    path.join(aqui, 'atualizar-presentes.mjs'),
    '--html', FIXTURE,
    '--saida', saida,
  ]);
  const feed = JSON.parse(await readFile(saida, 'utf8'));
  assert.deepEqual(Object.keys(feed), [
    'feedVersion', 'scrapedAt', 'source', 'pageTitle', 'listTitle', 'itemCount', 'totals', 'items',
  ]);
  assert.deepEqual(Object.keys(feed.items[0]), [
    'id', 'name', 'priceBRL', 'price', 'requested', 'purchased', 'status', 'url', 'image',
  ]);
  assert.deepEqual(feed.totals, { requested: 3, purchased: 1 });
  assert.equal(feed.itemCount, 3);
});

test('linha de comando sai com 3 e não escreve o feed quando a loja encerrou a lista', async () => {
  const pasta = await mkdtemp(path.join(tmpdir(), 'presentes-'));
  const saida = path.join(pasta, 'gift-feed.json');
  const erro = await promisify(execFile)(process.execPath, [
    path.join(aqui, 'atualizar-presentes.mjs'),
    '--html', ENCERRADA,
    '--saida', saida,
  ]).then(() => null, (e) => e);
  assert.equal(erro?.code, 3);
  assert.match(erro.stdout, /a loja encerrou a lista/);
  await assert.rejects(readFile(saida), { code: 'ENOENT' });
});
