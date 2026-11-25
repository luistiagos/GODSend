export interface QueueSuccessFeedbackInput {
  isMultiDisc?: boolean;
  discCount?: number;
  destinationKind?: "local" | "ftp" | "folder";
}

export interface QueueSuccessFeedback {
  headline: string;
  guidance: string;
  dismissLabel: string;
  goToQueueLabel: string;
}

/**
 * Builds clear, non-technical confirmation copy after adding a game to the
 * background download/install queue so users do not mistake enqueueing for
 * completion and unplug their USB drive early.
 */
export function buildQueueSuccessFeedback(
  input: QueueSuccessFeedbackInput = {},
): QueueSuccessFeedback {
  const isMultiDisc = Boolean(input.isMultiDisc);
  const discCount = typeof input.discCount === "number" && input.discCount > 1 ? input.discCount : 2;
  const destinationKind = input.destinationKind ?? "local";

  const headline = isMultiDisc
    ? `Todos os ${discCount} discos foram adicionados à fila!`
    : "Adicionado à fila!";

  const guidance = destinationKind === "ftp"
    ? "O download e o envio para o console começaram em segundo plano. Acompanhe o progresso na aba Fila até aparecer “Pronto”."
    : destinationKind === "folder"
      ? "O download e a preparação começaram em segundo plano e os arquivos serão salvos na pasta escolhida. Acompanhe na aba Fila até aparecer “Pronto”."
      : "O download e a gravação começaram em segundo plano. Acompanhe na aba Fila até aparecer “Pronto” antes de desconectar o pendrive.";

  return {
    headline,
    guidance,
    dismissLabel: "Entendi",
    goToQueueLabel: "Ir para a Fila",
  };
}
