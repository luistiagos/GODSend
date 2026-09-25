# Atualização Automática e Manual do Aplicativo Desktop

## Visão Geral

O **Xbox 360 Companion** possui um sistema integrado de verificação, download e instalação in-app de atualizações para o aplicativo Desktop (Windows Portable e instalador). O processo é desacoplado de lojas externas e assegura integridade total através de hash **SHA-256**, preservando as configurações, dados locais (`Ready/`, `Temp/`, `config.json`) e o histórico de downloads do usuário.

A arquitetura foi desenhada com base no padrão estabelecido no projeto de referência **Lemuroid** (`RetroGameSystem/version.json`), utilizando um manifesto estático publicado no Cloudflare R2 e HuggingFace.

---

## 1. Arquitetura e Fluxo de Dados

```
┌────────────────────────────────────────────────────────────────────────┐
│                        build-and-upload.ps1                            │
│  1. Compila Go Backend e Electron Desktop Portable                     │
│  2. Calcula SHA-256 e tamanho exato em bytes de dist/*.exe             │
│  3. Gera dist/version.json e dist/xboxcompanion.exe.sha256             │
│  4. Publica no R2 (XBOX360Companion/ e raiz) e HuggingFace             │
│  5. Purga cache Cloudflare e valida leitura pela URL pública           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Upload S3/R2
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│             https://versions.digitalstoregames.com/                    │
│             ├── XBOX360Companion/version.json                          │
│             └── XBOX360Companion/xboxcompanion.exe?v=X.Y.Z            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Consulta HTTP (GET com cache-busting)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Electron Desktop App (Main & Renderer)                   │
│                                                                        │
│  [Processo Main: autoUpdateService.ts & updateHandlers.ts]             │
│  - Checagem automática no startup (throttle de 12h e controle de skip) │
│  - Checagem manual via Configurações (sem throttle)                    │
│  - Download com stream de progresso para %TEMP%/godsend-update/        │
│  - Validação obrigatória de integridade via SHA-256                    │
│  - Troca do .exe por script desanexado que espera o launcher sair      │
│  - No boot seguinte: confere se a versão mudou (senão avisa + reporta) │
│                                                                        │
│  [Frontend React: AppUpdateModal.tsx & SettingsPage.tsx]               │
│  - Modal responsivo com notas de versão e progresso fluido             │
│  - Seção "Atualizações do Aplicativo" nas Configurações                │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Componentes e Arquivos

| Arquivo | Papel no Sistema |
|---|---|
| `src/electron-app/services/autoUpdateService.ts` | Serviço principal do Main process: consulta manifesto, download com progresso, validação SHA-256, troca do `.exe` (`buildReplaceScript`) e conferência no boot (`checkPendingUpdateResult`). |
| `src/electron-app/ipc/updateHandlers.ts` | Registra os manipuladores IPC (`update:check`, `update:download`, `update:apply`, `update:take-apply-failure`, `update:show-downloaded-file`, etc.). |
| `src/electron-app/preload.ts` | Expõe a ponte segura tipada `window.godsendApi` com suporte a listeners de progresso. |
| `src/electron-app/renderer/components/AppUpdateModal.tsx` | Interface do diálogo modal com novidades, barra de download e ação de reinicialização. |
| `src/electron-app/renderer/components/SettingsPage.tsx` | Seção nas Configurações com exibição da versão instalada, status e checagem manual. |
| `src/electron-app/renderer/App.tsx` | Gatilho automático de inicialização e montagem global do modal de atualização. |
| `src/electron-app/services/settingsService.ts` | Persistência de preferências (`autoCheckUpdates`, `lastUpdateCheck`, `skippedUpdateVersion`). |
| `src/electron-app/tests/unit/autoUpdate.test.cjs` | Testes de semver, hash e throttle; escolha do alvo; marcador de atualização pendente; e o script de troca rodando de verdade no PowerShell (espera o processo que roda do alvo; grava `copy-failed`). |
| `build-and-upload.ps1` | Pipeline automatizado de compilação, geração do `version.json`, publicação no R2 e purga de cache. |
| `upload-r2.ps1` | Script utilitário para envio direto de versões com manifesto e sidecars. |

---

## 3. Formato do Manifesto (`version.json`)

O arquivo é publicado em:
```
https://versions.digitalstoregames.com/XBOX360Companion/version.json
```

Estrutura JSON do manifesto:
```json
{
  "version": "2.12.39",
  "versionCode": "2.12.39",
  "releaseDate": "2026-08-17",
  "channel": "default",
  "downloadUrl": "https://versions.digitalstoregames.com/XBOX360Companion/xboxcompanion.exe?v=2.12.39",
  "sha256": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "size": 182345678,
  "notes": "Xbox 360 Companion v2.12.39",
  "portableUrl": "https://versions.digitalstoregames.com/XBOX360Companion/xboxcompanion.exe?v=2.12.39",
  "hfUrl": "https://huggingface.co/datasets/luisluis123/versions/blob/main/XBOX360Companion/xbox-360-companion-Portable-2.12.39.exe"
}
```

### O parâmetro `?v=<version>` na URL de download
O cache de borda (Cloudflare) na frente do armazenamento de distribuição pode manter em cache o binário da versão anterior na URL canônica. O parâmetro `?v=<version>` altera a chave de cache e garante que os clientes baixem exatamente os bytes correspondentes à nova versão e ao hash anunciado no manifesto.

---

## 4. Fluxos Operacionais

### 4.1 Ao Abrir o Aplicativo (Startup)
```
Inicialização do App
  └─ Aguarda 3.5 segundos (não concorre com Go backend)
        ├─ autoCheckUpdates está ativado? (Se não → encerra)
        ├─ Passou menos de 12 horas desde a última verificação? (Se sim → encerra)
        └─ GET version.json (com cache-busting ?t=timestamp)
              ├── Versão remota > Local E Usuário não dispensou essa versão
              │      → Abre modal de atualização (AppUpdateModal)
              └── Caso contrário → Silêncio (erros de rede são engolidos silenciosamente)
