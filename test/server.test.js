const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAppServer, parseDdddOcrContent, parseModelContent } = require("../server/server");
const { SystemSettingsStore } = require("../server/system-store");
const { WeightStore } = require("../server/weight-store");

function createTestConfig(t, overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qingying-test-"));
  const config = {
    port: 0,
    apiUrl: "https://example.test/v1/chat/completions",
    apiKey: "",
    model: "vision-test",
    recognitionEngine: "vision",
    ddddocrUrl: "http://127.0.0.1:8000/recognize",
    timeoutMs: 1000,
    maxImageBytes: 1024,
    maxBodyBytes: 4096,
    jsonMode: true,
    dataDir,
    configSecret: "test-only-secret",
    adminPassword: "",
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

async function waitForRecognitionJob(baseUrl, cookie, jobId, expectedStatus = "succeeded") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/recognition-jobs/${jobId}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const job = await response.json();
    if (job.status === expectedStatus) return job;
    if (job.status === "failed") assert.fail(job.error?.message || "识别任务失败");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`识别任务未在预期时间内进入 ${expectedStatus} 状态`);
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

test("解析 ddddocr 文本中的体重与单位", () => {
  assert.deepEqual(parseDdddOcrContent("当前体重 104.8斤 目标90斤"), {
    weight: 52.4,
    unit: "kg",
    confidence: 90
  });
  assert.deepEqual(parseDdddOcrContent("weight: 52.4 kg"), {
    weight: 52.4,
    unit: "kg",
    confidence: 90
  });
  assert.deepEqual(parseDdddOcrContent("16:33\n104.8\n90"), {
    weight: 52.4,
    unit: "kg",
    confidence: 90
  });
  assert.throws(() => parseDdddOcrContent("时间 16:33 电量 42"), /未识别到/);
});

test("旧版 ddddocr 容器地址自动迁移到单容器地址", (t) => {
  const { config, settingsStore } = createTestConfig(t);
  t.after(() => fs.rmSync(config.dataDir, { recursive: true, force: true }));
  settingsStore.updateAiSettings({
    recognitionEngine: "ddddocr",
    ddddocrUrl: "http://ddddocr:8000/recognize",
    apiUrl: config.apiUrl,
    model: config.model,
    jsonMode: true
  });
  assert.equal(settingsStore.getAiConfig().ddddocrUrl, "http://127.0.0.1:8000/recognize");
});

test("每条记录按起始体重计算累计奖励并自动修正旧账本", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "qingying-reward-test-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let store = new WeightStore({ dataDir, timeZone: "Asia/Shanghai" });
  store.database.prepare(`
    INSERT INTO weight_records (id, record_date, weight, confidence, model, reward, created_at)
    VALUES ('first-entry', '2026-07-23', 65, 95, 'vision-test', 0, '2026-07-23T08:00:00.000Z')
  `).run();
  store.database.prepare(`
    INSERT INTO weight_records (id, record_date, weight, confidence, model, reward, created_at)
    VALUES ('second-entry', '2026-07-24', 66, 95, 'vision-test', 0, '2026-07-24T08:00:00.000Z')
  `).run();
  store.close();

  store = new WeightStore({ dataDir, timeZone: "Asia/Shanghai" });
  let dashboard = store.getDashboard();
  assert.deepEqual(dashboard.entries.map((entry) => entry.reward), [800, 1000]);
  assert.equal(dashboard.wallet, 800);
  dashboard = store.updateProfile(68, 60);
  assert.deepEqual(dashboard.entries.map((entry) => entry.reward), [400, 600]);
  assert.equal(dashboard.wallet, 400);
  store.close();
});

