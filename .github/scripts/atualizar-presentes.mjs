#!/usr/bin/env node
// Busca a lista de presentes na página da Lojas Afubra e gera o
// gift-feed.json que o guia carrega (mesmo formato do feed anterior).
//
// A página é aberta num Chrome headless (o mesmo do runner do GitHub), que
// entrega o HTML já serializado — com a codificação resolvida e as
// entidades decodificadas. O parser segue o do monorepo
// (packages/gift-list-react/src/feed/scrape.ts), já conferido com a loja:
//
// - Cada presente é um <div class="... produto-hover ...">.
// - Presente comprado fica cinza (classe lista-inativo) e SEM link do
//   produto; o id e o link dele são recuperados do feed anterior (pela
//   imagem e depois pelo nome). Sem histórico, recebe id sintético
//   img-<foto> e o link da lista.
// - A loja ignora o número da página na URL; para ver tudo, aumenta-se o
//   tamanho da página até bater com "Produtos encontrados: N".
// - Depois do casamento a loja pode tirar a lista do ar: no lugar dela, a
//   página mostra "Evento não encontrado". O script sai então com código 3
//   (e não 1), para o workflow seguir com a lista que já está no ar.
//
// Uso:
//   node .github/scripts/atualizar-presentes.mjs --saida gift-feed.json \
//     [--anterior feed-no-ar.json] [--html pagina.html] [--diagnostico pagina.html]
//
// --html lê um HTML salvo em vez de abrir a loja (testes). --diagnostico
// guarda a página que a loja devolveu quando ela não é a lista. Variável
// opcional NAVEGADOR: caminho do Chrome/Chromium.

import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const executar = promisify(execFile);

export const ORIGEM = 'https://www.listapresentes.lojasafubra.com.br';
export const ID_DA_LISTA = '2391';

export function urlDaLista(tamanhoDaPagina) {
  return `${ORIGEM}/lista-presente/0,0,${ID_DA_LISTA},0-0,${tamanhoDaPagina},1/copos-e-tacas.html`;
}

// --- Leitura do HTML ---------------------------------------------------------

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', iacute: 'í', ocirc: 'ô', oacute: 'ó',
  otilde: 'õ', uacute: 'ú', uuml: 'ü', Aacute: 'Á', Agrave: 'À', Acirc: 'Â',
  Atilde: 'Ã', Ccedil: 'Ç', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó',
  Ocirc: 'Ô', Otilde: 'Õ', Uacute: 'Ú', Uuml: 'Ü', ordm: 'º', ordf: 'ª',
  deg: '°', middot: '·', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', times: '×',
};

export function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, nome) => {
    if (nome[0] === '#') {
      const codigo = nome[1].toLowerCase() === 'x' ? parseInt(nome.slice(2), 16) : Number(nome.slice(1));
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteira;
    }
    return ENTIDADES[nome] ?? inteira;
  });
}

const limparTexto = (texto) => decodificarEntidades(texto).replace(/\s+/g, ' ').trim();

export function contarProdutos(html) {
  const m = html.match(/Produtos encontrados:\s*<b>\s*(\d+)\s*<\/b>/i);
  return m ? Number(m[1]) : null;
}

export function tituloDaLista(html) {
  const m = html.match(/<h2[^>]*>\s*(LISTA DE NOIVOS:[^<]+)<\/h2>/i);
  return m ? limparTexto(m[1]) : null;
}

export function tituloDaPagina(html) {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? limparTexto(m[1]) || null : null;
}

