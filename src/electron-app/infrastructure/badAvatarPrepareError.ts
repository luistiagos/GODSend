/**
 * Translates raw OS, filesystem, layout, formatting, and verification errors
 * from BadAvatar USB handlers into simple, layman-friendly Portuguese messages
 * with clear next steps, while leaving the original technical details intact
 * for logs and telemetry.
 */

import { hasTechnicalErrorLeak } from "./userFriendlyError";

const ERRNO_PREFIX_PATTERN = /^(E[A-Z0-9_]+|UNKNOWN)\s*:/i;

const SIMPLE_LIST_PASSTHROUGH_PREFIXES = [
  "O Windows ainda está reconhecendo seu pendrive ou HD",
  "Seu pendrive ou HD está conectado, mas o computador está demorando",
  "O Windows PowerShell não foi encontrado neste computador",
];

const SIMPLE_PREPARE_PASSTHROUGH_PREFIXES = [
  ...SIMPLE_LIST_PASSTHROUGH_PREFIXES,
  "Confirme os requisitos do Xbox 360 antes de preparar o dispositivo.",
  "Atualize a lista e selecione novamente o pendrive ou HD.",
  "A preparação está disponível somente no Windows.",
  "Já existe uma preparação em andamento.",
];

const POWERSHELL_FORMAT_TRACE_PATTERN =
  /System\.Management\.Automation|FullyQualifiedErrorId|CategoryInfo|godsend_fat32_|Microsoft DiskPart|GetLastError\(\)=|fat32format|Set-Partition|Free Clusters|Formatting drive/i;

const INTERNAL_PATH_LEAK_PATTERN =
  /\.xbox-downloader|[\\/]\.xbox-downloader|godsend_fat32_/i;

function extractDriveLetter(value?: string): string {
  const match = String(value || "").trim().match(/^([A-Za-z]):/);
  return match ? `${match[1].toUpperCase()}:` : "";
}

function formatTargetPhrase(driveRoot?: string): string {
  const letter = extractDriveLetter(driveRoot);
  return letter ? `pendrive ou HD (${letter})` : "pendrive ou HD";
}

