# Bug: em "Jogos Instalados" a capa de um mod é a do jogo base, diferente da do catálogo e da Biblioteca Local

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** a investigar (resolução de capa da tela Jogos Instalados x catálogo / Biblioteca Local)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Versões:** a conferir
- **Reincidência:** a conferir

## Sintoma

Relato do dono: "No xboxcompanion as covers divergem. Por exemplo para o jogo EA FC 26 Legacy Edition é uma
cover no catálogo e na biblioteca local após instalado, porém outra completamente diferente em Jogos Instalados.
Em jogos instalados a cover é do FIFA 17. O EA FC 26 Legacy Edition é um mod do FIFA 17 e tem sua própria capa,
a qual não aparece em jogos instalados."

Complemento do dono: "isto deve ocorrer também para outros mods" — o caso do EA FC 26 é um exemplo; a correção
tem de valer para qualquer release cujo TitleID seja o de outro jogo.

## Evidência

1. Pasta instalada `E:\Games\EA FC 26 Legacy Edition - 454109F4\` (mesmo job documentado em
   `pipeline-jogo-com-gravacao-interrompida-aparece-como-instalado-e-baixado_2026-10-09T19-30.md`): o nome
   da release é "EA FC 26 Legacy Edition", mas o TitleID gravado no nome da pasta é `454109F4`.
2. Relato do dono (sem print desta vez): catálogo e Biblioteca Local mostram a capa própria do mod; Jogos
   Instalados mostra a capa do FIFA 17.
