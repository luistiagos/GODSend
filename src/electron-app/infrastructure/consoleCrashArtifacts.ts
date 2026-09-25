import { promises as fs } from "fs";
import path from "path";
import { hashFileSha256 } from "./secureComponentStaging";

// O banner "Fatal Crash Intercepted!" nomeia o manipulador, nao a excecao: ele so diz que algo
// estourou e foi interceptado. Os dois vestigios que respondem *o que* estourou ficam no proprio
// pendrive — o `Dumpfile` do DashLaunch (`crashlog.txt` na raiz, configurado em
// readyToPlayConfiguration.ts desde a 2.12.68) e os dumps do Aurora em `Aurora\Data\Logs`. Ate
// aqui eles so chegavam ao mantenedor se o usuario fosse instruido a procura-los a mao, e o bug
// ficou aberto por falta deles. Ver docs/bugs/closed/2026-09-05-fatal-crash-intercepted-pendrive-preparado.md.
const DASHLAUNCH_DUMP_PATH = "crashlog.txt";
const AURORA_LOG_DIRECTORY = "Aurora/Data/Logs";

// Só se lê um dispositivo que este aplicativo preparou. `crashlog.txt` nunca está no manifesto,
// então a conferência por hash jamais o descartaria: sem esta porta, um pendrive qualquer que
// trouxesse um arquivo com esse nome teria o conteúdo dele enviado ao serviço de telemetria. O
// reporte de erro nunca carregou arquivo do usuário vindo de volume externo, e não começa aqui.
// Aceita qualquer versão do marcador porque quem tem um dump para entregar é justamente quem
// preparou o pendrive numa versão anterior e só depois atualizou o aplicativo.
const MARKER_DIRECTORY = ".xbox-downloader";
const MARKER_PATTERN = /^ready-to-play-v\d+\.marker$/i;

// A telemetria corta cada log em 256 KB e aceita 20 entradas (infrastructure/telemetry.ts).
// Estes limites ficam abaixo disso porque a mensagem e o rabo do log da sessao vao junto.
const MAX_ARTIFACT_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024;
const MAX_ARTIFACTS = 12;

// `debug.log` e cronologico e cresce a cada boot: o que interessa e o fim. Um `.crash.log` ou
// `.callstack` descreve um evento unico e comeca pelo endereco e pelo modulo da excecao.
const TAIL_FILE_PATTERN = /^debug\.log(\.last)?$/i;

export interface BundledStateFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export interface ConsoleCrashArtifact {
  /** Caminho relativo à raiz do dispositivo, com barras normais. */
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  truncated: boolean;
  content: string;
}

export interface ConsoleCrashCollection {
  artifacts: ConsoleCrashArtifact[];
  /** Cópias do pacote ainda idênticas ao manifesto: estado do console de origem, não do usuário. */
  bundledCopiesSkipped: number;
  /** Arquivos presentes que não puderam ser lidos; diagnóstico nunca interrompe a preparação. */
  unreadable: string[];
}

interface Candidate {
  relativePath: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAtMs: number;
}

async function regularFileStat(fullPath: string) {
  const stat = await fs.lstat(fullPath);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  return stat;
}

/**
 * Confere cada ancestral, não só a folha. Um `mklink /J` numa pasta do dispositivo faria a
 * leitura cair no disco local e o conteúdo seguir para a telemetria — e a varredura roda antes
 * da recusa de sistemas de arquivos que não sejam FAT32, então um volume removível em NTFS
 * chega até aqui. `foreignConsoleState.ts`, que percorre a mesma árvore, recusa junction e link
 * pelo mesmo motivo.
 */
async function resolveRealDirectory(root: string, relativePath: string): Promise<string | null> {
  let current = root;
  for (const segment of ["", ...relativePath.split("/")]) {
    current = segment ? path.join(current, segment) : current;
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    } catch {
      return null;
    }
  }
  return current;
}

async function preparedByThisApp(root: string): Promise<boolean> {
  const directory = await resolveRealDirectory(root, MARKER_DIRECTORY);
  if (!directory) return false;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && MARKER_PATTERN.test(entry.name));
  } catch {
    return false;
  }
}

async function listCandidates(root: string, unreadable: string[]): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  const push = async (relativePath: string) => {
    const fullPath = path.join(root, ...relativePath.split("/"));
    try {
      const stat = await regularFileStat(fullPath);
      if (!stat) return;
      candidates.push({
        relativePath,
        fullPath,
        sizeBytes: stat.size,
        modifiedAtMs: stat.mtimeMs,
      });
    } catch (error: any) {
      if (error?.code !== "ENOENT") unreadable.push(relativePath);
    }
  };

  await push(DASHLAUNCH_DUMP_PATH);

  // Um pendrive que nunca chegou ao console não tem a pasta; isso não é uma falha.
  const logDirectory = await resolveRealDirectory(root, AURORA_LOG_DIRECTORY);
  if (!logDirectory) return candidates;
  let entries;
  try {
    entries = await fs.readdir(logDirectory, { withFileTypes: true });
  } catch {
    unreadable.push(AURORA_LOG_DIRECTORY);
    return candidates;
  }
  for (const entry of entries) {
    // withFileTypes marca link simbólico como não-arquivo, então links ficam de fora aqui.
    if (!entry.isFile()) continue;
    await push(`${AURORA_LOG_DIRECTORY}/${entry.name}`);
  }
  return candidates;
}

