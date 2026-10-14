#!/usr/bin/env bash
# Monta em <saida> a pasta que vai para o GitHub Pages e valida o build antes
# de qualquer deploy.
#
# Entra no site tudo o que está versionado, menos .github/ e os dotfiles
# (.nojekyll só servia para o deploy a partir da branch). A validação barra o
# deploy se o index.html, o CSS ou o JS apontarem para um arquivo que não
# existe, ou se o gift-feed.json estiver quebrado.
#
# Uso: .github/scripts/montar-site.sh <saida>
set -euo pipefail

saida="$(realpath -m "${1:?uso: montar-site.sh <saida>}")"
raiz="$(git rev-parse --show-toplevel)"
base="/irati-wedding-guide/"

erros=0
falha() {
  echo "::error::$*"
  erros=$((erros + 1))
}

rm -rf "$saida"
mkdir -p "$saida"
git -C "$raiz" ls-files -z |
  grep -zEv '^\.github/|(^|/)\.[^/]+$' |
  (cd "$raiz" && xargs -0 cp --parents -t "$saida")

echo "Site montado em $saida: $(find "$saida" -type f | wc -l) arquivos."

# --- Validação ---------------------------------------------------------------

if [[ ! -s "$saida/index.html" ]]; then
  falha "index.html ausente ou vazio."
else
  grep -qE "<script type=\"module\"[^>]* src=\"${base}assets/[^\"]+\.js\"" "$saida/index.html" ||
    falha "index.html não carrega nenhum bundle JS de ${base}assets/."
  grep -qE "<link rel=\"stylesheet\"[^>]* href=\"${base}assets/[^\"]+\.css\"" "$saida/index.html" ||
    falha "index.html não carrega nenhum CSS de ${base}assets/."
fi

# Todo caminho absoluto sob o base path citado no HTML, no CSS ou no JS
# (bundles, fontes, gift-feed.json) precisa existir no site montado.
shopt -s nullglob
fontes=("$saida/index.html" "$saida"/assets/*.css "$saida"/assets/*.js)
shopt -u nullglob
referencias=0
while IFS= read -r ref; do
  referencias=$((referencias + 1))
  caminho="${ref#"$base"}"
  [[ "$caminho" == */ ]] && caminho+="index.html"
  [[ -s "$saida/$caminho" ]] || falha "Referência quebrada: $ref (arquivo $caminho não existe ou está vazio)."
done < <(grep -hoE "${base}[A-Za-z0-9._/-]+" "${fontes[@]}" | sort -u)
echo "Referências conferidas: $referencias."

if [[ ! -f "$saida/gift-feed.json" ]]; then
  falha "gift-feed.json ausente."
elif ! jq -e '(.items | type == "array" and length > 0) and all(.items[]; .id and .name)' \
  "$saida/gift-feed.json" >/dev/null; then
  falha "gift-feed.json inválido: precisa ser JSON com uma lista .items não vazia, cada item com id e name."
fi

if ((erros > 0)); then
  echo "Build reprovado: $erros problema(s)."
  exit 1
fi
echo "Build aprovado."
