const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeIACookiePair } = require("../../services/iaCookie.js");

test("normaliza cookies Set-Cookie do Archive sem duplicar o nome", () => {
  assert.equal(
    normalizeIACookiePair(
      "logged-in-user",
      "logged-in-user=user%40example.com; expires=Wed, 01 Jan 2030 00:00:00 GMT; Path=/; Domain=.archive.org; Secure",
    ),
    "logged-in-user=user%40example.com",
  );

  assert.equal(
    normalizeIACookiePair(
      "logged-in-sig",
      "logged-in-sig=abc123==; Path=/; Domain=.archive.org; HttpOnly",
    ),
    "logged-in-sig=abc123==",
  );
});

test("aceita valores crus e monta o par nome=valor esperado", () => {
  assert.equal(
    normalizeIACookiePair("logged-in-user", "user%40example.com"),
    "logged-in-user=user%40example.com",
  );
});
