const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseAnsiCodePage,
  textDecoderLabelForCodePage,
  windowsAnsiCodePage,
  createAnsiDecoder,
} = require("../../infrastructure/windowsAnsiCodePage.js");

test("parseAnsiCodePage lê o ACP da saída do reg query", () => {
  const out =
    "\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage\r\n    ACP    REG_SZ    1252\r\n\r\n";
  assert.equal(parseAnsiCodePage(out), 1252);
  assert.equal(parseAnsiCodePage("    OEMCP    REG_SZ    437"), null);
  assert.equal(parseAnsiCodePage(""), null);
});

test("textDecoderLabelForCodePage mapeia as páginas ANSI do Windows", () => {
  assert.equal(textDecoderLabelForCodePage(1252), "windows-1252");
  assert.equal(textDecoderLabelForCodePage(1251), "windows-1251");
  assert.equal(textDecoderLabelForCodePage(874), "windows-874");
  assert.equal(textDecoderLabelForCodePage(932), "shift_jis");
  assert.equal(textDecoderLabelForCodePage(936), "gbk");
  assert.equal(textDecoderLabelForCodePage(949), "euc-kr");
  assert.equal(textDecoderLabelForCodePage(950), "big5");
  assert.equal(textDecoderLabelForCodePage(65001), "windows-1252");
  assert.equal(textDecoderLabelForCodePage(null), "windows-1252");
});

test("createAnsiDecoder decodifica os bytes que o chkdsk grava em pt-BR (ACP 1252)", () => {
  // Bytes crus do chkdsk num Windows pt-BR: "0 por cento concluído." e "Número de Série ... é"
  const decoder = createAnsiDecoder(1252);
  assert.equal(
    decoder.decode(Buffer.from("0 por cento conclu\xeddo.", "latin1")),
    "0 por cento concluído.",
  );
  assert.equal(
    createAnsiDecoder(1252).decode(Buffer.from("O N\xfamero de S\xe9rie do Volume \xe9 8890-AB76", "latin1")),
    "O Número de Série do Volume é 8890-AB76",
  );
  // O que o código antigo fazia: UTF-8 transforma cada letra acentuada em U+FFFD.
  assert.equal(Buffer.from("conclu\xeddo", "latin1").toString(), "conclu�do");
});

test("createAnsiDecoder com stream:true junta caractere DBCS partido entre pedaços", () => {
  const decoder = createAnsiDecoder(932);
  const bytes = Buffer.from([0x82, 0xa0]); // "あ" em Shift_JIS
  const text =
    decoder.decode(bytes.subarray(0, 1), { stream: true }) +
    decoder.decode(bytes.subarray(1), { stream: true });
  assert.equal(text, "あ");
});

test("windowsAnsiCodePage devolve um número de página válido", { skip: process.platform !== "win32" }, async () => {
  const cp = await windowsAnsiCodePage();
  assert.equal(typeof cp, "number");
  assert.ok(cp > 0);
  assert.strictEqual(await windowsAnsiCodePage(), cp);
});