```

### 4.2 Verificação Manual (Pelas Configurações)
```
Configurações → "Verificar atualizações"
  └─ checkForUpdates(force = true)   [Ignora o throttle de 12h e versão dispensada]
        ├── Disponível → Abre AppUpdateModal com botão "Atualizar agora"
        ├── Atualizado → Mensagem: "Você já está na versão mais recente (vX.Y.Z)"
        └── Erro       → Exibe mensagem explicativa da falha de rede/servidor
```

### 4.3 Download e Troca do Executável
```
"Atualizar Agora"
  ├─ Stream HTTP/HTTPS para %TEMP%/godsend-update/xboxcompanion-update.exe.part
  ├─ Emissão de progresso: percentual (0-100%), MBs baixados/total e velocidade (MB/s)
  ├─ Conclusão do download: cálculo do hash SHA-256
  │     ├── Hash diverge do anunciado → Deleta arquivo corrompido e emite erro
  │     └── Hash confere → Renomeia para xboxcompanion-update.exe
  └─ "Reiniciar e Atualizar"
        ├─ Alvo: PORTABLE_EXECUTABLE_FILE (o launcher portable) ou execPath
        │     └── execPath dentro de %TEMP% (cópia extraída) → recusa e mostra o caminho manual
        ├─ Grava <userData>/update-pending.json (versão de origem e de destino)
        ├─ Dispara o PowerShell desanexado; só chama app.quit() depois do evento "spawn"
        │     └── spawn falhou (ex.: EPERM) → { ok: false } → modal em "error", sem fechar o app
        └─ O script:
              ├─ espera o pid do Electron E todo processo cujo Path é o alvo (até 180 s)
              ├─ copia o novo .exe (20 tentativas × 500 ms)
              ├─ grava <userData>/update-result.txt: "ok" ou "copy-failed: <erro>"
              └─ reabre o alvo (a versão nova, ou a antiga que então avisa)
