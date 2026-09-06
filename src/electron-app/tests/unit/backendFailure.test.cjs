const test = require("node:test");
const assert = require("node:assert/strict");

const {
  backendFailureReason,
  errorMessage,
} = require("../../infrastructure/backendFailure.js");

// O backend Go sinaliza falha com jsonError(): status 4xx/5xx e um corpo
// {"state":"Error","message":...}. O cliente antigo só olhava a chave `error`,
// então toda recusa do backend virava um "sucesso" silencioso na fila.
test("reconhece a recusa do backend Go (state/message) como falha", () => {
  assert.equal(
    backendFailureReason({
      status: 409,
      body: '{"state":"Error","message":"O dispositivo local nao esta pronto ou foi desconectado: acesso negado"}',
    }),
    "O dispositivo local nao esta pronto ou foi desconectado: acesso negado",
  );

  assert.equal(
    backendFailureReason({
      status: 422,
      body: '{"state":"Error","message":"Watch Dogs requer combinar os arquivos installation1/installation2"}',
    }),
    "Watch Dogs requer combinar os arquivos installation1/installation2",
  );
});

test("reconhece a chave error usada por algumas rotas", () => {
  assert.equal(
    backendFailureReason({ status: 200, body: '{"ok":false,"error":"transferencia ja em andamento"}' }),
    "transferencia ja em andamento",
  );
});

test("trata as respostas *_unavailable como falha, com o motivo do servidor", () => {
  assert.equal(
    backendFailureReason({
      status: 200,
      body: '{"status":"local_unavailable","message":"Add the game ISO to your Transfer folder, then queue again."}',
    }),
    "Add the game ISO to your Transfer folder, then queue again.",
  );

  // Sem message, ainda assim explica em vez de reportar sucesso.
  assert.equal(
    backendFailureReason({ status: 200, body: '{"status":"hf_unavailable"}' }),
    'o servidor respondeu "hf_unavailable"',
  );
});

test("aceita as respostas de sucesso reais de /register e /trigger", () => {
  assert.equal(
    backendFailureReason({ status: 200, body: '{"status":"registered","mode":"local","local_root":"E:/"}' }),
    null,
  );
  assert.equal(
    backendFailureReason({ status: 200, body: '{"status":"triggered","source":"unified"}' }),
    null,
  );
  assert.equal(backendFailureReason({ status: 200, body: '{"status":"already_ready"}' }), null);
  assert.equal(backendFailureReason({ status: 200, body: '{"status":"already_queued"}' }), null);
});

test("nunca devolve falha sem explicação", () => {
  // Corpo vazio, HTML de outro serviço na porta, 500 sem corpo: todos precisam
  // de um motivo legível — era daqui que saía o "Erro desconhecido".
  for (const res of [
    { status: 200, body: "" },
    { status: 200, body: "<html><body>404 Not Found</body></html>" },
    { status: 500, body: "" },
    { status: 404, body: "not found" },
  ]) {
    const reason = backendFailureReason(res);
    assert.ok(reason && reason.trim().length > 0, `sem motivo para ${JSON.stringify(res)}`);
  }
});

test("errorMessage devolve texto não vazio para qualquer valor lançado", () => {
  assert.equal(errorMessage(new Error("connect ECONNREFUSED 127.0.0.1:8080")), "connect ECONNREFUSED 127.0.0.1:8080");
  assert.equal(errorMessage("falha crua"), "falha crua");
  assert.equal(errorMessage({ code: "ENOENT" }), "ENOENT");
  assert.equal(errorMessage({ message: "detalhe" }), "detalhe");

  for (const value of [new Error(""), undefined, null, "", 0, {}]) {
    const text = errorMessage(value);
    assert.ok(text && text.trim().length > 0, `sem texto para ${String(value)}`);
  }
});
