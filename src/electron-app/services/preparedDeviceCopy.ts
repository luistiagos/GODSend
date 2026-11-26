import type { PreparedDeviceState, XboxOneSeriesDeviceState } from "./preparedUsbDetection";

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
  "preparado-rgh": "Pendrive preparado para console RGH detectado. Se o seu Xbox é RGH, selecione “Xbox Desbloqueado RGH” acima e clique em “Avançar” para ir aos jogos. Se o seu Xbox é travado ou LT, ele não tem o perfil do exploit (ABadAvatar) — prepare de novo escolhendo “Xbox Bloqueado ou LT”.",
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

/**
 * Avisos explícitos de console trocado (isolamento total entre Xbox 360 e Xbox One/Series).
 * Nunca confundir um console com o outro — ambos são explicados em linguagem direta para leigos.
 */
export const CROSS_CONSOLE_NOTICE = {
  /** Exibido no fluxo do Xbox 360 quando há um pendrive/HD preparado para Xbox One / Series. */
  xeniaDriveInXbox360Flow: {
    title: "Este pendrive/HD está preparado para o Xbox One / Series (e não para o Xbox 360)",
    detail:
      "Ele está formatado em NTFS para rodar jogos no Xenia (Modo Desenvolvedor do Xbox One / Series). O Xbox 360 só lê pendrives em FAT32. Se quiser usar este mesmo dispositivo no Xbox 360, marque “Formatar antes” na preparação (isso apagará o preparo do Xbox One / Series), ou conecte outro pendrive/HD.",
  },
  /** Exibido no fluxo do Xbox One / Series quando há um pendrive/HD preparado para Xbox 360. */
  xbox360DriveInXeniaFlow: {
    title: "Este pendrive/HD está preparado para o Xbox 360 (e não para o Xbox One / Series)",
    detail:
      "Ele está formatado em FAT32 para o Xbox 360 (Aurora / BadAvatar). Para usar no Xbox One ou Xbox Series (Xenia), você precisa formatá-lo em NTFS e aplicar as permissões do Modo Desenvolvedor abaixo (isso apagará os arquivos do Xbox 360), ou conectar outro pendrive/HD.",
  },
};

/** Badges e textos exclusivos do fluxo Xbox One / Xbox Series X|S (Modo Desenvolvedor / Xenia). */
export const XENIA_DEVICE_STATE_BADGE: Record<
  XboxOneSeriesDeviceState,
  { tone: "green" | "amber"; title: string; detail: string } | null
> = {
  "sem-preparo": null,
  "preparado-outro-console": {
    tone: "amber",
    title: CROSS_CONSOLE_NOTICE.xbox360DriveInXeniaFlow.title,
    detail: CROSS_CONSOLE_NOTICE.xbox360DriveInXeniaFlow.detail,
  },
  "ntfs-sem-permissoes": {
    tone: "amber",
    title: "Dispositivo NTFS sem as permissões do Xbox One / Series",
    detail:
      "Este dispositivo já está em NTFS, mas ainda não tem todas as permissões do Modo Desenvolvedor (ou as pastas do Xenia). Você pode corrigir as permissões sem apagar seus jogos, ou formatar do zero.",
  },
  "preparado-xenia": {
    tone: "green",
    title: "Pronto para Xbox One / Series (Xenia)",
    detail:
      "Este dispositivo está em NTFS com as permissões do Modo Desenvolvedor conferidas e as pastas do Xenia prontas.",
  },
};