test("图片上传后由后台任务识别并可确认保存", async (t) => {
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

  assert.equal(response.status, 202);
  const acceptedJob = await response.json();
  assert.equal(acceptedJob.status, "queued");
  assert.match(acceptedJob.jobId, /^[0-9a-f-]{36}$/);

  const completedJob = await waitForRecognitionJob(baseUrl, cookie, acceptedJob.jobId);
  const recognition = completedJob.result;
  assert.deepEqual({ weight: recognition.weight, unit: recognition.unit, confidence: recognition.confidence, model: recognition.model }, {
    weight: 65.4,
    unit: "kg",
    confidence: 97,
    model: "vision-test"
  });
  assert.match(recognition.recognitionId, /^[0-9a-f-]{36}$/);
  assert.equal(completedJob.imageUrl, `/api/recognition-jobs/${acceptedJob.jobId}/image`);
  assert.equal(upstreamRequest.url, "https://example.test/v1/chat/completions");
  assert.equal(upstreamRequest.init.headers.Authorization, "Bearer test-key");
  assert.match(upstreamRequest.body.messages[0].content, /显示单位为斤/);
  assert.equal(upstreamRequest.body.messages[1].content[0].text, "图片上的体重是多少，直接输出数据");
  assert.equal(upstreamRequest.body.messages[1].content[1].image_url.url, "data:image/png;base64,iVBORw0KGgo=");

  const activeResponse = await fetch(`${baseUrl}/api/recognition-jobs/active`, { headers: { Cookie: cookie } });
  assert.equal((await activeResponse.json()).job.jobId, acceptedJob.jobId);

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
  assert.equal(saved.entry.reward, 920);
  assert.equal(saved.rewardDelta, 920);
  assert.equal(saved.dashboard.wallet, 920);
  assert.match(saved.dashboard.entries[0].imageUrl, new RegExp(`/api/weight-records/${saved.entry.id}/image$`));

  const imageResponse = await fetch(`${baseUrl}${saved.entry.imageUrl}`, { headers: { Cookie: cookie } });
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), Buffer.from("iVBORw0KGgo=", "base64"));

  const duplicateConfirm = await fetch(`${baseUrl}/api/weight-records/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ recognitionId: recognition.recognitionId })
  });
  assert.equal(duplicateConfirm.status, 400);
  assert.equal((await duplicateConfirm.json()).code, "RECOGNITION_EXPIRED");

  const confirmedJob = await fetch(`${baseUrl}/api/recognition-jobs/${acceptedJob.jobId}`, { headers: { Cookie: cookie } });
  assert.equal((await confirmedJob.json()).status, "confirmed");

  const remove = await fetch(`${baseUrl}/api/weight-records/${saved.entry.id}`, { method: "DELETE", headers: { Cookie: cookie } });
  assert.equal(remove.status, 200);
  assert.equal(fs.readdirSync(path.join(config.dataDir, "weight-images")).length, 0);
});

test("上传响应不等待模型完成且活动任务可恢复", async (t) => {
  let finishRecognition;
  const { config, settingsStore } = createTestConfig(t, { apiKey: "test-key", adminPassword: "secure-pass-123" });
  const server = createAppServer({
    config,
    settingsStore,
    fetchImpl: () => new Promise((resolve) => {
      finishRecognition = () => resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '{"weightKg":61.2,"confidence":0.96}' } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    })
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);
  const response = await fetch(`${baseUrl}/api/recognize-weight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" })
  });

  assert.equal(response.status, 202);
  const acceptedJob = await response.json();
  const runningJob = await waitForRecognitionJob(baseUrl, cookie, acceptedJob.jobId, "running");
  assert.equal(runningJob.result, null);
  assert.equal(typeof finishRecognition, "function");

  const activeResponse = await fetch(`${baseUrl}/api/recognition-jobs/active`, { headers: { Cookie: cookie } });
  assert.equal((await activeResponse.json()).job.jobId, acceptedJob.jobId);

  finishRecognition();
  const completedJob = await waitForRecognitionJob(baseUrl, cookie, acceptedJob.jobId);
  assert.equal(completedJob.result.weight, 61.2);
});

test("服务重启后会恢复被中断的识别任务", async (t) => {
  const { config, settingsStore } = createTestConfig(t, { apiKey: "test-key", adminPassword: "secure-pass-123" });
  const interruptedStore = new WeightStore(config);
  const queued = interruptedStore.createRecognitionJob({
    contentType: "image/png",
    buffer: Buffer.from("iVBORw0KGgo=", "base64")
  }, config.model);
  assert.ok(interruptedStore.claimRecognitionJob(queued.jobId));
  interruptedStore.close();

  const server = createAppServer({
    config,
    settingsStore,
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"weightKg":63.1,"confidence":0.94}' } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);

  const completedJob = await waitForRecognitionJob(baseUrl, cookie, queued.jobId);
  assert.equal(completedJob.result.weight, 63.1);
});

test("上游不支持 JSON 输出模式时自动重试识图请求", async (t) => {
  const requests = [];
  const { config, settingsStore } = createTestConfig(t, { apiKey: "test-key", adminPassword: "secure-pass-123" });
  const server = createAppServer({
    config,
    settingsStore,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body });
      if (requests.length === 1) {
        return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"weightKg":60,"confidence":0.95}' } }] }), { status: 200 });
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

  assert.equal(response.status, 202);
  const acceptedJob = await response.json();
  const completedJob = await waitForRecognitionJob(baseUrl, cookie, acceptedJob.jobId);
  assert.equal(completedJob.result.weight, 60);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body.response_format, { type: "json_object" });
  assert.equal(requests[1].body.response_format, undefined);
});

test("系统设置可切换到 ddddocr 并识别重量", async (t) => {
  let ocrRequest;
  const { config, settingsStore } = createTestConfig(t, { adminPassword: "secure-pass-123" });
  const server = createAppServer({
    config,
    settingsStore,
    fetchImpl: async (url, init) => {
      ocrRequest = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ text: "当前体重 104.8斤" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanupServer(t, server, config.dataDir);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const cookie = await login(baseUrl);

  const settingsResponse = await fetch(`${baseUrl}/api/admin/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      recognitionEngine: "ddddocr",
      ddddocrUrl: "http://ddddocr.test/recognize",
      apiUrl: config.apiUrl,
      model: config.model,
      jsonMode: true
    })
  });
  assert.equal(settingsResponse.status, 200);
  const publicSettings = await settingsResponse.json();
  assert.equal(publicSettings.recognitionEngine, "ddddocr");
  assert.equal(publicSettings.recognitionConfigured, true);
  assert.equal(publicSettings.apiKeyConfigured, false);

  const status = await fetch(`${baseUrl}/api/admin/status`, { headers: { Cookie: cookie } });
  assert.equal((await status.json()).aiConfigured, true);
  const upload = await fetch(`${baseUrl}/api/recognize-weight`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" })
  });
  assert.equal(upload.status, 202);
  const acceptedJob = await upload.json();
  const completedJob = await waitForRecognitionJob(baseUrl, cookie, acceptedJob.jobId);
  assert.equal(completedJob.result.weight, 52.4);
  assert.equal(completedJob.result.model, "ddddocr");
  assert.equal(ocrRequest.url, "http://ddddocr.test/recognize");
  assert.equal(ocrRequest.body.image, "data:image/png;base64,iVBORw0KGgo=");
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
