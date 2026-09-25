import type { PreparedDeviceState } from "./preparedUsbDetection";

/**
 * O texto que o usuário lê sobre o dispositivo dele, um por estado, num só lugar — porque foi o
 * texto que causou o dano: "Já existe um desbloqueio ou pastas de jogos (Aurora, exploit ou
 * Content) neste pendrive ou HD. Você pode pular a preparação" era mostrado para um pendrive onde
 * a preparação nunca tinha rodado, e o cliente descobria horas depois, na frente da TV, sem
 * nenhuma mensagem de erro.
 *
 * Regra que estes textos não podem quebrar: **só `preparado-bloqueado-lt` pode afirmar que existe
 * desbloqueio**, porque só ele foi conferido contra o perfil do exploit do pacote ativo. Ver
 * `docs/bugs/closed/badavatar-usb-service-declara-ja-preparado-sem-conferir-o-perfil-do-exploit_2026-09-23T14-08.md`
 * e o teste `tests/unit/preparedDeviceCopy.test.cjs`.
 */
export const PREPARED_DEVICE_NOTICE: Record<PreparedDeviceState, string> = {
  "sem-preparo": "Nenhum pendrive preparado foi encontrado. Aguarde o Windows mostrar a unidade e verifique novamente.",
  "jogos-apenas": "Encontramos jogos neste pendrive ou HD, mas ele ainda não foi preparado. Escolha o desbloqueio do seu console abaixo e prepare o dispositivo.",
  "preparado-rgh": "Este pendrive tem a Aurora para console RGH, mas não tem o perfil do exploit (ABadAvatar). Se o seu Xbox é travado ou LT, prepare de novo escolhendo “Xbox Bloqueado ou LT”.",
  "preparado-bloqueado-lt": "Este pendrive já tem o desbloqueio BadAvatar.",
};

export const PREPARED_DEVICE_TITLE: Record<PreparedDeviceState, string> = {
  "sem-preparo": "Pendrive Xbox 360 detectado!",
  "jogos-apenas": "Pendrive Xbox 360 detectado!",
  "preparado-rgh": "Pendrive preparado para console RGH!",
  "preparado-bloqueado-lt": "Pendrive com o desbloqueio BadAvatar detectado!",
};

export const PREPARED_DEVICE_SUMMARY: Record<PreparedDeviceState, string> = {
  "sem-preparo": "",
  "jogos-apenas": "",
  "preparado-rgh": "Ele carrega a Aurora no boot pelo launch.ini. Não tem o perfil do exploit, então serve somente a consoles com RGH.",
  "preparado-bloqueado-lt": "O perfil ABadAvatar está gravado neste dispositivo, e é ele que abre a Aurora num console travado ou LT.",
};

/** A tela que oferece pular a preparação só existe nestes dois estados (`canSkipPreparation`). */
export const SKIP_SCREEN_TEXT: Record<"preparado-rgh" | "preparado-bloqueado-lt", { title: string; detail: string }> = {
  "preparado-bloqueado-lt": {
    title: "Desbloqueio BadAvatar encontrado!",
    detail: "Este pendrive ou HD já tem o perfil ABadAvatar gravado — é ele que abre a Aurora num console travado ou LT. Você pode pular a preparação e baixar/instalar os jogos diretamente.",
  },
  "preparado-rgh": {
    title: "Pendrive preparado para console RGH encontrado!",
    detail: "Este pendrive ou HD carrega a Aurora no boot do seu console RGH pelo launch.ini. Você pode pular a preparação e baixar/instalar os jogos diretamente.",
  },
};

export const DEVICE_STATE_BADGE: Record<
  PreparedDeviceState,
  { tone: "green" | "amber"; title: string; detail: string } | null
> = {
  "sem-preparo": null,
  "jogos-apenas": {
    tone: "amber",
    title: "Jogos encontrados, mas sem preparação",
    detail: "Este dispositivo tem pastas de jogos, e nada mais: a preparação nunca rodou aqui. Escolha o desbloqueio do seu console e prepare o dispositivo.",
  },
  "preparado-rgh": {
    tone: "amber",
    title: "Preparado somente para console RGH",
    detail: "Tem a Aurora e o launch.ini, mas não tem o perfil do exploit. Se o seu Xbox é travado ou LT, prepare de novo escolhendo “Xbox Bloqueado ou LT”.",
  },
  "preparado-bloqueado-lt": {
    tone: "green",
    title: "Desbloqueio BadAvatar encontrado",
    detail: "O perfil ABadAvatar está gravado neste dispositivo.",
  },
};
