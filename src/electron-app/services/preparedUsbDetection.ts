export type PreparedUsbWizardStep =
  | "checking-prepared"
  | "prepared-detected"
  | "unlock"
  | "method"
  | "usb"
  | "network";

/**
 * O que o dispositivo realmente tem. Antes isto era um booleano `alreadyPrepared`, que respondia
 * "tem alguma pasta de Xbox?" — e o assistente lia a resposta como "tem o desbloqueio", convidando
 * a pular a preparação num pendrive onde ela nunca rodou. As duas perguntas coincidem no caminho
 * feliz e divergem justamente em quem precisa de ajuda:
 *
 * - `jogos-apenas`: o baixador de jogos cria `Content/0000000000000000` sozinho;
 * - `preparado-rgh`: a preparação em modo RGH grava `Aurora/` e `launch.ini`, e **nenhum** arquivo
 *   do perfil do exploit — num console travado ou LT esse pendrive não abre a Aurora.
 */
export type PreparedDeviceState =
  | "sem-preparo"
  | "jogos-apenas"
  | "preparado-rgh"
  | "preparado-bloqueado-lt";

const PREPARED_DEVICE_STATE_RANK: Record<PreparedDeviceState, number> = {
  "sem-preparo": 0,
  "jogos-apenas": 1,
  "preparado-rgh": 2,
  "preparado-bloqueado-lt": 3,
};

function isPreparedDeviceState(value: any): value is PreparedDeviceState {
  return typeof value === "string" && value in PREPARED_DEVICE_STATE_RANK;
}

/** Com vários dispositivos conectados, quem decide a tela é o mais preparado deles. */
export function strongestPreparedDeviceState(
  states: readonly any[],
): PreparedDeviceState {
  let strongest: PreparedDeviceState = "sem-preparo";
  for (const state of states) {
    if (!isPreparedDeviceState(state)) continue;
    if (PREPARED_DEVICE_STATE_RANK[state] > PREPARED_DEVICE_STATE_RANK[strongest]) {
      strongest = state;
    }
  }
  return strongest;
}

export function readPreparedUsbDetection(result: any): PreparedDeviceState | null {
  if (result?.ok !== true || !Array.isArray(result.drives)) return null;
  return strongestPreparedDeviceState(result.drives.map((drive: any) => drive?.preparedState));
}

/**
 * Só existe caminho "pular a preparação e ir ao catálogo" quando o dispositivo tem o perfil do
 * exploit — ou quando o usuário já declarou que o console é RGH, o único caso em que um preparo
 * sem perfil é o preparo certo. `preparado-rgh` sem essa declaração é exatamente o pendrive que
 * não vai abrir a Aurora num console travado ou LT.
 */
export function canSkipPreparation(
  state: PreparedDeviceState | null | undefined,
  declaredRghConsole: boolean | null = null,
): boolean {
  if (state === "preparado-bloqueado-lt") return true;
  return state === "preparado-rgh" && declaredRghConsole === true;
}

/**
 * A varredura automática só desvia o assistente com prova no dispositivo. O preparo RGH depende de
 * uma declaração do usuário, e a declaração é lida no clique dele — não numa varredura de 5 s, que
 * trocaria a tela debaixo de quem acabou de escolher o modo do console.
 */
export function nextStepAfterPreparedUsbScan(
  current: PreparedUsbWizardStep,
  state: PreparedDeviceState,
  detectionDismissed: boolean,
): PreparedUsbWizardStep {
  const canSkip = canSkipPreparation(state) && !detectionDismissed;
  if (current === "checking-prepared") {
    return canSkip ? "prepared-detected" : "unlock";
  }
  if (current === "unlock" && canSkip) {
    return "prepared-detected";
  }
  return current;
}