function textoVisivel(html) {
  const corpo = html.match(/<body[^>]*>([\s\S]*)/i)?.[1] ?? html;
  return limparTexto(
    corpo
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

// Título e começo do texto visível de uma página que não é a lista: o
// suficiente para o log dizer o que a loja devolveu (erro, aviso, bloqueio).
export function descreverPagina(html, limite = 400) {
  const texto = textoVisivel(html);
  const trecho = texto.length > limite ? `${texto.slice(0, limite)}…` : texto;
  return `título "${tituloDaPagina(html) ?? ''}", texto "${trecho}"`;
}

// A loja tirou a lista do ar (desde 25/10/2026, dia seguinte ao casamento):
// a página vem com o cabeçalho do site e só "Evento não encontrado.
// Retorne e tente novamente." no lugar dos presentes.
export function listaEncerrada(html) {
  return contarProdutos(html) === null && /\bEvento não encontrado\b/i.test(textoVisivel(html));
}

export class ListaEncerrada extends Error {
  constructor(url) {
    super(`A Afubra não encontra mais a lista ${ID_DA_LISTA} ("Evento não encontrado" em ${url}): a loja encerrou a lista.`);
    this.name = 'ListaEncerrada';
  }
}

// Nome da loja ("CAÇAROLA STONEFLON GRANITO NÚMERO 28 MTA*8433") no formato
// que o guia sempre mostrou ("Caçarola Stoneflon Granito Número 28 Mta"):
// sem o código interno no fim (*8433; um "*" no meio vira espaço) nem o
// código numérico final ( - 127234), e com iniciais maiúsculas, exceto
// preposições e conjunções.
const MINUSCULAS = new Set([
  'a', 'à', 'ao', 'aos', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em',
  'na', 'nas', 'no', 'nos', 'o', 'os', 'ou', 'para', 'por', 'sem',
]);

function semCodigos(nome) {
  return nome
    .replace(/\*\S*$/, '')
    .replace(/\*/g, ' ')
    .replace(/\s*-\s*\d+$/, '')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

export function embelezarNome(nomeDaLoja) {
  const nome = semCodigos(nomeDaLoja);
  if (nome !== nome.toLocaleUpperCase('pt-BR')) return nome;
  return nome
    .toLocaleLowerCase('pt-BR')
    .replace(/\p{L}+/gu, (palavra, posicao) =>
      posicao > 0 && MINUSCULAS.has(palavra)
        ? palavra
        : palavra[0].toLocaleUpperCase('pt-BR') + palavra.slice(1),
    );
}

// Mesmo produto, com ou sem acento, código ou caixa (nome da loja ou já
// embelezado): usado para reconhecer presentes comprados no feed anterior.
export function chaveDoNome(nome) {
  return semCodigos(nome)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleUpperCase('pt-BR');
}

// "_" = espaço comum ou &nbsp; (o Chrome serializa U+00A0 como &nbsp;).
const _ = '(?:\\s|&nbsp;)*';
const INICIO_DO_BLOCO = /<div\s[^>]*?class="([^"]*\bproduto-hover\b[^"]*)"[^>]*>/gi;
const LINK = /<a\s[^>]*href="([^"]*lista-presente-produto\/[^"]+)"/i;
const IMAGEM = /<img\s[^>]*src="([^"]+)"/i;
const NOME = /class="[^"]*\bnome-produto\b[^"]*"[^>]*>([^<]+)</i;
const CONTADORES = new RegExp(
  `Solicitado\\(s\\):${_}<strong>${_}(\\d+)${_}</strong>${_}Comprado\\(s\\):${_}<strong>${_}(\\d+)${_}</strong>`,
  'i',
);
const PRECO = new RegExp(`color-feature[^"]*"[^>]*>${_}R\\$${_}([\\d.,]+)${_}<`, 'i');
const ID_DO_PRODUTO = /\/lista-presente-produto\/\d+,\d+,(\d+)\//;

// Lê todos os blocos de produto da página, inclusive os comprados.
// Devolve { itens, descartados }: descartados são os que a loja deixou
// cinza sem estarem comprados (indisponíveis), que o guia não oferece.
export function lerItens(html, base, conhecidos = []) {
  const porImagem = new Map(conhecidos.map((k) => [k.image, k]));
  const porNome = new Map(conhecidos.map((k) => [chaveDoNome(k.name), k]));
  const inicios = [...html.matchAll(INICIO_DO_BLOCO)];
  const itens = [];
  const descartados = [];
  inicios.forEach((inicio, n) => {
    const bloco = html.slice(inicio.index, inicios[n + 1]?.index ?? html.length);
    const src = bloco.match(IMAGEM)?.[1];
    const nomeDaLoja = bloco.match(NOME)?.[1];
    const contadores = bloco.match(CONTADORES);
    const precoBRL = bloco.match(PRECO)?.[1];
    if (!src || !nomeDaLoja || !contadores || !precoBRL) {
      throw new Error(`Bloco de produto nº ${n + 1} ilegível em ${base}: o layout da loja mudou?`);
    }
    const nome = limparTexto(nomeDaLoja);
    const imagem = new URL(decodificarEntidades(src), base).href;
    const inativo = /\blista-inativo\b/.test(inicio[1]);
    const href = bloco.match(LINK)?.[1];
    if (!href && !inativo) {
      throw new Error(`O presente "${nome}" está ativo mas sem link de produto em ${base}.`);
    }
    let url;
    let id;
    if (href) {
      url = new URL(decodificarEntidades(href), base).href;
      id = url.match(ID_DO_PRODUTO)?.[1] ?? url;
    } else {
      const anterior = porImagem.get(imagem) ?? porNome.get(chaveDoNome(nome));
      url = anterior?.url ?? base;
      id = anterior?.id ?? `img-${imagem.match(/-(\d+)\.\w+$/)?.[1] ?? n + 1}`;
    }
    const solicitados = Number(contadores[1]);
    const comprados = Number(contadores[2]);
    const status =
      comprados >= solicitados ? 'fully-purchased' : comprados > 0 ? 'partially-purchased' : 'available';
    const item = {
      id,
      name: embelezarNome(nome),
      priceBRL: precoBRL,
      price: Number(precoBRL.replace(/\./g, '').replace(',', '.')),
      requested: solicitados,
      purchased: comprados,
      status,
      url,
      image: imagem,
    };
    if (inativo && status !== 'fully-purchased') descartados.push(item);
    else itens.push(item);
  });
  return { itens, descartados, blocos: inicios.length };
}

export function montarFeed({ itens, fonte, tituloPagina, tituloLista, agora = new Date() }) {
  return {
    feedVersion: 1,
    scrapedAt: agora.toISOString(),
    source: fonte,
    pageTitle: tituloPagina,
    listTitle: tituloLista,
    itemCount: itens.length,
    totals: {
      requested: itens.reduce((s, i) => s + i.requested, 0),
      purchased: itens.reduce((s, i) => s + i.purchased, 0),
    },
    items: itens,
  };
}

// Erros que impedem publicar o feed (lista vazia é sempre erro: um parse
// silenciosamente parcial é pior que manter a lista anterior no ar).
export function validarFeed(feed) {
  const erros = [];
  if (!Array.isArray(feed.items) || feed.items.length === 0) {
    return ['nenhum presente lido: o layout da loja mudou?'];
  }
  const ids = new Set();
  for (const it of feed.items) {
    const ref = `presente "${it.name}"`;
    if (ids.has(it.id)) erros.push(`${ref}: id repetido ${it.id}`);
    ids.add(it.id);
    if (!it.name) erros.push(`${ref}: nome vazio`);
    if (!/^\d{1,3}(\.\d{3})*,\d{2}$/.test(it.priceBRL)) erros.push(`${ref}: preço "${it.priceBRL}" fora do formato R$`);
    if (!(it.price > 0)) erros.push(`${ref}: preço inválido ${it.price}`);
    if (!Number.isInteger(it.requested) || it.requested < 1) erros.push(`${ref}: solicitados inválido ${it.requested}`);
    if (!Number.isInteger(it.purchased) || it.purchased < 0) erros.push(`${ref}: comprados inválido ${it.purchased}`);
    if (!it.url.startsWith(`${ORIGEM}/lista-presente`)) erros.push(`${ref}: link fora da loja ${it.url}`);
    if (!/^https:\/\//.test(it.image)) erros.push(`${ref}: imagem sem https ${it.image}`);
  }
  if (feed.itemCount !== feed.items.length) erros.push('itemCount diferente do número de presentes');
  return erros;
}

// --- Busca na loja -------------------------------------------------------------

async function encontrarNavegador() {
  const candidatos = [process.env.NAVEGADOR, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const candidato of candidatos.filter(Boolean)) {
    const caminhos = candidato.includes('/')
      ? [candidato]
      : (process.env.PATH ?? '').split(path.delimiter).map((dir) => path.join(dir, candidato));
    for (const caminho of caminhos) {
      try {
        await access(caminho, constants.X_OK);
        return caminho;
      } catch {
        // tenta o próximo
      }
    }
  }
  throw new Error('Nenhum Chrome/Chromium encontrado (defina NAVEGADOR).');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// diagnostico: arquivo onde guardar a página quando ela não é a lista.
async function abrirPagina(navegador, url, log, diagnostico) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const { stdout } = await executar(
        navegador,
        [
          '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
          '--no-first-run', '--blink-settings=imagesEnabled=false',
          '--virtual-time-budget=15000', '--dump-dom', url,
        ],
        { timeout: 90_000, maxBuffer: 32 * 1024 * 1024 },
      );
      if (contarProdutos(stdout) === null) {
        if (diagnostico) await writeFile(diagnostico, stdout);
        // "Evento não encontrado" é resposta da loja, não falha: não adianta insistir.
        if (!listaEncerrada(stdout)) {
          throw new Error(
            `a página não mostra "Produtos encontrados" (${stdout.length} bytes; ${descreverPagina(stdout)})`,
          );
        }
      }
      return stdout;
    } catch (erro) {
      if (tentativa >= 3) throw new Error(`Falha ao abrir ${url}: ${erro.message}`);
      log(`  tentativa ${tentativa}/3 falhou (${erro.message.split('\n')[0]}); tentando de novo`);
      await esperar(tentativa * 10_000);
    }
  }
}

