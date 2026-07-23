const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AdminAuth } = require("../server/auth");

test("管理员会话跨服务重启保持有效，主动退出后失效", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qingying-auth-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  let setCookie = "";
  const response = { setHeader: (name, value) => { if (name === "Set-Cookie") setCookie = value; } };
  const firstAuth = new AdminAuth({ dataDir });
  firstAuth.createSession(response);

  assert.match(setCookie, /Max-Age=315360000/);
  const cookie = setCookie.split(";")[0];
  const request = { headers: { cookie } };
  const restartedAuth = new AdminAuth({ dataDir });
  assert.equal(restartedAuth.isAuthenticated(request), true);

  restartedAuth.destroySession(request, response);
  assert.equal(new AdminAuth({ dataDir }).isAuthenticated(request), false);
  assert.match(setCookie, /Max-Age=0/);
});
