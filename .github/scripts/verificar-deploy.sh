#!/usr/bin/env bash
# Confere o site no ar depois do deploy, em duas etapas:
#
#   1. Arquivos: cada arquivo do site montado precisa responder 200 na URL
#      publicada, com exatamente o mesmo conteúdo (sha256) deste commit, e
#      HTML/JS/CSS/JSON com o Content-Type certo.
#   2. Navegador: um Chrome headless abre a página e confere que o React
#      renderizou o guia e que a lista de presentes carregou do gift-feed.json.
#
# A CDN do GitHub Pages pode levar alguns instantes para trocar de versão,
# então cada etapa é repetida até passar ou até esgotar as tentativas.
#
# Uso: .github/scripts/verificar-deploy.sh <url_do_site> <pasta_do_site>
# Variáveis opcionais: TENTATIVAS (padrão 20), INTERVALO em segundos
# (padrão 15) e NAVEGADOR (caminho do Chrome/Chromium).
set -euo pipefail

url="${1:?uso: verificar-deploy.sh <url_do_site> <pasta_do_site>}"
site="$(realpath "${2:?uso: verificar-deploy.sh <url_do_site> <pasta_do_site>}")"
url="${url%/}/"
tentativas="${TENTATIVAS:-20}"
intervalo="${INTERVALO:-15}"
# Query string única por execução: fura o cache da CDN sem mudar o arquivo.
versao="${GITHUB_SHA:-local}-$(date +%s)"
resumo="${GITHUB_STEP_SUMMARY:-/dev/null}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

tipo_esperado() {
  case "$1" in
    *.html) echo "text/html" ;;
    *.js) echo "javascript" ;;
    *.css) echo "text/css" ;;
    *.json) echo "application/json" ;;
    *) echo "" ;;
  esac
}

# Etapa 1. Imprime um problema por linha; sem saída = tudo certo.
conferir_arquivos() {
  local arquivo endereco resposta status tipo esperado
  while IFS= read -r arquivo; do
    endereco="${url}${arquivo}"
    # A raiz do site também precisa servir o index.html.
    if [[ "$arquivo" == "index.html" ]]; then endereco="$url"; fi
    if ! resposta="$(curl -sS -o "$tmp/corpo" -w '%{http_code} %{content_type}' \
      --retry 2 --max-time 30 "${endereco}?v=${versao}" 2>&1)"; then
      echo "$arquivo: falha de rede ($resposta)"
      continue
    fi
    status="${resposta%% *}"
    tipo="${resposta#* }"
    if [[ "$status" != "200" ]]; then
      echo "$arquivo: HTTP $status"
      continue
    fi
    if ! cmp -s "$tmp/corpo" "$site/$arquivo"; then
      echo "$arquivo: conteúdo no ar diferente do commit"
      continue
    fi
    esperado="$(tipo_esperado "$arquivo")"
    if [[ -n "$esperado" && "$tipo" != *"$esperado"* ]]; then
      echo "$arquivo: Content-Type \"$tipo\", esperado \"$esperado\""
    fi
  done < <(cd "$site" && find . -type f -printf '%P\n' | sort)
}

encontrar_navegador() {
  local candidato
  for candidato in "${NAVEGADOR:-}" google-chrome google-chrome-stable chromium chromium-browser; do
    if [[ -n "$candidato" ]] && command -v "$candidato"; then return 0; fi
  done
  return 1
}

# Etapa 2. Imprime um problema por linha; sem saída = tudo certo.
conferir_navegador() {
  local navegador dom primeiro_presente texto
  if ! navegador="$(encontrar_navegador)"; then
    echo "nenhum Chrome/Chromium encontrado (defina NAVEGADOR)"
    return
  fi
  dom="$tmp/dom.html"
  if ! timeout 90 "$navegador" --headless=new --no-sandbox --disable-gpu \
    --disable-dev-shm-usage --no-first-run --virtual-time-budget=20000 \
    --dump-dom "${url}?v=${versao}" >"$dom" 2>"$tmp/navegador.log"; then
    echo "o navegador falhou ao abrir a página: $(tail -n 3 "$tmp/navegador.log" | tr '\n' ' ')"
    return
  fi
  # Textos que só existem no bundle JS: se aparecem, o React renderizou.
  for texto in "Vai ter casamento no interior do Paraná" "Como chegar" "Onde ficar" "Lista de presentes"; do
    grep -qF "$texto" "$dom" || echo "a página não mostra \"$texto\" (o guia não renderizou)"
  done
  if grep -qF "A lista tirou uma soneca" "$dom"; then
    echo "a lista de presentes mostrou o erro de carregamento"
  fi
  primeiro_presente="$(jq -r '.items[0].name' "$site/gift-feed.json")"
  grep -qF "$primeiro_presente" "$dom" ||
    echo "a lista de presentes não mostra \"$primeiro_presente\" (gift-feed.json não carregou)"
}

# Repete a etapa até passar; na última tentativa, reprova com os problemas.
rodar_etapa() {
  local nome="$1" funcao="$2" tentativa problemas
  for ((tentativa = 1; tentativa <= tentativas; tentativa++)); do
    problemas="$("$funcao" || true)"
    if [[ -z "$problemas" ]]; then
      echo "✅ $nome: ok (tentativa $tentativa)."
      return 0
    fi
    echo "⏳ $nome: tentativa $tentativa/$tentativas com $(wc -l <<<"$problemas") problema(s)."
    if ((tentativa < tentativas)); then sleep "$intervalo"; fi
  done
  echo "::error::$nome reprovada em $url"
  while IFS= read -r linha; do echo "::error::$linha"; done <<<"$problemas"
  {
    echo "### ❌ $nome reprovada"
    while IFS= read -r linha; do echo "- $linha"; done <<<"$problemas"
  } >>"$resumo"
  return 1
}

total="$(find "$site" -type f | wc -l)"
echo "Verificando $url ($total arquivos)."
rodar_etapa "Verificação dos arquivos" conferir_arquivos
rodar_etapa "Verificação no navegador" conferir_navegador

{
  echo "### ✅ Site no ar e verificado"
  echo
  echo "- URL: $url"
  echo "- Commit: \`${GITHUB_SHA:-local}\`"
  echo "- $total arquivos respondendo 200, com o mesmo conteúdo do commit"
  echo "- Guia renderizado no Chrome headless, com a lista de presentes carregada"
} >>"$resumo"
echo "Deploy verificado."
