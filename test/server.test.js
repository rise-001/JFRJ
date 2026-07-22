const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAppServer, parseModelContent } = require("../server/server");
const { SystemSettingsStore } = require("../server/system-store");

function createTestConfig(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qingying-test-"));
  const config = {
    port: 0,
    apiUrl: "https://example.test/v1/chat/completions",
    apiKey: "",
    model: "vision-test",
    timeoutMs: 1000,
    maxImageBytes: 1024,
    maxBodyBytes: 4096,
    jsonMode: true,
    dataDir,
    configSecret: "test-only-secret",
    adminPassword: "",
    sessionHours: 12,
    cookieSecure: false,
    ...overrides
  };
  return { config, settingsStore: new SystemSettingsStore(config) };
}

function cleanupServer(t, server, dataDir) {
  t.after(() => {
    server.close();
    server.weightStore.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
}

async function login(baseUrl, password = "secure-pass-123") {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

test("解析标准 JSON、代码块和斤单位", () => {
  assert.deepEqual(parseModelContent('{"weightKg":65.4,"confidence":0.98}'), {
    weight: 65.4,
    unit: "kg",
    confidence: 98
  });
  assert.deepEqual(parseModelContent('```json\n{"weight":130.8,"unit":"斤","confidence":95}\n```'), {
    weight: 65.4,
    unit: "kg",
    confidence: 95
  });
  assert.deepEqual(parseModelContent("104.7"), {
    weight: 52.4,
    unit: "kg",
    confidence: 90
  });
  assert.deepEqual(parseModelContent("209.4 斤"), {
    weight: 104.7,
    unit: "kg",
    confidence: 90
  });
  assert.deepEqual(parseModelContent('"104.7 kg"'), {
    weight: 104.7,
    unit: "kg",
    confidence: 90
  });
  assert.throws(() => parseModelContent('{"weightKg":65.4,"confidence":0.84}'), /可信度不足/);
});

test("识别接口转发图片并规范化模型结果", async (t) => {
  let upstreamRequest;
  const { config, settingsStore } = createTestConfig(t, { apiKey: "test-key", adminPassword: "secure-pass-123" });
  const server = createAppServer({
    config,
    settingsStore,
    fetchImpl: async (url, init) => {
      upstreamRequest = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"weightKg":65.4,"confidence":0.97}' } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cookie = await login(baseUrl);
  const response = await fetch(`${baseUrl}/api/recognize-weight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" })
  });

  assert.equal(response.status, 200);
  const recognition = await response.json();
  assert.deepEqual({ weight: recognition.weight, unit: recognition.unit, confidence: recognition.confidence, model: recognition.model }, {
    weight: 65.4,
    unit: "kg",
    confidence: 97,
    model: "vision-test"
  });
  assert.match(recognition.recognitionId, /^[0-9a-f-]{36}$/);
  assert.equal(upstreamRequest.url, "https://example.test/v1/chat/completions");
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer test-key");
  assert.match(upstreamRequest.body.messages[0].content, /显示单位为斤/);
  assert.equal(upstreamRequest.body.messages[1].content[0].text, "图片上的体重是多少，直接输出数据");
  assert.equal(upstreamRequest.body.messages[1].content[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");

  const dashboardBeforeConfirm = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie } });
  assert.deepEqual((await dashboardBeforeConfirm.json()).entries, []);
  const confirm = await fetch(`${baseUrl}/api/weight-records/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ recognitionId: recognition.recognitionId })
  });
  assert.equal(confirm.status, 200);
  const saved = await confirm.json();
  assert.equal(saved.dashboard.entries.length, 1);
  assert.equal(saved.dashboard.entries[0].weight, 65.4);

  const duplicateConfirm = await fetch(`${baseUrl}/api/weight-records/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ recognitionId: recognition.recognitionId })
  });
  assert.equal(duplicateConfirm.status, 400);
  assert.equal((await duplicateConfirm.json()).code, "RECOGNITION_EXPIRED");
});

test("未配置密钥时返回明确状态", async (t) => {
  const { config, settingsStore } = createTestConfig(t, { adminPassword: "secure-pass-123" });
  const server = createAppServer({ config, settingsStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const unauthorized = await fetch(`${baseUrl}/api/recognize-weight`, { method: "POST" });
  assert.equal(unauthorized.status, 401);
  const cookie = await login(baseUrl);
  const response = await fetch(`${baseUrl}/api/recognize-weight`, { method: "POST", headers: { Cookie: cookie } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "AI_NOT_CONFIGURED");
});

test("健康检查和静态首页可访问", async (t) => {
  const { config, settingsStore } = createTestConfig(t, { apiKey: "configured" });
  const server = createAppServer({ config, settingsStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    aiConfigured: true,
    model: "vision-test"
  });

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /^text\/html/);
  assert.match(await home.text(), /AI 减肥与记重助手/);
});

test("管理员初始化、登录保护和系统内 Key 配置", async (t) => {
  const { config, settingsStore } = createTestConfig(t);
  const server = createAppServer({ config, settingsStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const initialStatus = await fetch(`${baseUrl}/api/admin/status`);
  assert.deepEqual(await initialStatus.json(), {
    setupRequired: true,
    authenticated: false,
    aiConfigured: false
  });

  const unauthorized = await fetch(`${baseUrl}/api/admin/settings`);
  assert.equal(unauthorized.status, 401);

  const setup = await fetch(`${baseUrl}/api/admin/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "secure-pass-123" })
  });
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get("set-cookie").split(";")[0];

  const save = await fetch(`${baseUrl}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      apiUrl: "https://yunllm.com/v1/chat/completions",
      model: "gpt-4o",
      apiKey: "sk-system-configured-1234",
      jsonMode: true
    })
  });
  assert.equal(save.status, 200);
  const publicSettings = await save.json();
  assert.equal(publicSettings.apiKeyConfigured, true);
  assert.equal(publicSettings.apiKeyMask, "••••••••1234");
  assert.equal(JSON.stringify(publicSettings).includes("sk-system"), false);

  const settingsFile = fs.readFileSync(path.join(config.dataDir, "settings.json"), "utf8");
  assert.equal(settingsFile.includes("sk-system-configured-1234"), false);
  assert.equal(settingsStore.getAiConfig().apiKey, "sk-system-configured-1234");
  const reloadedStore = new SystemSettingsStore(config);
  assert.equal(reloadedStore.verifyAdmin("secure-pass-123"), true);
  assert.equal(reloadedStore.getAiConfig().apiKey, "sk-system-configured-1234");
});