// Aumenta o tamanho da página até ver todos os "Produtos encontrados".
async function lerListaCompleta({ navegador, html, conhecidos, log, diagnostico }) {
  for (let tamanho = 96; ; tamanho *= 2) {
    const url = urlDaLista(tamanho);
    log(`Lendo ${url}`);
    const pagina = html ?? (await abrirPagina(navegador, url, log, diagnostico));
    if (listaEncerrada(pagina)) throw new ListaEncerrada(url);
    const total = contarProdutos(pagina);
    if (total === null) throw new Error(`"Produtos encontrados" não aparece em ${url}: o layout da loja mudou?`);
    const lidos = lerItens(pagina, url, conhecidos);
    if (lidos.blocos === total) {
      return { ...lidos, url, tituloPagina: tituloDaPagina(pagina), tituloLista: tituloDaLista(pagina) };
    }
    if (lidos.blocos > total || html !== undefined || tamanho >= 1536) {
      throw new Error(`A loja informa ${total} presentes, mas ${lidos.blocos} foram lidos em ${url}.`);
    }
    log(`  ${lidos.blocos}/${total} presentes na página; aumentando para ${tamanho * 2}`);
  }
}

async function principal() {
  const { values } = parseArgs({
    options: {
      saida: { type: 'string' },
      anterior: { type: 'string' },
      html: { type: 'string' },
      diagnostico: { type: 'string' },
    },
  });
  if (!values.saida) {
    console.error(
      'Uso: atualizar-presentes.mjs --saida <arquivo> [--anterior <feed.json>] [--html <pagina.html>] [--diagnostico <pagina.html>]',
    );
    process.exit(2);
  }
  const log = (m) => console.log(m);

  let conhecidos = [];
  if (values.anterior) {
    try {
      conhecidos = JSON.parse(await readFile(values.anterior, 'utf8')).items ?? [];
    } catch (erro) {
      log(`Feed anterior ignorado (${erro.message}).`);
    }
  }
  const html = values.html ? await readFile(values.html, 'utf8') : undefined;
  const navegador = html === undefined ? await encontrarNavegador() : undefined;

  const lista = await lerListaCompleta({ navegador, html, conhecidos, log, diagnostico: values.diagnostico });
  const feed = montarFeed({
    itens: lista.itens,
    fonte: lista.url,
    tituloPagina: lista.tituloPagina,
    tituloLista: lista.tituloLista,
  });
  const erros = validarFeed(feed);
  if (erros.length > 0) {
    for (const e of erros) console.error(`::error::${e}`);
    throw new Error(`Feed reprovado: ${erros.length} problema(s).`);
  }
  for (const d of lista.descartados) {
    console.log(`::warning::"${d.name}" está indisponível na loja e saiu da lista do guia.`);
  }
  for (const it of feed.items.filter((i) => i.id.startsWith('img-'))) {
    console.log(`::warning::"${it.name}" foi comprado antes de ser visto com link; aponta para a lista da loja.`);
  }
  await writeFile(values.saida, `${JSON.stringify(feed, null, 2)}\n`);
  const comprados = feed.items.filter((i) => i.status === 'fully-purchased').length;
  log(`OK: ${feed.itemCount} presentes (${comprados} já ganho(s)) -> ${values.saida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((erro) => {
    // Lista encerrada não é erro do script: quem chama decide o que fazer.
    if (erro instanceof ListaEncerrada) {
      console.log(erro.message);
      process.exit(3);
    }
    console.error(`::error::${erro.message}`);
    process.exit(1);
  });
}
