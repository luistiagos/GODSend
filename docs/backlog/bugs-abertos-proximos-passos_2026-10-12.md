# Bugs abertos e próximos passos — passagem de bastão (2026-10-12)

Fecho de uma sessão longa de acompanhamento do `/pipeline-correcao-bugs` (execuções `20261010-2242` e
`20261012-0329`). A próxima sessão parte daqui: não precisa reler o histórico.

## O que esta sessão fez

- 6 bugs já corrigidos foram de `open/` para `retest/`, com `## Status`: PowerShell lento, varredura síncrona,
  portátil no `%TEMP%`, Companion 32 bits (os 4 na 2.12.109 publicada), ECONNREFUSED do catálogo e lista do
  BadAvatar sem o HD (os 2 **não publicados**, posteriores à 2.12.109). Links atualizados.
- O pendrive de teste `USB DISK 2.0`, serial `247700023090`, foi liberado pelo dono para formatar e gravar, em todos os projetos.
  A regra e o lock entre projetos (`C:\projects\.pendrive-teste-247700023090.lock`) estão no
  `.claude/skills/pipeline-correcao-bugs/projeto.md` (seção Teste), e também no do PS2Companion.
- Execução `20261012-0329`: os 2 bugs de FAT32 (limite de 65536 entradas e jogo de 145 mil arquivos) foram corrigidos, testados no
  pendrive real e foram para `retest/`. Briefing: `C:\projects\.bugfix-xbox360\runs\20261012-0329-briefing.md`.

## Bugs em `docs/bugs/open/` (9)

| Bug | Sev. | Situação | Quem destrava |
|---|---|---|---|
| [badavatar-perfil-do-exploit-nao-aparece…](../bugs/open/badavatar-perfil-do-exploit-nao-aparece-na-tela-de-perfis_2026-09-23T15-20.md) | P1→médio | `bloqueado`: a causa provada já foi corrigida (2.12.99); sobra o caso do #66, que só reproduz no console do cliente | cliente/console |
| [catalogo-gta5-hf-incompleto…](../bugs/open/catalogo-gta5-hf-incompleto-sem-disco-instalacao-trava-boot_2026-09-26T01-05.md) | P1 | `sem-codigo`: o app já filtra a fonte incompleta (2.12.102/105) | dono apaga a linha `GTA 5 7z` da API de ROMs; boot do #85 |
| [release-xboxcompanion-exe-sem-assinatura…](../bugs/open/release-xboxcompanion-exe-sem-assinatura-barrado-no-download-pelo-smartscreen-do-edge_2026-10-06T17-49.md) | P2 | `sem-codigo`: falta assinatura Authenticode; contorno "Manter mesmo assim" | dono decide comprar o certificado |
| [electron-main-ferramentas-iso-mostram-sucesso…](../bugs/open/electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55.md) | P2 | novo, nunca passou pelo pipeline: "ISO para XEX/GOD" mostra check verde quando o backend falha | pipeline |
| [electron-main-preparo-em-pc-lento-para-a-copia…](../bugs/open/electron-main-preparo-em-pc-lento-para-a-copia-a-cada-revalidacao-usb-e-a-fisica-de-hd-entra-em-toda-revalidacao_2026-10-10T23-00.md) | P3 | novo: o preparo fica muito lento em PC lento (revalidação USB a cada ~17 s), mas não falha | pipeline (pendrive disponível) |
| [pipeline-report-de-telemetria-do-backend-nao-carrega-versao…](../bugs/open/pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30.md) | P3 | novo: o report do backend Go vem sem a versão e sem a máquina | pipeline |
| [pipeline-xex-com-default-xex-na-raiz…-hf-ext](../bugs/open/pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56.md) | P3 | novo (achado da execução 20261012-0329): a pasta do jogo sai como `<nome>_hf_ext`, sem TitleID | pipeline |
| [release-backend-go-sem-identidade…antivirus](../bugs/open/release-backend-go-sem-identidade-e-com-hash-novo-a-cada-release-vira-desconhecido-para-antivirus_2026-10-11T00-14.md) | P3 | análise concluída, nada implementado: o `godsend.exe` sai sem recurso de versão e com hash novo a cada release | pipeline |
| [build-build-server-ia32-sozinho-falha…](../bugs/open/build-build-server-ia32-sozinho-falha-no-verify-exigindo-o-godsend-exe-x64_2026-10-10T23-30.md) | P3 | novo: `build:server:win:ia32` isolado falha no verify; o `build-and-upload.ps1` não é afetado | pipeline |

Resumo: **6 candidatos ao pipeline** (os de dono "pipeline"); **3 parados por decisão ou ação fora do código**.

## Pendências do dono

1. **Publicar uma versão nova** (`build-and-upload.ps1`). Ela leva para o cliente: ECONNREFUSED, lista do BadAvatar com HD,
   fragmentação FAT32 (2.12.110) e a gravação XEX 1,36x mais rápida. Todos já estão em `retest/` esperando por ela.
2. Apagar `GTA 5 7z` da API remota de ROMs.
3. Decidir sobre o certificado de assinatura de código.
4. A pasta vazia `C:\projects\.bugfix-xbox360\lanes\wt-3` (sobra da execução de 10/10; nenhuma sessão a segura) pode ser
   apagada; a próxima execução também a reaproveita.

## Próximo passo sugerido

`/pipeline-correcao-bugs iniciar` neste repo: entram os 6 candidatos. O passo 3 da skill exclui sozinho os 3 com
veredito antigo sem mudança. Antes de iniciar, conferir a RAM livre (≥ 10 GB). Na madrugada de 2026-10-12, o Claude
Code matou um `go test` em FAT32 com 3,5 GB livres, e a execução ficou parada até um `reconcile --fix`.

Lacuna observada no motor (fonte em `retrobatnew/source/skills/pipeline-correcao-bugs`, não corrigida aqui): bug em
`aguardando-slot` com `retry_after` vencido e nenhuma sessão viva não é redespachado, e o `reconcile` sem `--fix`
responde "nada parado". Vale um bug no retrobatnew.