```

**Por que esperar processos, e não um tempo fixo.** No build portable o arquivo que o usuário
abre é o launcher NSIS (`app-builder-lib/templates/nsis/portable.nsi`): ele define
`PORTABLE_EXECUTABLE_FILE = $EXEPATH`, roda o Electron com `ExecWait` e **só depois** apaga a pasta
extraída (~1,3 GB, 770 arquivos). O `.exe` a sobrescrever continua em uso até essa limpeza
terminar. A versão anterior esperava 1,5 s + 20 × 500 ms e relançava o alvo mesmo sem ter
copiado — em 11 de 11 aplicações observadas na telemetria o app voltou na versão antiga, sem aviso
(`docs/bugs/closed/electron-main-atualizacao-in-app-reabre-a-versao-antiga-sem-aviso_2026-09-24T15-18.md`).

### 4.4 Conferência no Boot Seguinte
```
bootstrap (app ready) → checkPendingUpdateResult()
  ├─ Sem update-pending.json → nada
  ├─ Lê e apaga update-pending.json e update-result.txt
  ├─ app.getVersion() >= versão de destino → sucesso (nada a fazer)
  └─ Versão não mudou →
        ├─ Log APP_UPDATE + reportError("update aplicado mas a versão não mudou …")
        └─ App.tsx (update:take-apply-failure) abre o modal em "error" com o motivo,
           o botão "Mostrar arquivo baixado" e os passos da atualização manual
```

---

## 5. Estados da Interface (`AppUpdateModal`)

| Estado | Comportamento na Tela | Ações Possíveis |
|---|---|---|
| `prompt` | Exibe versão atual vs. nova versão, data de lançamento e notas da release. | *"Atualizar agora"* / *"Lembrar mais tarde"* |
| `downloading` | Barra de progresso animada, MB baixados / total e velocidade em tempo real. | *"Cancelar download"* |
| `downloaded` | Confirmação de integridade verificada via SHA-256. | *"Reiniciar e Atualizar"* / *"Depois"* |
| `error` | Alerta visual com a mensagem de erro (rede, divergência de hash, ou atualização não aplicada — com os passos manuais). | *"Tentar novamente"* / *"Fechar"* / *"Mostrar arquivo baixado"* (só quando a aplicação falhou) |

---

## 6. Configurações Persistidas (`config.json`)

O arquivo de configurações em `%APPDATA%\Xbox 360 Companion\config.json` armazena os seguintes campos:

| Campo | Tipo | Descrição |
|---|---|---|
| `autoCheckUpdates` | `boolean` | Define se a verificação automática no startup está ativa (padrão: `true`). |
| `lastUpdateCheck` | `number` | Timestamp em milissegundos da última checagem remota (throttle de 12h). |
| `skippedUpdateVersion` | `string` | Número da versão que o usuário escolheu dispensar com *"Lembrar mais tarde"*. |

---

## 7. Como Publicar uma Nova Versão

Para compilar e publicar uma nova versão com atualização automática garantida:

1. Atualize a versão no `package.json`, `src/electron-app/package.json`, `src/server/main.go` e `aurora-scripts/main.lua`.
2. Adicione as notas no `CHANGELOG.md`.
3. Execute o script de publicação na raiz do repositório:
   ```powershell
   .\build-and-upload.ps1
   ```
4. O script executará:
   - Build do servidor Go e do executável portátil Electron.
   - Cálculo automático do hash SHA-256 e tamanho.
   - Geração e upload do `version.json` e do sidecar `xboxcompanion.exe.sha256`.
   - Purga do cache de borda do Cloudflare.
   - Validação imediata por download público.
