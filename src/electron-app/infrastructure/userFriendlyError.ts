/**
 * Translates raw technical errors (OS/errno codes, HTTP/network failures,
 * Go backend errors, JSON/IPC errors, and English messages) into clear,
 * layman-friendly Portuguese messages with concrete next steps.
 *
 * Kept free of Electron/Node imports so both the main process (IPC handlers)
 * and the React renderer can share the exact same translation rules.
 *
 * IMPORTANT: Always log and report the original raw technical error to
 * serverLog/telemetry BEFORE calling formatErrorForUser().
 */

export type UserErrorArea =
  | "browse"
  | "queue"
  | "ftp"
  | "library"
  | "assets"
  | "content"
  | "saves"
  | "tools-iso"
  | "drive-maintenance"
  | "update"
  | "config"
  | "ia-login"
  | "local-files"
  | "generic";

export interface UserErrorContext {
  area?: UserErrorArea;
  gameName?: string;
  driveRoot?: string;
  isLocal?: boolean;
  isFolder?: boolean;
}

const TECHNICAL_LEAK_PATTERN = new RegExp(
  [
    "\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|EPIPE|EOF)\\b",
    "\\b(?:ENOENT|EACCES|EPERM|EBUSY|ENOSPC|EROFS|EIO|ENODEV|ENXIO|EINVAL|EEXIST|EISDIR|ENOTDIR)\\b",
    "\\b(?:UNKNOWN|TypeError|SyntaxError|ReferenceError|RangeError|AbortError|Error)\\s*:",
    "\\bHTTP\\s*\\d{3}\\b",
    "https?:\\/\\/127\\.0\\.0\\.1",
    "127\\.0\\.0\\.1:\\d+",
    "localhost:\\d+",
    "\\.xbox-downloader",
    "[A-Za-z]:\\\\[^\\s]+",
    "\\bdial\\s+tcp\\b",
    "\\bGetLastError\\b",
    "\\bSystem\\.Management\\.Automation\\b",
    "\\bFullyQualifiedErrorId\\b",
    "\\bCategoryInfo\\b",
    "\\bIPC\\s+channel\\b",
    "\\bRXEA\\b",
    "\\bjson\\b",
    "\\bparse\\s+error\\b",
    "\\btitleId\\b",
    "\\bgameDataDir\\b",
    "\\bassetType\\b",
    "\\blocal_root\\b",
    "\\bstack\\b",
    "\\bunknown\\s+error\\b",
    "\\btimeout\\b",
    "\\b(?:failed|failure|missing|invalid|unexpected|unknown|unavailable|unreachable|denied|refused|forbidden|unauthorized|required|corrupt(?:ed)?|empty|broken|mismatch)\\b",
    "\\b(?:cannot|could\\s+not|not\\s+found|no\\s+such\\s+(?:file|host)|connection\\s+(?:refused|reset|timed\\s+out)|being\\s+used\\s+by)\\b",
    "\\b(?:catalog|server|backend|endpoint|titleId|gameDataDir|assetType|local_root|stack|parse\\s+error|timeout|time\\s*out)\\b",
    "\\b(?:use\\s+(?:post|get)|method\\s+not\\s+allowed|internal\\s+server\\s+error|servidor\\s+local)\\b",
    "\\b(?:sha-?256|wrap-?around|tabela\\s+fat|dirty\\s+bit)\\b",
    "\\{\\s*\"",
  ].join("|"),
  "i",
);

export function extractRawErrorMessage(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error && error.message) return error.message.trim();
  if (error && typeof error === "object") {
    const obj = error as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
    if (typeof obj.error === "string" && obj.error.trim()) return obj.error.trim();
    if (typeof obj.code === "string" && obj.code.trim()) return obj.code.trim();
  }
  return "";
}

function extractDriveLabel(driveRoot?: string): string {
  const m = String(driveRoot || "").trim().match(/^([A-Za-z]):/);
  return m ? ` (${m[1].toUpperCase()}:)` : "";
}

