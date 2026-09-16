---
description: Governa a triagem, classificação de severidade, documentação e ciclo de vida de bugs do Xbox 360 Companion.
scope: docs/bugs/open/*, docs/bugs/closed/*, CHANGELOG.md, AGENTS.md
source_of_truth: docs/agents/skills/docs-source-of-truth.md
---

# Skill: Triagem e Ciclo de Vida de Bugs (Bug Triage)

## Descrição
Esta skill governa o processo de **triagem, investigação, documentação e encerramento de bugs** em todo o ecossistema do **Xbox 360 Companion** (Go Backend, Electron Desktop, scripts Aurora Lua e BadAvatar USB).

Ela garante que nenhum defeito seja tratado de forma ad-hoc, que causas raízes sejam identificadas e isoladas com precisão técnica, e que as resoluções venham acompanhadas de testes de regressão e documentação durável em `docs/bugs/`.

---

## 1. Localização e Convenções de Arquivos

Todos os registros de defeitos do projeto residem sob `docs/bugs/`:

```
docs/bugs/
├── open/     # Bugs ativos, sob investigação ou aguardando validação/dump de hardware
└── closed/   # Bugs resolvidos, testados e com registro no CHANGELOG.md
```

### Padrão de Nomenclatura
1. **Defeitos oriundos de telemetria ou falhas pontuais de subsistema:**
   `docs/bugs/open/<componente>-<sintoma-sucinto>_YYYY-MM-DDTHH-mm.md`
   - Exemplo: `backend-pipeline-disco-de-conteudo-sem-default-xex-recusado_2026-09-15T11-40.md`
   - Exemplo: `electron-main-multiplas-instancias-sem-single-instance-lock_2026-09-15T14-44.md`
2. **Incidentes complexos de hardware ou integração física:**
   `docs/bugs/open/YYYY-MM-DD-<slug-descritivo>.md`
   - Exemplo: `2026-09-05-fatal-crash-intercepted-pendrive-preparado.md`

> [!IMPORTANT]
> **Nunca apague** um arquivo de bug. Ao resolver um bug, mova-o usando `git mv docs/bugs/open/<arquivo>.md docs/bugs/closed/<arquivo>.md`.

---

## 2. Matriz de Severidade e Priorização

Ao triar um bug, classifique-o segundo a matriz:

| Nível | Definição | Exemplos no Projeto | Ação Imediata |
|---|---|---|---|
| **P0 - Crítico** | Crash de console, travamento no boot do Xbox, corrupção silenciosa de dados, partição apagada indevidamente, colisão destrutiva de instâncias. | Loop no hook Aurora (`XboxCompanionReady.lua`), corrupção de FAT32/MBR, roubo de scratch por outra instância (`.godsend-owner.pid`). | Parada de release; correção imediata e teste unitário transacional obrigatório. |
| **P1 - Alto** | Bloqueio total de um pipeline de entrega ou plataforma, recusa de mídias legítimas, cache reutilizando arquivos corrompidos. | Recusa de discos de conteúdo (`Batman Arkham Origins Disc 2`), arquivos corrompidos presos no cache IA/ROM/Minerva, auto-seleção de volume escolhendo USB removível. | Prioridade máxima de desenvolvimento; criar reprodução sintética. |
| **P2 - Médio** | Falha de resiliência com fallback funcionando, variantes regionais incorretas, vazamento de recursos não fatal, timeouts esporádicos. | Fallback escolhendo versão de outro país (ex: Japão ao invés de USA/En), timeout de enumeração USB por concorrência de scripts. | Investigar causa raiz; implementar resiliência e fallback gracioso. |
| **P3 - Baixo** | Erros de formatação de log, mensagens cosméticas confusas na UI, poluição de telemetria com títulos genéricos. | Título da telemetria usando `lastErr` em vez do primeiro erro de integridade; avisos de cache sem impacto operacional. | Ajustar no ciclo regular de manutenção. |

---

## 3. Estrutura Obrigatória do Documento de Bug

Todo bug registrado em `docs/bugs/open/` ou arquivado em `docs/bugs/closed/` **deve** conter a seguinte estrutura padronizada:

```markdown
# Bug: <Descrição concisa e objetiva do sintoma>

- **Detectado em:** YYYY-MM-DD HH:mm (telemetria de produção / teste local / hardware)
- **Origem:** <subsistema / arquivo::função responsável> (ex: `xbox-360-companion/pipeline` (`disc_layout.go`))
- **Errors (serviço):** <IDs numéricos da telemetria ou N/A se local>
- **Classe:** <crash | fail | data-corruption | perf | ux>
- **Versões:** <versão onde foi observado e verificação no código atual>
- **Reincidência:** <primeira vez | reincidente de bug X>

## Sintoma
<Logs literais, mensagens de erro exatas, exceções com stack trace, fotos ou descrições visuais do usuário>

## Causa raiz
<Análise técnica detalhada, referenciando arquivos, funções, estruturas e linhas exatas de código. Explicar POR QUE aconteceu, e não apenas o que quebrou.>

## Como reproduzir
<Passos determinísticos mínimos para reproduzir o problema localmente ou via teste unitário/sintético.>

## Resolução (vX.Y.Z)
<Lista numerada de todas as mudanças implementadas para corrigir a causa raiz e evitar regressões.>
1. **<Componente/Sentinela>**: <detalhes>
2. **<Resiliência/Tratamento>**: <detalhes>

## Testes Automatizados
<Testes unitários, de integração ou smoke adicionados para garantir que o defeito não reapareça.>

## Critérios para fechar
<Checklist rigoroso que deve ser satisfeito para mover o arquivo de open/ para closed/>
- [ ] Reprodução confirmada e compreendida
- [ ] Causa raiz isolada e corrigida
- [ ] Teste unitário automatizado cobrindo o caso limite
- [ ] Validação em hardware real (quando aplicável)
```

---

## 4. Fluxo de Trabalho de Triagem (Passo a Passo)

Quando um novo relato, crash ou telemetria for recebido, o agente deve seguir rigorosamente os passos abaixo:

### Passo 1: Inventário e Deduplicação
1. Liste os bugs abertos em `docs/bugs/open/`.
2. Verifique se o sintoma não é manifestação de um bug já fechado em `docs/bugs/closed/` (reincidência) ou de um bug atualmente aberto.
3. Se for reincidência, reabra o bug ou crie um novo referenciando o fechamento anterior e explicando por que a correção anterior não cobriu o novo caso limite.

### Passo 2: Isolamento da Camada e Reprodução
1. Identifique em qual das 4 camadas o defeito ocorre:
   - **Go Backend (`src/server/`)**: download, extração, conversão ISO->GOD, STFS, FTP, compatibilidade multidisco, auto-seleção de volume.
   - **Electron Desktop (`src/electron-app/`)**: IPC, ciclo de vida, single-instance lock, formatação FAT32/MBR, preparação BadAvatar USB.
   - **Aurora Lua (`aurora-scripts/`)**: scripts no console, scan paths, reinício automático, compatibilidade com Aurora Dash.
   - **Android Mobile (`src/android-app/`)**: Foreground Service, WakeLock, SELinux, JNI.
2. Crie uma reprodução mínima automatizada (teste unitário em Go ou Node.js).

### Passo 3: Criação do Registro em `docs/bugs/open/`
- Crie o arquivo com o template da Seção 3.
- Preencha todos os campos do cabeçalho, sintoma, candidatos a causa raiz e próximos passos.

### Passo 4: Implementação da Correção
- Respeite as invariantes arquiteturais do projeto documentadas em `AGENTS.md`:
  - Não misture erros de integridade com erros de armazenamento local (`isArchiveIntegrityError` vs `isLocalStorageHalt`).
  - Nunca remova `convert mbr` da formatação USB.
  - O nome da pasta XEX de destino sempre passa por `helpers.XEXFolderName()` / `xexDestinationName()`.
  - Mudanças no `launch.ini` ou no hook do Aurora exigem bump de `READY_TO_PLAY_CONFIGURATION_VERSION`.
  - Discos de conteúdo sem executável resolvem como `content` e usam `ErrNoExecutable`.

### Passo 5: Verificação e Fechamento
1. Execute todas as suites de testes:
   - Go: `go test -count=1 ./...` em `src/server`
   - Electron: `npm run test:safety` em `src/electron-app`
2. Mova o arquivo de bug:
   ```bash
   git mv docs/bugs/open/<arquivo>.md docs/bugs/closed/<arquivo>.md
   ```
3. Registre a correção no `CHANGELOG.md` sob `## [Unreleased] -> ### Fixed`:
   - Destaque o bug fechado com link para `docs/bugs/closed/<arquivo>.md`.
   - Explique o motivo (**por que** era um problema) e os detalhes de implementação.
4. Se o comportamento afetar a arquitetura ou criar novas invariantes, atualize `AGENTS.md` e invoque a skill `doc-sync.md`.

---

## 5. Anti-Patterns em Triagem de Bugs

- ❌ **Fechar bug sem teste automatizado**: Se o bug aconteceu uma vez, voltará a acontecer sem teste travando o comportamento.
- ❌ **Confundir sintoma com causa**: Tratar a mensagem da telemetria (ex: `lastErr`) sem analisar a cadeia completa de erros anexos.
- ❌ **Classificar disco cheio como falha de dispositivo ou corrupção**: Disco local cheio (`ENOSPC`) nunca pode apagar downloads já retidos nem ser relatado como defeito do pendrive.
- ❌ **Apagar registros de bug**: O histórico em `docs/bugs/closed/` é a base de conhecimento viva do projeto para evitar regressões futuras.

---

## Ver Também
- [`docs-source-of-truth.md`](docs-source-of-truth.md) — Convenções gerais de documentação e regras de versionamento.
- [`doc-sync.md`](doc-sync.md) — Checklist de auto-sincronização de documentação em mudanças de código.
- [`shim-go-backend.md`](shim-go-backend.md) — Convenções para o backend Go.
- [`shim-electron.md`](shim-electron.md) — Convenções para o Electron app.