/**
 * Uma cópia byte a byte do manifesto é estado do console de origem replicado pelo pacote, não
 * uma reprodução do usuário. A migração da 2.12.74 tira essas cópias do local ativo, mas ela só
 * roda durante uma preparação e só move o que ainda confere — então a checagem é refeita aqui em
 * vez de assumir que a pasta de logs já esteja limpa.
 */
async function matchesBundle(
  candidate: Candidate,
  bundledBySize: Map<string, BundledStateFile>,
): Promise<boolean> {
  const bundled = bundledBySize.get(candidate.relativePath.toLowerCase());
  if (!bundled || bundled.sizeBytes !== candidate.sizeBytes) return false;
  return (await hashFileSha256(candidate.fullPath)) === bundled.sha256;
}

async function readCapped(
  candidate: Candidate,
  maxBytes: number,
): Promise<{ content: string; truncated: boolean }> {
  const length = Math.min(candidate.sizeBytes, maxBytes);
  if (length <= 0) return { content: "", truncated: candidate.sizeBytes > 0 };
  const fromTail = TAIL_FILE_PATTERN.test(path.basename(candidate.relativePath));
  const position = fromTail ? candidate.sizeBytes - length : 0;
  const handle = await fs.open(candidate.fullPath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return {
      content: buffer.subarray(0, bytesRead).toString("utf8"),
      truncated: length < candidate.sizeBytes,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Lê do pendrive preparado os registros que o console escreveu, sem alterá-los. Só devolve o que
 * é do usuário: cópias ainda idênticas ao pacote são contadas à parte, e um arquivo do pacote que
 * o console alterou (o `debug.log`, que recebe as linhas do hook a cada boot) deixa de conferir e
 * volta como artefato — é justamente ele que separa "a divergência existe" de "o console está
 * reiniciando sozinho".
 */
export async function collectConsoleCrashArtifacts(
  targetRoot: string,
  bundledFiles: readonly BundledStateFile[] = [],
): Promise<ConsoleCrashCollection> {
  if (!targetRoot || !path.isAbsolute(targetRoot)) {
    throw new Error("A leitura dos registros de falha exige a raiz absoluta do dispositivo.");
  }
  const root = path.resolve(targetRoot);
  const bundledByPath = new Map<string, BundledStateFile>();
  for (const file of bundledFiles) {
    if (!file?.path || !/^[a-f0-9]{64}$/.test(file?.sha256 || "")) continue;
    bundledByPath.set(file.path.toLowerCase(), file);
  }

  const unreadable: string[] = [];
  if (!(await preparedByThisApp(root))) {
    return { artifacts: [], bundledCopiesSkipped: 0, unreadable };
  }
  const candidates = await listCandidates(root, unreadable);
  // O dump da reprodução mais recente é o que importa; os antigos entram só se couberem.
  candidates.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);

  const artifacts: ConsoleCrashArtifact[] = [];
  let bundledCopiesSkipped = 0;
  let remainingBytes = MAX_TOTAL_BYTES;

  for (const candidate of candidates) {
    if (artifacts.length >= MAX_ARTIFACTS || remainingBytes <= 0) break;
    try {
      if (await matchesBundle(candidate, bundledByPath)) {
        bundledCopiesSkipped += 1;
        continue;
      }
      const { content, truncated } = await readCapped(
        candidate,
        Math.min(MAX_ARTIFACT_BYTES, remainingBytes),
      );
      remainingBytes -= Buffer.byteLength(content, "utf8");
      artifacts.push({
        path: candidate.relativePath,
        sizeBytes: candidate.sizeBytes,
        modifiedAt: new Date(candidate.modifiedAtMs).toISOString(),
        truncated,
        content,
      });
    } catch {
      unreadable.push(candidate.relativePath);
    }
  }

  return { artifacts, bundledCopiesSkipped, unreadable };
}

/** Uma linha por artefato, para o log da sessão e para a mensagem da telemetria. */
export function describeConsoleCrashArtifacts(collection: ConsoleCrashCollection): string {
  return collection.artifacts
    .map((artifact) =>
      `${artifact.path} (${artifact.sizeBytes} bytes, ${artifact.modifiedAt}` +
      `${artifact.truncated ? ", truncado" : ""})`)
    .join("; ");
}
