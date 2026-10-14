# irati-wedding-guide

Build publicado do Guia do convidado do nosso casamento, servido pelo GitHub
Pages em <https://luis-b-o.github.io/irati-wedding-guide/>.

Os arquivos do site são gerados por `scripts/deploy-guide.sh` no monorepo
privado de origem: não edite à mão.

## Deploy

Todo push na `main` dispara o workflow
[Deploy no GitHub Pages](.github/workflows/deploy-pages.yml), que:

1. **valida o build**: toda referência do `index.html`, do CSS e do JS aponta
   para um arquivo que existe, e o `gift-feed.json` é válido;
2. **publica** o commit no GitHub Pages;
3. **verifica o site no ar**: cada arquivo responde 200 com o mesmo conteúdo
   do commit, e um Chrome headless confirma que o guia renderiza e que a lista
   de presentes carrega.

Em PRs para a `main` só a validação roda. Para republicar a `main` sem novo
commit: Actions → Deploy no GitHub Pages → Run workflow.

Configuração necessária (uma vez): Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

A pasta `.github/` é mantida aqui, e não no monorepo: o `deploy-guide.sh`
precisa preservá-la ao sincronizar o build.