function defaultFallbackForArea(area: UserErrorArea, ctx?: UserErrorContext): string {
  const drive = extractDriveLabel(ctx?.driveRoot);
  switch (area) {
    case "browse":
      if (ctx?.isLocal) {
        return "Não foi possível carregar os jogos salvos no computador ou no pendrive. Confira se o pendrive está bem conectado, pause o antivírus se necessário e clique em “Tentar de novo”.";
      }
      return "Não foi possível carregar a lista de jogos agora. Verifique se sua internet está funcionando e clique em “Tentar de novo”. Se o problema continuar, feche e abra o programa novamente.";
    case "queue":
      return "Não foi possível concluir este download ou envio agora. Verifique sua internet (ou a conexão com o pendrive/Xbox), confira se há espaço livre e clique em tentar novamente.";
    case "ftp":
      return "Não foi possível concluir a operação no seu Xbox 360 pela rede. Confira se o videogame está ligado com a Aurora aberta, conectado na mesma rede do computador, e tente novamente.";
    case "library":
      return "Não foi possível carregar ou atualizar as informações da biblioteca do Xbox 360 agora. Confira se o videogame está ligado na Aurora, na mesma rede do computador, e tente novamente.";
    case "assets":
      return "Não foi possível carregar ou enviar a imagem para o Xbox 360. Verifique se o videogame está ligado na Aurora, conectado na mesma rede, e tente escolher outra imagem se necessário.";
    case "content":
      return "Não foi possível buscar ou instalar este conteúdo adicional no Xbox 360. Confira sua internet, veja se o videogame está ligado na Aurora na mesma rede, e tente novamente.";
    case "saves":
      return "Não foi possível acessar ou copiar os saves do Xbox 360 agora. Confira se o videogame está ligado na Aurora, conectado na mesma rede do computador, e tente novamente.";
    case "tools-iso":
      return "Não foi possível converter este arquivo de jogo. Confira se o arquivo não está aberto em outro programa, verifique se há espaço livre no disco e tente novamente.";
    case "drive-maintenance":
      return `Não foi possível concluir a verificação do seu pendrive ou HD${drive}. Feche todas as pastas abertas dele, desconecte e conecte em outra porta USB e tente novamente.`;
    case "update":
      return "Não foi possível verificar ou concluir a atualização agora. Confira sua conexão com a internet e tente novamente mais tarde.";
    case "config":
      return "Não foi possível salvar ou aplicar esta configuração agora. Feche outros programas abertos, confira as permissões da pasta e tente novamente.";
    case "ia-login":
      return "Não foi possível entrar na sua conta do Internet Archive agora. Confira seu e-mail e senha, verifique sua conexão com a internet e tente novamente.";
    case "local-files":
      return `Não foi possível acessar a pasta ou o arquivo no computador${drive}. Feche outras janelas que estejam usando essa pasta e tente novamente.`;
    default:
      return "Não foi possível concluir esta ação agora. Aguarde alguns segundos e tente novamente. Se o problema continuar, feche e abra o programa novamente.";
  }
}

/**
 * Checks whether a text looks like it contains technical jargon, stack details,
 * raw OS/network error codes, internal paths, URLs, JSON, or English error text.
 */
export function hasTechnicalErrorLeak(message: string): boolean {
  if (!message || !message.trim()) return true;
  return TECHNICAL_LEAK_PATTERN.test(message);
}

/**
 * Translates any error into a clear, layman-friendly Portuguese message that
 * tells the user exactly what happened and what to do next.
 */
