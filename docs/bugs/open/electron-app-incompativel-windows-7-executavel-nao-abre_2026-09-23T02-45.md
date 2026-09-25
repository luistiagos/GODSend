# Bug: Executável do Xbox 360 Companion falha silenciosamente e não abre no Windows 7 / 8 / 8.1 (incompatibilidade Electron 42 e Go 1.24)

- **Detectado em:** 2026-09-23 02:45 (chamado #27 do painel, sessão `55049166278770@lid`)
- **Origem:** conversa de suporte de cliente + inspeção de `src/electron-app/package.json` (`electron@42.4.1`), `src/server/go.mod` (`go 1.24.0`), `src/electron-app/scripts/build-portable.js` e `src/electron-app/build/installer.nsh`
- **Classe:** falha funcional / compatibilidade de SO / inicialização
- **Severidade:** P1 - Alto (usuários com Windows 7, 8 ou 8.1 não conseguem abrir nem utilizar o aplicativo; processo falha silenciosamente na inicialização sem aviso amigável nem bloqueio preventivo)
- **Complexidade:** média — exige verificação de versão do SO no instalador NSIS e no empacotador portátil, além de documentação clara de requisitos mínimos
- **Reincidência:** primeira vez neste repositório (problema análogo de suporte ao Windows 7 foi triado em `retrobatnew` sob [[es-nao-abre-windows7-setthreaddescription-kernel32_2026-09-22]])

## Sintoma, na ordem que o cliente viveu

1. O cliente comprou o pacote Xbox 360 e possui um console Xbox 360 com exploit BadAvatar e Aurora já instalados em HD externo.
2. Ao ser instruído a baixar o Xbox Companion para selecionar e gravar jogos, o cliente informou explicitamente que seu notebook é antigo e roda **Windows 7** ([114131]: *"Sim,mais ele é lerdo e usa o Windows 7"*).
3. O agente de atendimento instruiu o cliente a baixar o executável padrão distribuído pelo serviço (`https://versions.digitalstoregames.com/xboxcompanion.exe`, que é a build portátil `xbox-360-companion-Portable-*-x64.exe`), sugerindo que o sistema poderia rodar normalmente, apenas mais lento.
4. O cliente baixou o arquivo e tentou executá-lo no Windows 7. O executável sequer abriu janela ou processo visível ([114319]: *"Não deu certo no meu Windows"*, [114321]: *"nem abre o xboxcompanion"*).
5. O suporte não possuía diagnóstico imediato, pois o aplicativo não emite mensagem explicativa de incompatibilidade de sistema operacional ao usuário.

## Evidência

Trecho da conversa no WhatsApp (sessão `55049166278770@lid`, chamado #27):

- **[114131] 2026-09-19T16:57:53 (customer):**
  > *"Sim,mais ele é lerdo e usa o Windows 7"*
- **[114135] 2026-09-19T16:58:10 (XBOX360_AGENT):**
  > *"Entendo! O aplicativo que prepara o pendrive foi feito para Windows, e o ideal é usar uma versão mais recente, como Windows 10 ou 11. No Windows 7, pode ser que não rode direito ou fique muito lento por causa da idade do sistema. Mas dá pra tentar: baixa o aplicativo por este link e tenta instalar normalmente. Se abrir sem erro, seguimos por ele; se travar, me avise que aí eu te oriento outro caminho. https://versions.digitalstoregames.com/xboxcompanion.exe"*
- **[114158] 2026-09-19T17:03:03 (customer):**
  > *"Então me passa o link do Xbox conpanion para o Windows 7 blz"*
- **[114159] 2026-09-19T17:03:17 (XBOX360_AGENT):**
  > *"Claro, o link para baixar o Xbox Companion é este: https://versions.digitalstoregames.com/xboxcompanion.exe"*
- **[114278] 2026-09-19T18:51:38 (XBOX360_AGENT):**
  > Passo a passo detalhado para baixar e clicar duas vezes no `xboxcompanion.exe`.
- **[114319] 2026-09-19T19:35:31 (customer):**
  > *"Não deu certo no meu Windows"*
- **[114321] 2026-09-19T19:37:24 (customer):**
  > *"nem abre o xboxcompanion"*

## Causa raiz

A causa raiz foi provada por inspeção direta das dependências de runtime e do empacotamento:

1. **Electron 42.4.1 (`src/electron-app/package.json:68`):**
   - O projeto utiliza `"electron": "42.4.1"`.
   - O ecossistema Electron e Chromium encerrou oficialmente o suporte ao Windows 7, Windows 8 e Windows 8.1 no Electron 23 (Chromium 109 foi a última versão compatível; Chromium 110+ requer estritamente Windows 10 build 1809 ou superior).
   - Binários do Electron 42 dependem de símbolos de API do Windows 10 (ex.: APIs em `api-ms-win-core-*`, funções avançadas de thread e IO na `KERNEL32.dll` / `ntdll.dll`).
   - No Windows 7, o PE loader do Windows aborta o carregamento de `Xbox360Companion.exe` com erro de ponto de entrada (`STATUS_ENTRYPOINT_NOT_FOUND` / `0xC0000139`) ou falta de DLL, abortando o processo antes que qualquer linha de JavaScript seja interpretada.

2. **Go 1.24.0 (`src/server/go.mod:3`):**
   - O backend nativo utiliza `go 1.24.0`.
   - O Go descontinuou o suporte ao Windows 7 e Windows 8 a partir do Go 1.21. O runtime do Go 1.24 aborta a inicialização em sistemas operacionais legados da Microsoft.

3. **Ausência de verificação preventiva de OS no empacotador e instalador:**
   - Em `src/electron-app/build/installer.nsh`, o script NSIS faz apenas checagem de arquitetura (`${RunningX64}`), mas não valida a versão mínima do Windows (`${IsWin10}` ou `${AtLeastWin10}`).
   - O executável portátil gerado por `src/electron-app/scripts/build-portable.js` através do `electron-builder --win portable` extrai os binários no `%TEMP%` e tenta executar o binário do Electron diretamente, falhando de forma completamente silenciosa ou opaca para o usuário final.
   - O `README.md` do repositório lista apenas "Windows (x64)" sem especificar que o Windows 10 (64-bit) versão 1809+ é um requisito obrigatório.

## Escopo — o que NÃO é este bug

- **Não é falha de download corrompido de `xboxcompanion.exe`:** o arquivo baixou normalmente; a falha ocorre na execução do executável no Windows 7.
- **Não é bloqueio de SmartScreen ou antivírus:** o sintoma do SmartScreen é tela azul de proteção com botão "Mais informações". No Windows 7, o executável nem sequer instancia processo com janela gráfica devido à rejeição do loader.
- **Não é defeito no exploit BadAvatar ou nos scripts Aurora:** o cliente sequer chegou a conectar a mídia no PC para gravação.

## Tarefas propostas / Próximos passos

1. **Validação no instalador NSIS (`src/electron-app/build/installer.nsh`):**
   - Incluir verificação no `preInit` com `${If} ${IsWin10}` / `${AtLeastWin10}`. Se a versão for inferior ao Windows 10, exibir `MessageBox MB_ICONSTOP "O Xbox 360 Companion requer o Windows 10 (64 bits) ou Windows 11. O Windows 7 e 8 não são suportados."` e chamar `Abort`.
2. **Atualização da documentação (`README.md` e `docs/`):**
   - Atualizar a tabela de plataformas e a seção de Requisitos para explicitar: `Windows 10 (64-bit, versão 1809+) ou Windows 11`.
3. **Cruzamento com o agente de suporte:**
   - Registrar no repositório `digitalstoregamesproject` o bug de prompt/guia que instrui erroneamente o cliente a testar o aplicativo no Windows 7 em vez de apresentar imediatamente os requisitos reais (ver doc cruzado em `digitalstoregamesproject`).
