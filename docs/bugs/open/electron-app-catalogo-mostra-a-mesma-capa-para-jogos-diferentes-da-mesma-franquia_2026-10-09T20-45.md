# Bug: o catálogo mostra a mesma capa para jogos diferentes da mesma franquia ("Air Conflicts Pacific Carriers", "Secret Wars" e "Vietnam" com a capa do Vietnam)

- **Detectado em:** 2026-10-09, relato do dono
- **Origem:** a investigar (resolução de capa do catálogo, `browse:fetch-cover`, e o cache de capas em disco)
- **Errors (serviço):** N/A (local)
- **Classe:** ux
- **Versões:** observado na 2.12.110 (versão do `src/electron-app/package.json` na data)
- **Reincidência:** a conferir. Parente do bug fechado
  `docs/bugs/closed/electron-browse-capa-de-outro-jogo-quando-a-busca-cai-no-titulo-sem-a-marca_2026-09-26T11-24.md`
  (LEGO), que tratou outra rota (remoção de marca)

## Sintoma

Relato do dono: "Estamos com problemas de covers erradas no catálogo, por exemplo o desta imagem que eu anexei,
temos 3 jogos da mesma franquia mas diferentes, e a mesma capa é mostrada. Temos várias ocorrências dessa."

O print (catálogo Xbox 360 do Companion) mostra três cards — *Air Conflicts Pacific Carriers*, *Air Conflicts
Secret Wars* e *Air Conflicts Vietnam* — todos com a capa de *Air Conflicts: Vietnam*.

## Evidência

Coletada em 2026-10-09 na máquina do dono.

**1. Os nomes dos cards são os do catálogo HuggingFace.** `cache/hf_xbox360.json` tem exatamente
`Air Conflicts Pacific Carriers`, `Air Conflicts Secret Wars`, `Air Conflicts Vietnam` (sem região). O
Minerva (`cache/minerva_xbox360.json`) tem os mesmos jogos com outro nome: `Air Conflicts - Pacific Carriers
(Europe)`, `Air Conflicts - Secret Wars (USA)`, `Air Conflicts - Vietnam (USA, Europe)`. Nenhuma entrada de
catálogo traz URL de capa.

**2. Os TitleIDs certos existem no dataset empacotado** (`cache/title_id_datasets/gist_title_ids.json`):
`413307D6` *Air Conflicts: Pacific Carriers*, `4B5907E0` *Air Conflicts: Secret Wars*, `413307D9`
*Air Conflicts: Vietnam*.

**3. O XboxUnity devolve capas distintas e corretas para cada TitleID:**

```
curl -s http://xboxunity.net/api/Covers/413307D6  -> 4 itens, todos 413307D6, 1º boxartfront/4583
curl -s http://xboxunity.net/api/Covers/4B5907E0  -> 1 item,  4B5907E0, boxartfront/4787
curl -s http://xboxunity.net/api/Covers/413307D9  -> 4 itens, todos 413307D9, 1º boxartfront/5669
curl -s "http://xboxunity.net/api/Covers/Air%20Conflicts%20Pacific%20Carriers" -> 0 itens
```

md5 das imagens baixadas: `4583` = `b645a4c3…`, `4787` = `1326aafb…`, `5669` = `2f23739c…` (três imagens
diferentes).

**4. O cache de capas em disco** (`%APPDATA%\Xbox 360 Companion\cache\covers\`) tem as duas famílias de chave:

| arquivo | gravado em | md5 | conteúdo |
|---|---|---|---|
| `air_conflicts_pacific_carriers.jpg` | 2026-09-01 21:54 | `2f23739c…` | **capa do Vietnam** |
| `air_conflicts_secret_wars.jpg` | 2026-09-01 21:54 | `2f23739c…` | **capa do Vietnam** |
| `air_conflicts_vietnam.jpg` | 2026-09-01 21:54 | `2f23739c…` | capa do Vietnam (certa) |
| `air_conflicts_-_pacific_carriers.jpg` | 2026-10-09 20:39 | `b645a4c3…` | capa certa (= XboxUnity 4583) |
| `air_conflicts_-_secret_wars.jpg` | 2026-10-09 20:39 | `1326aafb…` | capa certa (= XboxUnity 4787) |
| `air_conflicts_-_vietnam.jpg` | 2026-10-09 20:39 | `2f23739c…` | capa certa (= XboxUnity 5669) |

As chaves sem `-` (nome HF) foram gravadas em 01/09 e estão erradas; as com `-` (nome Minerva) foram gravadas
hoje e estão certas.

**5. Ocorrências: 73 grupos de arquivos com bytes idênticos sob chaves diferentes** no mesmo cache (619
arquivos). Comando:

```
cd "$APPDATA/Xbox 360 Companion/cache/covers" && md5sum * | awk '{print $1}' | sort | uniq -c | awk '$1>1' | wc -l
-> 73
```

Parte dos grupos é legítima (o mesmo jogo com dois nomes: `gears_of_war` / `gears_of_war_1`,
`aliens_vs_predator` / `aliens_vs__predator`). Parte é visivelmente jogos diferentes com a mesma imagem, por
exemplo:

- 8: `assassins_creed_1`, `_2_goty`, `_3`, `_4_black_flag`, `_brotherhood`, `_ii`, `_revelations`, `_rogue`
- 6: `call_of_duty_-_black_ops`, `_advanced_warfare`, `_black_ops_1`, `_black_ops_2`, `_black_ops_3`, `_ghosts`
- 6: `army_of_two*` (1, 40th day, devil's cartel)
- 5: `minecraft`, `minecraft_-_story_mode_*` (3), `minecraft_-_xbox_360_edition`
- 4: `armored_core_4`, `_5`, `_for_answer`, `_verdict_day`
- 4: `air_conflicts_*` (acima)
- 3: `ace_combat_6_*`, `ace_combat_assault_horizon`; `battlefield_3`, `field___stream`, `field___stream_-_…`

Datas de gravação dos 619 arquivos: 233 em 01/09, 225 em 02/09, 59 em 03/09, o resto espalhado até 09/10.

A classificação de cada grupo (legítimo x errado) e a contagem exata dos errados ficam para a investigação.
