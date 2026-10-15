# irati-wedding-guide

Build publicado do Guia do convidado do nosso casamento, servido pelo GitHub
Pages em <https://luis-b-o.github.io/irati-wedding-guide/>.

Os arquivos do site são gerados por `scripts/deploy-guide.sh` no monorepo
privado de origem: não edite à mão.

## Deploy

Todo push na `main` dispara o workflow
[Deploy no GitHub Pages](.github/workflows/deploy-pages.yml), que:

1. **busca a lista de presentes na página da Lojas Afubra** e gera o
   `gift-feed.json` publicado;
2. **valida o build**: toda referência do `index.html`, do CSS e do JS aponta
   para um arquivo que existe, e o `gift-feed.json` é válido;
3. **publica** o site no GitHub Pages;
4. **verifica o site no ar**: cada arquivo responde 200 com o mesmo conteúdo
   do pacote publicado, e um Chrome headless confirma que o guia renderiza com
   um card por presente.

Em PRs para a `main` só a busca e a validação rodam. Para republicar a `main` sem novo
commit: Actions → Deploy no GitHub Pages → Run workflow. Um run de um commit
que já não é o topo da `main` não publica nada, então re-executar um run
antigo nunca põe uma versão velha no ar.

## Lista de presentes

A lista vem da [página da Lojas Afubra](https://www.listapresentes.lojasafubra.com.br/lista-presente/0,0,2391,0-0,96,1/copos-e-tacas.html),
lida por `.github/scripts/atualizar-presentes.mjs` num Chrome headless: a cada
deploy e, de 15 em 15 minutos, por uma execução agendada que só republica o
site se algum presente mudou. O que a loja mostra como comprado aparece no guia
como "Já ganhamos"; o que ela deixa indisponível sem estar comprado sai da
lista. O `gift-feed.json` do repositório é só a referência inicial: o publicado
é sempre o lido da loja. Se a loja não responder num push, o deploy segue com a
lista que já está no ar.

Configuração necessária (uma vez): Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

A pasta `.github/` é mantida aqui, e não no monorepo: o `deploy-guide.sh`
precisa preservá-la ao sincronizar o build.
