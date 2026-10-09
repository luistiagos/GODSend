# Bug: jogo com gravação interrompida aparece em "Jogos Instalados" e na "Biblioteca Local" como se estivesse pronto

- **Detectado em:** 2026-10-09, relato do dono com dois prints
- **Origem:** a investigar (varredura de jogos instalados / biblioteca local x pipeline de gravação local)
- **Errors (serviço):** N/A (local)
- **Classe:** ux / fail
- **Versões:** a conferir
- **Reincidência:** consequência do mesmo job de
  `pipeline-gravacao-local-fragmenta-pasta-fat32-ate-o-limite-de-65536-entradas-e-o-rename-falha_2026-10-09T12-00.md`
  (a falha de gravação em si é daquele doc; este trata só da exibição do jogo incompleto)

## Sintoma

Relato do dono: "Xboxcompanion, jogo EA FC 26 Legacy Edition, foi tentado baixar, mas não baixou completamente,
deu erro. Mesmo com o erro ele se encontra em Biblioteca Local e em jogos instalados. Atenção o jogo só deve
aparecer em jogos instalados ou em biblioteca local quando ele estiver pronto para jogar no xbox 360, pois se não o
usuario vai ter problemas achando que o jogo está funcional quando não está."

## Evidência

1. **Print 1 — Jogos Instalados**, `E:\ [BADAVATAR] (14.44 GB)`, FAT32, "6 jogos": card **EA FC 26 Legacy Edition**,
   selo `GOD`, 3.81 GB, `454109F4 E: (BADAVATAR)`. Contadores do topo: `XEX: 0`, `GOD: 6`.
2. **Print 2 — Baixar Jogos > Biblioteca Local**, "8 títulos": card **EA FC 26 Legacy Edition** com selo
   **"✓ Baixado"**, `E: (BADAVATAR)`.
3. Item da fila `pending_queue/0b51dd86eaf970cde0c9ce9a.json` (ver doc irmão): `state=Error`, destino `E:\`;
   pasta parcial `E:\Games\EA FC 26 Legacy Edition - 454109F4\` existe com parte dos arquivos (12.571 de 13.147
   só em `data/sceneassets/faces`; zip tem 13,15 GB descompactados, pasta mostrada com 3.81 GB).
