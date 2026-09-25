const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEVICE_STATE_BADGE,
  PREPARED_DEVICE_NOTICE,
  PREPARED_DEVICE_SUMMARY,
  PREPARED_DEVICE_TITLE,
  SKIP_SCREEN_TEXT,
} = require("../../services/preparedDeviceCopy.js");
const { canSkipPreparation } = require("../../services/preparedUsbDetection.js");

const STATES = ["sem-preparo", "jogos-apenas", "preparado-rgh", "preparado-bloqueado-lt"];

test("todo estado tem texto proprio, e nenhum fica sem titulo", () => {
  for (const state of STATES) {
    assert.equal(typeof PREPARED_DEVICE_NOTICE[state], "string", state);
    assert.ok(PREPARED_DEVICE_NOTICE[state].length > 0, state);
    assert.ok(PREPARED_DEVICE_TITLE[state].length > 0, state);
    assert.equal(typeof PREPARED_DEVICE_SUMMARY[state], "string", state);
  }
});

// A frase que causou o dano foi "Já existe um desbloqueio ou pastas de jogos ... Você pode pular a
// preparação", mostrada para um pendrive onde a preparação nunca tinha rodado.
test("so o estado com o perfil do exploit afirma que existe desbloqueio", () => {
  for (const state of STATES) {
    const texts = [
      PREPARED_DEVICE_NOTICE[state],
      PREPARED_DEVICE_TITLE[state],
      PREPARED_DEVICE_SUMMARY[state],
      DEVICE_STATE_BADGE[state]?.title || "",
      DEVICE_STATE_BADGE[state]?.detail || "",
    ].join(" ").toLowerCase();

    if (state === "preparado-bloqueado-lt") {
      assert.match(texts, /desbloqueio badavatar|perfil abadavatar/);
      continue;
    }
    assert.doesNotMatch(
      texts,
      /(?:já |ja |existe )?(?:um )?desbloqueio (?:badavatar|instalado|no pendrive)/,
      `${state} nao pode afirmar desbloqueio`,
    );
    assert.doesNotMatch(texts, /pode pular a prepara/, `${state} nao pode convidar a pular`);
  }
});

test("o pendrive preparado em RGH diz ao console travado ou LT o que fazer", () => {
  const texts = `${PREPARED_DEVICE_NOTICE["preparado-rgh"]} ${DEVICE_STATE_BADGE["preparado-rgh"].detail}`;
  assert.match(texts, /travado ou LT/);
  assert.match(texts, /Xbox Bloqueado ou LT/);
  assert.match(texts, /não tem o perfil do exploit/);
});

test("a tela de pular existe exatamente para os estados que podem pular", () => {
  const skippable = STATES.filter((state) => canSkipPreparation(state, true));
  assert.deepEqual(skippable.sort(), Object.keys(SKIP_SCREEN_TEXT).sort());
  for (const state of skippable) {
    assert.ok(SKIP_SCREEN_TEXT[state].title.length > 0, state);
    assert.match(SKIP_SCREEN_TEXT[state].detail, /pular a prepara/);
  }
});

test("o alerta amarelo cobre todo estado que nao pode pular, menos o dispositivo vazio", () => {
  assert.equal(DEVICE_STATE_BADGE["sem-preparo"], null);
  assert.equal(DEVICE_STATE_BADGE["jogos-apenas"].tone, "amber");
  assert.equal(DEVICE_STATE_BADGE["preparado-rgh"].tone, "amber");
  assert.equal(DEVICE_STATE_BADGE["preparado-bloqueado-lt"].tone, "green");
});
