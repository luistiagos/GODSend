import { promises as fs } from "fs";
import path from "path";

/**
 * O recibo do preparo: modo, data, versão do aplicativo, release do pacote e o layout do disco que
 * o portão conferiu. Sem ele, nem o app,
 * nem o suporte, nem o agente de IA conseguem responder **como** um pendrive foi preparado — o
 * marcador `ready-to-play-v<N>.marker` guarda uma linha e mais nada.
 *
 * ⚠️ O recibo é gravado **fora** da escrita transacional, depois que ela termina, e é por isso que
 * ele existe como arquivo próprio em vez de virar conteúdo do marcador. `buildTransactionalWritePlan`
 * deriva `planHash` do conteúdo de cada entrada, enquanto o `transactionId` vem de
 * `bundleSha256 + fingerprint + scope`; ao retomar uma preparação interrompida,
 * `verifyTransactionJournalAgainstPlan` compara os dois e lança "O diário transacional não pertence
 * ao plano de escrita informado". Qualquer byte volátil dentro do plano — um timestamp, a versão do
 * app — quebraria toda retomada com esse erro incompreensível.
 *
 * Verdade de campo continua sendo o que está gravado no dispositivo (o perfil do exploit existe ou
 * não, ver `services/preparedDeviceState.ts`); o recibo é a história, para quem atende o cliente.
 */
export const PREPARATION_RECEIPT_PATH = ".xbox-downloader/preparo.json";

export type PreparationMode = "bloqueado-lt" | "rgh";

/**
 * O layout que o portão `requireXboxReadableLayout` conferiu. Quando o Xbox mostra "Não Formatado"
 * num pendrive que o app declarou pronto, é isto que o suporte precisa ler no próprio dispositivo,
 * sem pedir PowerShell ao cliente ([[badavatar-dispositivo-preparado-aparece-como-nao-formatado-no-xbox-360_2026-10-08T17-09]]).
 * Sem serial: ele identifica o aparelho do cliente.
 */
export interface PreparationDiskLayout {
  verdict: "ok" | "unknown";
  formatted: boolean;
  partitionStyle: string;
  partitionCount: number;
  mbrType: number;
  logicalSectorSize: number;
  physicalSectorSize: number;
  fileSystem: string;
  partitionSizeBytes: number;
  allocationUnitBytes: number;
  model: string;
  manufacturer: string;
}

export interface PreparationReceipt {
  schemaVersion: 1;
  mode: PreparationMode;
  preparedAt: string;
  appVersion: string;
  release: string;
  readyToPlayVersion: string;
  diskLayout?: PreparationDiskLayout;
}

export function buildPreparationReceipt(fields: {
  isRghOnly: boolean;
  appVersion: string;
  release: string;
  readyToPlayVersion: string;
  preparedAt?: Date;
  diskLayout?: PreparationDiskLayout;
}): PreparationReceipt {
  return {
    schemaVersion: 1,
    mode: fields.isRghOnly ? "rgh" : "bloqueado-lt",
    preparedAt: (fields.preparedAt || new Date()).toISOString(),
    appVersion: fields.appVersion,
    release: fields.release,
    readyToPlayVersion: fields.readyToPlayVersion,
    ...(fields.diskLayout ? { diskLayout: fields.diskLayout } : {}),
  };
}

export async function writePreparationReceipt(
  driveRoot: string,
  receipt: PreparationReceipt,
): Promise<string> {
  const segments = PREPARATION_RECEIPT_PATH.split("/");
  const destination = path.join(driveRoot, ...segments);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `${JSON.stringify(receipt, null, 2)}\r\n`, "utf8");
  return destination;
}
