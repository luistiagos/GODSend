const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildQueueSuccessFeedback,
} = require("../../infrastructure/browseQueueFeedback.js");

test("mensagem pos-enfileiramento de disco unico para pendrive orienta esperar Pronto na aba Fila sem termos tecnicos", () => {
  const fb = buildQueueSuccessFeedback({
    isMultiDisc: false,
    discCount: 1,
    destinationKind: "local",
  });

  assert.equal(fb.headline, "Adicionado à fila!");
  assert.match(fb.guidance, /aba Fila/i);
  assert.match(fb.guidance, /Pronto/);
  assert.match(fb.guidance, /desconectar o pendrive/i);
  assert.equal(fb.dismissLabel, "Entendi");
  assert.equal(fb.goToQueueLabel, "Ir para a Fila");

  const combined = `${fb.headline} ${fb.guidance} ${fb.dismissLabel} ${fb.goToQueueLabel}`;
  assert.doesNotMatch(combined, /triggered|status:|conclu[ií]do/i);
});

test("mensagem pos-enfileiramento multidisco informa quantidade de discos e orienta acompanhar na Fila", () => {
  const fb = buildQueueSuccessFeedback({
    isMultiDisc: true,
    discCount: 2,
    destinationKind: "local",
  });

  assert.equal(fb.headline, "Todos os 2 discos foram adicionados à fila!");
  assert.match(fb.guidance, /aba Fila/i);
  assert.match(fb.guidance, /Pronto/);
  assert.doesNotMatch(`${fb.headline} ${fb.guidance} ${fb.dismissLabel}`, /triggered|status:|conclu[ií]do/i);
});

test("mensagem pos-enfileiramento via FTP explica envio para o console na aba Fila", () => {
  const fb = buildQueueSuccessFeedback({
    isMultiDisc: false,
    discCount: 1,
    destinationKind: "ftp",
  });

  assert.equal(fb.headline, "Adicionado à fila!");
  assert.match(fb.guidance, /console/i);
  assert.match(fb.guidance, /aba Fila/i);
  assert.match(fb.guidance, /Pronto/);
  assert.doesNotMatch(fb.guidance, /pendrive/i);
  assert.doesNotMatch(`${fb.headline} ${fb.guidance} ${fb.dismissLabel}`, /triggered|status:|conclu[ií]do/i);
});

test("mensagem pos-enfileiramento via pasta no PC orienta acompanhar na aba Fila sem mencionar pendrive", () => {
  const fb = buildQueueSuccessFeedback({
    isMultiDisc: false,
    discCount: 1,
    destinationKind: "folder",
  });

  assert.equal(fb.headline, "Adicionado à fila!");
  assert.match(fb.guidance, /pasta escolhida/i);
  assert.match(fb.guidance, /aba Fila/i);
  assert.match(fb.guidance, /Pronto/);
  assert.doesNotMatch(fb.guidance, /pendrive/i);
  assert.doesNotMatch(`${fb.headline} ${fb.guidance} ${fb.dismissLabel}`, /triggered|status:|conclu[ií]do/i);
});

test("BrowsePage usa buildQueueSuccessFeedback e nao interpola result.status nem exibe botao Concluido no modal", () => {
  const browsePagePath = path.resolve(__dirname, "../../renderer/components/BrowsePage.tsx");
  const source = fs.readFileSync(browsePagePath, "utf-8");

  assert.match(source, /buildQueueSuccessFeedback/);
  assert.doesNotMatch(source, /Status:\s*\$\{result\.status\}/);
  assert.doesNotMatch(source, /Na fila!\s*Status:/);
  assert.doesNotMatch(source, />\s*Conclu[ií]do\s*</);
});