export function formatErrorForUser(error: unknown, ctx: UserErrorContext = {}): string {
  const area: UserErrorArea = ctx.area || "generic";
  const raw = extractRawErrorMessage(error);
  const drive = extractDriveLabel(ctx.driveRoot);

  if (!raw) {
    return defaultFallbackForArea(area, ctx);
  }

  // 1. Missing or unconfigured Xbox IP
  if (/no xbox ip configured|xbox ip address is required|missing ip parameter|missing xbox_ip|no xbox registered/i.test(raw)) {
    return "O endereço do seu Xbox 360 ainda não foi configurado. Vá em “Configurações”, informe o IP do videogame (ou faça a busca automática) e tente novamente.";
  }

  // 2. Invalid Xbox IP / subnet
  if (/invalid ip address/i.test(raw)) {
    return "O endereço IP digitado para o Xbox 360 não é válido. Confira os números do IP mostrados na tela da Aurora e digite novamente (por exemplo: 192.168.1.50).";
  }
  if (/invalid subnet/i.test(raw)) {
    return "O começo do endereço da rede não está correto. Digite apenas os três primeiros blocos de números (por exemplo: 192.168.1) e tente novamente.";
  }
  if (/local ipv4|local network ip unavailable/i.test(raw)) {
    return "Não foi possível identificar a conexão de rede deste computador. Confira se o cabo de rede ou o Wi-Fi está conectado e tente novamente.";
  }

  // 3. Same source & destination drive when moving a game
  if (/source and destination drive are the same/i.test(raw)) {
    return "A unidade de origem e a unidade de destino são a mesma. Escolha outro disco ou pendrive conectado no Xbox 360 para mover o jogo.";
  }
  if (/missing game or target drive|no source drive or directory info/i.test(raw)) {
    return "Não foi possível identificar a pasta deste jogo no Xbox 360. Atualize a biblioteca do console e tente novamente.";
  }

  // 4. Local backend / IPC unavailable or timed out (PC app still starting or stopped)
  if (
    /ECONNREFUSED|IPC channel|IPC local|servidor local.*(?:nao respondeu|não respondeu|contatar)|contatar o servidor local|resposta inesperada do servidor local|respondeu com um corpo vazio|not running|backend returned invalid/i.test(
      raw,
    ) ||
    (/^timeout$/i.test(raw) && area !== "ftp" && area !== "saves" && area !== "library")
  ) {
    if (area === "browse") {
      return "O programa ainda está terminando de carregar ou perdeu a conexão interna. Aguarde alguns segundos e clique em “Tentar de novo”. Se continuar assim, feche e abra o aplicativo novamente.";
    }
    if (area === "tools-iso") {
      return "O programa ainda está carregando ou demorou para responder. Aguarde alguns segundos e tente converter novamente. Se continuar assim, feche e abra o aplicativo novamente.";
    }
    return "O programa ainda está terminando de iniciar ou demorou para responder. Aguarde alguns segundos e tente novamente. Se continuar assim, feche e abra o aplicativo novamente.";
  }

  // 5. Area-specific translations before generic errno/network matches
  if (area === "ia-login") {
    if (/invalid|incorrect|password|email|senha|401|403|unauthorized|credentials|login/i.test(raw)) {
      return "E-mail ou senha do Internet Archive incorretos. Confira seus dados de acesso do site archive.org e tente novamente.";
    }
    return "Não foi possível entrar na sua conta do Internet Archive agora. Verifique sua conexão com a internet e tente novamente.";
  }

  if (area === "update") {
    if (/cópia temporária/i.test(raw)) {
      return "Este aplicativo foi aberto de uma pasta temporária e não consegue se atualizar sozinho. Feche o programa e abra o arquivo original que você baixou, ou baixe a nova versão manualmente.";
    }
    if (/copy-failed|script de substituição|Access is denied|EPERM|EBUSY/i.test(raw)) {
      return "O Windows não deixou substituir o arquivo porque o aplicativo ainda estava em uso. Feche o programa pelo ícone perto do relógio e tente atualizar novamente, ou siga os passos manuais abaixo.";
    }
    if (/sha-?256|integridade/i.test(raw)) {
      return "O arquivo de atualização veio incompleto ou corrompido. Clique para baixar novamente ou faça o download manual pelo site.";
    }
    if (/cancelado/i.test(raw)) {
      return "O download da atualização foi cancelado.";
    }
    if (/não encontrado/i.test(raw) && !/ENOENT/i.test(raw)) {
      return "O arquivo da atualização baixada não foi encontrado. Clique em verificar atualizações para baixar novamente.";
    }
    return "Não foi possível verificar ou baixar a atualização agora. Confira sua conexão com a internet e tente novamente mais tarde.";
  }

  if (area === "assets") {
    if (/invalid url/i.test(raw)) {
      return "O endereço da imagem digitado não é válido. Copie um link completo começando com http:// ou https:// e tente novamente.";
    }
    if (/could not fetch image/i.test(raw)) {
      return "Não foi possível baixar essa imagem pela internet. Tente outro link ou escolha uma imagem salva no seu computador.";
    }
    if (/no valid image data/i.test(raw)) {
      return "O arquivo escolhido não é uma imagem válida. Escolha uma imagem JPG ou PNG do seu computador e tente novamente.";
    }
    if (/rxea|encoding failed|decode/i.test(raw)) {
      return "Não foi possível transformar essa imagem para o formato aceito pelo Xbox 360. Escolha outra imagem (JPG ou PNG) e tente novamente.";
    }
    if (/titleId|gameDataDir|assetType|slot/i.test(raw)) {
      return "Não foi possível identificar este jogo para trocar a imagem. Atualize a lista de jogos do Xbox e tente novamente.";
    }
  }

  if (area === "tools-iso") {
    if (/no default\.xex/i.test(raw)) {
      return "Este arquivo não pode ser extraído como pasta XEX. Escolha o formato GOD para convertê-lo e tente novamente.";
    }
    if (/Probe failed|invalid iso|xdvdfs/i.test(raw)) {
      return "Este arquivo não parece ser uma imagem ISO válida de Xbox 360 ou está danificado. Confira se o download do arquivo foi concluído por completo.";
    }
    if (/ISO2GOD failed|ISO2XEX failed/i.test(raw)) {
      return "Não foi possível converter este arquivo de jogo. Confira se há bastante espaço livre no disco e se o arquivo ISO não está corrompido.";
    }
  }

  // 6. Xbox 360 FTP / Network errors
  if (
    /Xbox FTP busy/i.test(raw)
  ) {
    return "O Xbox 360 está ocupado enviando ou recebendo outro jogo no momento. Aguarde a transferência terminar e tente novamente.";
  }
  if (/530|authentication|login incorrect|credenciais/i.test(raw)) {
    return "O Xbox 360 recusou o usuário ou a senha da conexão. Confira na Aurora do console e em “Configurações” se o usuário e a senha estão corretos.";
  }
  if (
    /FTP connect|Xbox unreachable|FTP test failed|FTP download failed|Download content\.db failed|Download settings\.db failed|dial tcp|EHOSTUNREACH|ENETUNREACH/i.test(
      raw,
    )
  ) {
    return "Não foi possível se conectar ao Xbox 360. Confira se o console está ligado na Aurora, conectado na mesma rede (Wi-Fi ou cabo) do computador e com o IP certo em “Configurações”.";
  }
  if (/FTP upload|Upload failed|FTP:/i.test(raw)) {
    return "A transferência para o Xbox 360 foi interrompida pela rede. Confira se o console continua ligado na Aurora com espaço livre suficiente e tente novamente.";
  }

  // 7. Catalog / Download / Source errors
  if (/No ISO in Transfer folder|local_unavailable|Add the game ISO/i.test(raw)) {
    return "O arquivo deste jogo (.iso) não foi encontrado na pasta Transfer do computador. Coloque o arquivo do jogo lá dentro e tente novamente.";
  }
  if (/Unknown ROM system/i.test(raw) && area === "browse") {
    return "Não foi possível carregar a lista desta plataforma agora. Escolha outro console ou clique em “Tentar de novo”.";
  }
  if (/catalog\s+unavailable|catalog_unavailable/i.test(raw)) {
    return "A lista de jogos está temporariamente indisponível. Verifique sua conexão com a internet e clique em “Tentar de novo”.";
  }
  if (/Not found in Minerva|Not found in Hugging Face|jogo nao encontrado no catalogo|hf_unavailable|minerva_unavailable|ROM not found|Unknown ROM system/i.test(raw)) {
    return "Este jogo não está disponível para download neste catálogo no momento. Tente outra versão do jogo na lista ou tente novamente mais tarde.";
  }
  if (/HTTP 401|HTTP 403|iaCookie|login required|authorization/i.test(raw)) {
    return "O servidor de download pediu login ou bloqueou o acesso agora. Entre com sua conta gratuita do Internet Archive em “Configurações” e tente novamente.";
  }
  if (/Download failed|no such host|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|muito lento|estagnado|stall|HTTP 5\d\d|HTTP 4\d\d/i.test(raw)) {
    if (area === "browse") {
      return "Não foi possível carregar a lista de jogos pela internet agora. Verifique sua conexão e clique em “Tentar de novo”.";
    }
    return "O download pela internet falhou ou caiu no meio. Confira se sua internet está estável, pause VPN ou antivírus se estiver usando, e clique em tentar novamente.";
  }
  if (/Extract failed|corrupt|invalid archive|7z|rar|unexpected EOF/i.test(raw)) {
    return "O arquivo baixado veio incompleto ou danificado e não pôde ser aberto. Clique em tentar novamente para o programa baixar uma cópia nova.";
  }

  // 8. Storage, Disk space, FAT32, Permissions, Disconnected drive
  if (/dispositivo local nao esta pronto|dispositivo local não está pronto|local_root|não está pronto ou foi desconectado/i.test(raw)) {
    if (ctx.isFolder) {
      return "A pasta escolhida no computador não está acessível no momento. Escolha outra pasta (como Downloads ou Documentos) e tente novamente.";
    }
    return `O pendrive ou HD${drive} não está pronto ou foi desconectado. Desconecte e conecte ele em outra porta USB do computador e tente novamente.`;
  }
  if (/excede o limite.*4 GB|limite maximo de 4 GB|incompativel com pendrive FAT32|4 GB/i.test(raw)) {
    if (ctx.isFolder) {
      return "Este jogo possui um arquivo grande demais para o formato FAT32 da unidade onde a pasta está. Escolha outro disco no computador ou instale no formato GOD.";
    }
    return "Este jogo possui um arquivo grande demais para caber neste formato de pendrive. Escolha a instalação no formato GOD (ou outra versão do jogo) e tente novamente.";
  }
  if (/espaço insuficiente no destino|ENOSPC|no space left|not enough space/i.test(raw)) {
    if (/disco do PC|armazenamento temporario|Temp/i.test(raw)) {
      return "O disco do seu computador ficou sem espaço livre suficiente para preparar o jogo. Apague alguns arquivos do computador para liberar espaço e tente novamente.";
    }
    if (ctx.isFolder) {
      return `Não há espaço livre suficiente no disco${drive} da pasta escolhida. Libere espaço no computador ou escolha uma pasta em outro disco e tente novamente.`;
    }
    return `Não há espaço livre suficiente no pendrive ou HD${drive}. Apague alguns arquivos dele ou use um dispositivo com mais espaço e tente novamente.`;
  }
  if (/EROFS|read-only/i.test(raw)) {
    if (ctx.isFolder) {
      return "A pasta escolhida está protegida somente para leitura. Escolha outra pasta (como Downloads ou Documentos) e tente novamente.";
    }
    return `O pendrive ou HD${drive} está travado contra gravação. Verifique se há alguma trava física nele e destrave, ou tente com outro pendrive ou HD.`;
  }
  if (/EPERM|EACCES|EBUSY|Access is denied|acesso negado|being used by another process|sendo usado por outro processo/i.test(raw)) {
    if (ctx.isFolder) {
      return "O Windows não permitiu gravar na pasta escolhida (pasta protegida ou em uso). Tente criar uma pasta dentro de Downloads ou Documentos e tente novamente.";
    }
    return `O Windows ou o antivírus bloqueou o acesso aos arquivos${drive ? ` no dispositivo${drive}` : ""}. Feche qualquer pasta aberta desse dispositivo, pause o antivírus por alguns minutos e tente novamente.`;
  }
  if (/ENOENT|ENODEV|ENXIO|EIO/i.test(raw)) {
    if (area === "local-files" || area === "drive-maintenance") {
      return `Não foi possível acessar a pasta ou o dispositivo${drive}. Confira se o pendrive ou HD está conectado firme em uma porta USB e tente novamente.`;
    }
    return `Um arquivo ou o dispositivo${drive} deixou de responder no meio da operação. Confira a conexão USB (tente outra porta) e tente novamente.`;
  }

  // 9. Multi-disc / incomplete release / already friendly Portuguese messages
  if (!hasTechnicalErrorLeak(raw)) {
    return raw;
  }

  // 10. Safety net: never let raw technical text reach the user!
  return defaultFallbackForArea(area, ctx);
}
