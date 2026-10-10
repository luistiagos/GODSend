/**
 * Decoding for the output of Windows command-line tools that write in the
 * system ANSI code page (ACP) when stdout is a pipe.
 *
 * `chkdsk` is one of them: on a pt-BR machine (ACP 1252, OEM 437) it writes
 * "você" as `76 6f 63 ea` — one byte per accented letter. Read as UTF-8, every
 * such byte becomes U+FFFD and the repair dialog showed "conclu�do". The OEM
 * page that `chcp` reports is not the one it uses, so the decoder follows the
 * ACP from the registry.
 */

import { execFile } from "child_process";
import { system32Exe } from "./windowsSystemExecutables";

const DEFAULT_ANSI_CODE_PAGE = 1252;

/** TextDecoder labels for the ANSI code pages that are not `windows-<cp>`. */
const DBCS_LABELS: Record<number, string> = {
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
};

/** Extracts the ACP from `reg query ...\Nls\CodePage /v ACP`; null when absent. */
export function parseAnsiCodePage(regOutput: string): number | null {
  const match = regOutput.match(/\bACP\s+REG_SZ\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** WHATWG TextDecoder label for a Windows ANSI code page. */
export function textDecoderLabelForCodePage(codePage: number | null): string {
  if (codePage === null) return "windows-1252";
  if (DBCS_LABELS[codePage]) return DBCS_LABELS[codePage];
  if (codePage === 874 || (codePage >= 1250 && codePage <= 1258)) return `windows-${codePage}`;
  return "windows-1252";
}

let cachedCodePage: Promise<number> | null = null;

/** The system ANSI code page, read once from the registry; 1252 when unreadable. */
export function windowsAnsiCodePage(): Promise<number> {
  if (process.platform !== "win32") return Promise.resolve(DEFAULT_ANSI_CODE_PAGE);
  if (!cachedCodePage) {
    cachedCodePage = new Promise((resolve) => {
      execFile(
        system32Exe("reg.exe", "reg.exe"),
        ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage", "/v", "ACP"],
        { windowsHide: true, timeout: 10_000 },
        (error, stdout) => {
          resolve((!error && parseAnsiCodePage(String(stdout))) || DEFAULT_ANSI_CODE_PAGE);
        },
      );
    });
  }
  return cachedCodePage;
}

/** A TextDecoder for `codePage`, falling back to windows-1252 if the runtime lacks the label. */
export function createAnsiDecoder(codePage: number | null): TextDecoder {
  try {
    return new TextDecoder(textDecoderLabelForCodePage(codePage));
  } catch {
    return new TextDecoder("windows-1252");
  }
}