function extractErrnoCode(error: unknown, rawMessage: string): string | null {
  const rawCode = (error as { code?: unknown } | null)?.code;
  if (typeof rawCode === "string" && rawCode.trim()) {
    return rawCode.trim().toUpperCase();
  }
  const match = rawMessage.match(ERRNO_PREFIX_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

function extractErrorPaths(error: unknown, rawMessage: string): string[] {
  const paths: string[] = [];
  const candidateObj = error as { path?: unknown; dest?: unknown } | null;
  if (typeof candidateObj?.path === "string" && candidateObj.path.trim()) {
    paths.push(candidateObj.path.trim());
  }
  if (typeof candidateObj?.dest === "string" && candidateObj.dest.trim()) {
    paths.push(candidateObj.dest.trim());
  }
  for (const match of rawMessage.matchAll(/['"]([A-Za-z]:[\\/][^'"]+)['"]/g)) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

function isTargetDriveError(paths: string[], rawMessage: string, driveRoot?: string): boolean {
  const targetLetter = extractDriveLetter(driveRoot);
  if (paths.some((p) => /\.xbox-downloader/i.test(p)) || /\.xbox-downloader/i.test(rawMessage)) {
    return true;
  }
  if (!targetLetter || paths.length === 0) {
    return true;
  }
  if (paths.some((p) => extractDriveLetter(p) === targetLetter)) {
    return true;
  }
  return false;
}

function formatErrnoMessage(
  code: string,
  targetPhrase: string,
  onTargetDrive: boolean,
): string {
  if (!onTargetDrive) {
    if (code === "ENOSPC") {
      return `O computador ficou sem espaço livre para preparar os arquivos do seu ${targetPhrase}. Libere espaço no computador e tente novamente.`;
    }
    return `O computador não conseguiu preparar os arquivos para enviar ao seu ${targetPhrase}. Feche outros programas, pause o antivírus por alguns minutos e tente novamente.`;
  }

  switch (code) {
    case "EROFS":
      return `O seu ${targetPhrase} está travado contra gravação. Verifique se há alguma trava física nele e destrave, ou teste com outro pendrive ou HD.`;
    case "EPERM":
    case "EACCES":
    case "EBUSY":
      return `O Windows ou o antivírus bloqueou o acesso ao seu ${targetPhrase}. Feche todas as pastas abertas dele, pause o antivírus por alguns minutos e tente novamente.`;
    case "ENOSPC":
      return `O seu ${targetPhrase} ficou sem espaço livre suficiente. Apague arquivos dele ou use outro pendrive ou HD maior.`;
    default:
      return `Não foi possível gravar no seu ${targetPhrase} porque ele desconectou ou falhou no meio da cópia. Tire e coloque em outra porta USB (sem adaptadores), troque o cabo se for HD externo, ou teste com outro pendrive ou HD.`;
  }
}

function formatPowerShellFormatError(rawMessage: string, targetPhrase: string): string {
  if (/A forma(?:t|ta)[cç][aã]o terminou,\s*mas o Xbox 360 n[aã]o vai ler o disco|Set-Partition recusou|O Windows recusou corrigir o tipo da parti[cç][aã]o|particao marcada com tipo/i.test(rawMessage)) {
    return `Este ${targetPhrase} não ficou em um formato que o Xbox 360 consiga ler. Desconecte ele e teste com outro pendrive ou HD.`;
  }
  if (/GetLastError\(\)=5|negou a escrita direta|Acesso negado|acesso controlado a pastas/i.test(rawMessage)) {
    return `O Windows ou o antivírus bloqueou a formatação do seu ${targetPhrase}. Feche todas as pastas abertas dele, pause o antivírus por alguns minutos e tente novamente.`;
  }
  if (/GetLastError\(\)=32|sendo usado por outro processo|Feche qualquer programa/i.test(rawMessage)) {
    return `Outro programa ou pasta aberta está usando o seu ${targetPhrase}. Feche todas as janelas desse dispositivo, desconecte e conecte de novo, e tente novamente.`;
  }
  if (/GetLastError\(\)=2|dispositivo inexistente|n[aã]o [eé] v[aá]lido|N[aã]o h[aá] um disco selecionado/i.test(rawMessage)) {
    return `O seu ${targetPhrase} desconectou ou parou de responder durante a formatação. Troque de porta USB, reconecte o cabo ou teste com outro pendrive ou HD.`;
  }
  return `Não foi possível formatar o seu ${targetPhrase}. Feche pastas abertas dele, tente em outra porta USB ou use outro pendrive ou HD.`;
}

/**
 * Converts a thrown drive-listing error into a simple user-facing message.
 */
export function formatBadAvatarListErrorForUser(error: unknown): string {
  const rawMessage = String((error as { message?: unknown } | null)?.message || error || "").trim();
  if (!rawMessage) {
    return "Não foi possível procurar os pendrives e HDs conectados. Reconecte o dispositivo e clique em “Atualizar”.";
  }
  if (SIMPLE_LIST_PASSTHROUGH_PREFIXES.some((prefix) => rawMessage.startsWith(prefix))) {
    return rawMessage;
  }
  return "Não foi possível procurar os pendrives e HDs conectados. Tire e coloque o dispositivo em outra porta USB, aguarde alguns segundos e clique em “Atualizar”.";
}

/**
 * Converts a thrown preparation error into a simple, layman-friendly Portuguese
 * message without technical jargon. All technical specifics remain in logs and
 * telemetry.
 */
export function formatBadAvatarPrepareErrorForUser(
  error: unknown,
  driveRoot?: string,
): string {
  const rawMessage = String((error as { message?: unknown } | null)?.message || error || "").trim();
  const targetPhrase = formatTargetPhrase(driveRoot);

  if (!rawMessage) {
    return `Não foi possível concluir o preparo do seu ${targetPhrase}. Reconecte em outra porta USB e tente novamente.`;
  }

  if (SIMPLE_PREPARE_PASSTHROUGH_PREFIXES.some((prefix) => rawMessage.startsWith(prefix))) {
    return rawMessage;
  }

  // Must keep "Reparar (CHKDSK)" in the message so BadAvatarUsbPage renders the
  // one-click repair button, while stripping internal paths/POSIX error codes.
  if (rawMessage.startsWith("O sistema de arquivos do pendrive está danificado")) {
    return `O seu ${targetPhrase} está com erros de gravação (geralmente por ter sido desconectado ou desligado de repente). Clique no botão “Reparar (CHKDSK)” abaixo para corrigir sem apagar seus jogos e saves. Se não resolver, marque “Formatar antes” acima e tente novamente.`;
  }

  if (rawMessage.startsWith("O dispositivo contém a pasta oculta de sistema")) {
    return `Este ${targetPhrase} já foi configurado antes pelo próprio Xbox 360 e, desse jeito, o videogame não mostra o desbloqueio. Marque “Formatar antes” acima e clique em “Preparar pendrive/HD” (isso apaga tudo nesse dispositivo). Se quiser guardar saves importantes dele, apague o armazenamento pelo menu do Xbox 360 antes.`;
  }

  if (/^Formatação cancelada/i.test(rawMessage)) {
    return "A formatação foi cancelada porque você não autorizou a janela de permissão do Windows. Clique em “Preparar pendrive/HD” novamente e clique em “Sim” quando o Windows perguntar.";
  }

  if (POWERSHELL_FORMAT_TRACE_PATTERN.test(rawMessage)) {
    return formatPowerShellFormatError(rawMessage, targetPhrase);
  }

  if (/^Este dispositivo não funciona no Xbox 360|^A formatação terminou, mas o disco ficou num formato que o Xbox 360 não lê/i.test(rawMessage)) {
    return `Este ${targetPhrase} não é compatível com o Xbox 360, mesmo formatando. Desconecte ele e use outro pendrive ou HD.`;
  }

  if (/^O Xbox 360 não vai ler este dispositivo como está|^O dispositivo precisa estar em FAT32|^O destino precisa estar em FAT32/i.test(rawMessage)) {
    return `O seu ${targetPhrase} ainda precisa ser formatado para o Xbox 360 conseguir ler. Marque a caixinha “Formatar antes” acima e clique em “Preparar pendrive/HD” novamente. (Isso apaga os arquivos desse dispositivo.)`;
  }

  if (/^O dispositivo mudou desde a seleção/i.test(rawMessage)) {
    return "O dispositivo conectado mudou desde que esta tela foi aberta. Clique em “Preparar pendrive/HD” novamente para usar o dispositivo atual.";
  }

  if (/^O dispositivo USB não está acessível|^O dispositivo (?:formatado ainda )?não voltou|^A capacidade mudou após a formatação|^Não foi possível identificar uma única unidade USB/i.test(rawMessage)) {
    return `O seu ${targetPhrase} desconectou ou não respondeu direito. Tire e coloque ele em outra porta USB do computador e clique em “Preparar pendrive/HD” novamente. Se continuar falhando, teste com outro pendrive ou HD.`;
  }

  if (/Espaço livre insuficiente|não possui espaço suficiente|unidade de alocação/i.test(rawMessage)) {
    return `O seu ${targetPhrase} não tem espaço livre suficiente. Apague alguns arquivos dele ou use outro pendrive ou HD maior.`;
  }

  const errnoCode = extractErrnoCode(error, rawMessage);
  if (errnoCode) {
    const paths = extractErrorPaths(error, rawMessage);
    const onTarget = isTargetDriveError(paths, rawMessage, driveRoot);
    return formatErrnoMessage(errnoCode, targetPhrase, onTarget);
  }

  if (/^Falha na verificação física pós-gravação/i.test(rawMessage)) {
    return `Os arquivos do desbloqueio não permaneceram gravados corretamente na memória física do seu ${targetPhrase}. Isso indica pendrive falsificado (capacidade falsa), defeito na memória ou mau contato na porta USB. Tente em outra porta USB sem adaptadores ou use outro pendrive ou HD original.`;
  }

  if (/^Falha de verificação (?:ao copiar|após promover)|^Arquivo confirmado não confere:/i.test(rawMessage)) {
    return `Os arquivos não foram gravados corretamente no seu ${targetPhrase}, o que indica mau contato ou defeito no dispositivo. Tente em outra porta USB ou use outro pendrive ou HD.`;
  }

  if (
    /^Uma transação marcada como falha|^Transição de (?:transação|arquivo) inválida:|^Estado inesperado para|^Destino existente não é arquivo regular:|^O destino contém diretório inseguro:|diário transacional/i.test(
      rawMessage,
    )
  ) {
    return `Há arquivos incompletos de uma tentativa anterior no seu ${targetPhrase}. Marque a caixinha “Formatar antes” acima e clique em “Preparar pendrive/HD” novamente (isso apaga tudo nesse dispositivo).`;
  }

  if (/^O arquivo da versão ativa|^O manifesto da versão|^Os arquivos incorporados|^A versão .* não foi encontrada|^O pacote .* não traz/i.test(rawMessage)) {
    return "Um arquivo do próprio aplicativo está faltando ou danificado neste computador. Baixe e abra o Xbox 360 Companion novamente e tente de novo.";
  }

  if (/^Operação bloqueada:/i.test(rawMessage)) {
    return `Este ${targetPhrase} não pode ser preparado pelo programa por segurança (ou não é compatível). Escolha um pendrive ou HD externo conectado na porta USB e clique em “Atualizar”.`;
  }

  if (INTERNAL_PATH_LEAK_PATTERN.test(rawMessage) || /A raiz (?:do dispositivo|da migração)|tentativa de criar diretório|escaparia/i.test(rawMessage)) {
    return `Não foi possível gravar no seu ${targetPhrase}. Reconecte em outra porta USB, marque “Formatar antes” se necessário ou teste com outro pendrive ou HD.`;
  }

  if (hasTechnicalErrorLeak(rawMessage)) {
    return `Não foi possível concluir o preparo do seu ${targetPhrase}. Feche pastas abertas dele, conecte em outra porta USB e tente novamente.`;
  }

  return rawMessage;
}
