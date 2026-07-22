const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { SystemSettingsStore } = require("./system-store");
const { AdminAuth } = require("./auth");
const { WeightStore } = require("./weight-store");

const PROJECT_ROOT = path.join(__dirname, "..");
const DIST_ROOT = path.join(PROJECT_ROOT, "dist");
const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"]
]);

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BODY_BYTES = 12 * 1024 * 1024;
const MIN_RECOGNITION_CONFIDENCE = 0.85;

function numberFromEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getConfig(env = process.env) {
  return {
    port: numberFromEnv(env.PORT, 3000),
    apiUrl: env.AI_API_URL || "https://yunllm.com/v1/chat/completions",
    apiKey: env.AI_API_KEY || "",
    model: env.AI_MODEL || "gpt-4o",
    timeoutMs: numberFromEnv(env.AI_TIMEOUT_MS, 45000),
    maxImageBytes: numberFromEnv(env.MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES),
    maxBodyBytes: numberFromEnv(env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    jsonMode: env.AI_JSON_MODE !== "false",
    dataDir: env.DATA_DIR || path.join(__dirname, "..", "data"),
    configSecret: env.CONFIG_SECRET || "",
    adminPassword: env.ADMIN_PASSWORD || "",
    sessionHours: numberFromEnv(env.SESSION_HOURS, 12),
    cookieSecure: env.COOKIE_SECURE === "true",
    timeZone: env.APP_TIMEZONE || "Asia/Shanghai"
  };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function setSecurityHeaders(response, requestId) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  response.setHeader("X-Request-Id", requestId);
}

function readJsonBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });

    request.on("end", () => {
      if (tooLarge) {
        const error = new Error("请求体过大");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        const error = new Error("请求数据不是有效 JSON");
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function validateImage(dataUrl, maxImageBytes) {
  if (typeof dataUrl !== "string") {
    throw Object.assign(new Error("缺少图片数据"), { code: "IMAGE_REQUIRED" });
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) {
    throw Object.assign(new Error("仅支持 PNG、JPEG 或 WebP 图片"), { code: "IMAGE_TYPE_UNSUPPORTED" });
  }

  const imageBytes = Buffer.from(match[2], "base64").length;
  if (imageBytes === 0) {
    throw Object.assign(new Error("图片内容为空"), { code: "IMAGE_EMPTY" });
  }
  if (imageBytes > maxImageBytes) {
    throw Object.assign(new Error(`图片不能超过 ${Math.floor(maxImageBytes / 1024 / 1024)} MB`), { code: "IMAGE_TOO_LARGE" });
  }
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

function parseJsonCandidate(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("模型未返回 JSON");
  }
}

function parseModelContent(content) {
  const text = extractTextContent(content);
  const payload = parseJsonCandidate(text);
  let weight = Number(payload.weightKg ?? payload.weight_kg ?? payload.weight ?? payload.value);
  const unit = String(payload.unit || "kg").toLowerCase();

  if (unit === "斤" || unit === "jin") weight /= 2;
  if (unit === "lb" || unit === "lbs") weight /= 2.2046226218;
  if (!Number.isFinite(weight) || weight < 30 || weight > 250) {
    throw new Error("未识别到 30 至 250 kg 之间的有效体重");
  }

  let confidence = Number(payload.confidence ?? 0.9);
  if (confidence > 1) confidence /= 100;
  confidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.9;
  if (confidence < MIN_RECOGNITION_CONFIDENCE) {
    throw Object.assign(new Error("识别可信度不足 85%，请上传更清晰的体重截图"), { code: "LOW_CONFIDENCE" });
  }

  return {
    weight: Math.round(weight * 10) / 10,
    unit: "kg",
    confidence: Math.round(confidence * 100)
  };
}

async function callVisionModel(image, config, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const requestBody = {
    model: config.model,
    stream: false,
    temperature: 0.1,
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content: "你是体重截图识别器。只读取图片中明确显示的当前体重。只返回 JSON 对象，格式为 {\"weightKg\":65.4,\"unit\":\"kg\",\"confidence\":0.98}。将斤或磅换算为 kg；无法确定时 weightKg 返回 null。不要返回 Markdown。"
      },
      {
        role: "user",
        content: [
          { type: "text", text: "识别这张体重秤或智能秤 App 截图中的当前体重。" },
          { type: "image_url", image_url: { url: image } }
        ]
      }
    ]
  };

  if (config.jsonMode) requestBody.response_format = { type: "json_object" };

  try {
    const upstream = await fetchImpl(config.apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const responseText = await upstream.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      throw Object.assign(new Error("大模型服务返回了无效响应"), { statusCode: 502 });
    }

    if (!upstream.ok) {
      const upstreamMessage = responseData?.error?.message || responseData?.message || `HTTP ${upstream.status}`;
      throw Object.assign(new Error(`大模型调用失败：${upstreamMessage}`), { statusCode: 502 });
    }

    const content = responseData?.choices?.[0]?.message?.content;
    if (!content) throw Object.assign(new Error("大模型未返回识别结果"), { statusCode: 502 });
    return parseModelContent(content);
  } catch (error) {
    if (error.name === "AbortError") {
      throw Object.assign(new Error("大模型识别超时，请重试"), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleRecognition(request, response, config, fetchImpl, weightStore) {
  if (!config.apiKey) {
    sendJson(response, 503, { error: "AI_API_KEY 未配置", code: "AI_NOT_CONFIGURED" });
    return;
  }

  try {
    const body = await readJsonBody(request, config.maxBodyBytes);
    validateImage(body.image, config.maxImageBytes);
    const result = await callVisionModel(body.image, config, fetchImpl);
    const pending = weightStore.createPendingRecognition(result, config.model);
    sendJson(response, 200, { ...result, model: config.model, recognitionId: pending.id, expiresAt: pending.expiresAt });
  } catch (error) {
    const statusCode = error.statusCode || (error.code === "BODY_TOO_LARGE" ? 413 : 400);
    sendJson(response, statusCode, {
      error: error.message || "识别失败",
      code: error.code || "RECOGNITION_FAILED"
    });
  }
}

function serveStatic(request, response, pathname) {
  const hasBuild = fs.existsSync(path.join(DIST_ROOT, "index.html"));
  const staticRoot = hasBuild ? DIST_ROOT : PROJECT_ROOT;
  const requestedPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const normalizedPath = path.normalize(requestedPath);
  let filePath = path.resolve(staticRoot, normalizedPath);
  if (!filePath.startsWith(path.resolve(staticRoot))) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (!hasBuild || path.extname(normalizedPath)) return false;
    filePath = path.join(DIST_ROOT, "index.html");
  }
  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  const body = fs.readFileSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": path.extname(filePath) === ".html" ? "no-cache" : "public, max-age=31536000, immutable"
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
  return true;
}

function createAppServer(options = {}) {
  const config = options.config || getConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const settingsStore = options.settingsStore || new SystemSettingsStore(config);
  const auth = options.auth || new AdminAuth(config);
  const weightStore = options.weightStore || new WeightStore(config);
  const ownsWeightStore = !options.weightStore;

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID();
    setSecurityHeaders(response, requestId);
    const pathname = new URL(request.url, "http://localhost").pathname;

    if (request.method === "GET" && pathname === "/health") {
      try {
        const aiConfig = settingsStore.getAiConfig();
        sendJson(response, 200, { status: "ok", aiConfigured: Boolean(aiConfig.apiKey), model: aiConfig.model });
      } catch (error) {
        sendJson(response, 503, { status: "error", error: error.message });
      }
      return;
    }
    if (request.method === "GET" && pathname === "/api/config") {
      try {
        const aiConfig = settingsStore.getAiConfig();
        sendJson(response, 200, { aiConfigured: Boolean(aiConfig.apiKey), model: aiConfig.model });
      } catch (error) {
        sendJson(response, 503, { aiConfigured: false, error: error.message });
      }
      return;
    }
    if (pathname.startsWith("/api/dashboard") || pathname.startsWith("/api/weight-records")) {
      if (!auth.isAuthenticated(request)) {
        sendJson(response, 401, { error: "请先登录", code: "UNAUTHORIZED" });
        return;
      }
      try {
        if (request.method === "GET" && pathname === "/api/dashboard") {
          sendJson(response, 200, weightStore.getDashboard());
          return;
        }
        if (request.method === "PUT" && pathname === "/api/dashboard/profile") {
          const body = await readJsonBody(request, 32 * 1024);
          sendJson(response, 200, weightStore.updateProfile(body.startWeight, body.goalWeight));
          return;
        }
        if (request.method === "POST" && pathname === "/api/weight-records/confirm") {
          const body = await readJsonBody(request, 32 * 1024);
          sendJson(response, 200, weightStore.confirmRecognition(body.recognitionId));
          return;
        }
        const entryMatch = pathname.match(/^\/api\/weight-records\/([^/]+)$/);
        if (request.method === "DELETE" && entryMatch) {
          sendJson(response, 200, weightStore.deleteEntry(decodeURIComponent(entryMatch[1])));
          return;
        }
      } catch (error) {
        sendJson(response, error.statusCode || 400, { error: error.message || "数据操作失败", code: error.code || "DATA_OPERATION_FAILED" });
        return;
      }
      sendJson(response, 404, { error: "Not found", code: "NOT_FOUND" });
      return;
    }
    if (request.method === "GET" && pathname === "/api/admin/status") {
      let aiConfigured = false;
      try {
        aiConfigured = Boolean(settingsStore.getAiConfig().apiKey);
      } catch {}
      sendJson(response, 200, {
        setupRequired: settingsStore.isSetupRequired(),
        authenticated: auth.isAuthenticated(request),
        aiConfigured
      });
      return;
    }
    if (request.method === "POST" && pathname === "/api/admin/setup") {
      try {
        if (!settingsStore.isSetupRequired()) {
          sendJson(response, 409, { error: "管理员已经初始化", code: "ALREADY_SETUP" });
          return;
        }
        const body = await readJsonBody(request, 32 * 1024);
        settingsStore.createAdmin(body.password);
        auth.createSession(response);
        sendJson(response, 201, { success: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message, code: "SETUP_FAILED" });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/admin/login") {
      const ip = request.socket.remoteAddress || "unknown";
      const attempt = auth.canAttempt(ip);
      if (!attempt.allowed) {
        response.setHeader("Retry-After", String(attempt.retryAfter));
        sendJson(response, 429, { error: "登录尝试过多，请稍后再试", code: "RATE_LIMITED" });
        return;
      }
      try {
        const body = await readJsonBody(request, 32 * 1024);
        if (!settingsStore.verifyAdmin(body.password)) {
          auth.recordFailure(ip);
          sendJson(response, 401, { error: "管理员密码不正确", code: "INVALID_CREDENTIALS" });
          return;
        }
        auth.clearFailures(ip);
        auth.createSession(response);
        sendJson(response, 200, { success: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message, code: "LOGIN_FAILED" });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/admin/logout") {
      auth.destroySession(request, response);
      sendJson(response, 200, { success: true });
      return;
    }
    if (["/api/admin/settings", "/api/admin/password"].includes(pathname) && !auth.isAuthenticated(request)) {
      sendJson(response, 401, { error: "请先登录管理员账号", code: "UNAUTHORIZED" });
      return;
    }
    if (request.method === "GET" && pathname === "/api/admin/settings") {
      try {
        sendJson(response, 200, settingsStore.getPublicAiSettings());
      } catch (error) {
        sendJson(response, 500, { error: error.message, code: "SETTINGS_READ_FAILED" });
      }
      return;
    }
    if (request.method === "PUT" && pathname === "/api/admin/settings") {
      try {
        const body = await readJsonBody(request, 32 * 1024);
        sendJson(response, 200, settingsStore.updateAiSettings(body));
      } catch (error) {
        sendJson(response, 400, { error: error.message, code: "SETTINGS_UPDATE_FAILED" });
      }
      return;
    }
    if (request.method === "PUT" && pathname === "/api/admin/password") {
      try {
        const body = await readJsonBody(request, 32 * 1024);
        settingsStore.changeAdminPassword(body.currentPassword, body.nextPassword);
        auth.destroySession(request, response);
        sendJson(response, 200, { success: true, reloginRequired: true });
      } catch (error) {
        sendJson(response, 400, { error: error.message, code: "PASSWORD_UPDATE_FAILED" });
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/recognize-weight") {
      if (!auth.isAuthenticated(request)) {
        sendJson(response, 401, { error: "请先登录", code: "UNAUTHORIZED" });
        return;
      }
      try {
        await handleRecognition(request, response, settingsStore.getAiConfig(), fetchImpl, weightStore);
      } catch (error) {
        sendJson(response, 503, { error: error.message, code: "AI_CONFIG_INVALID" });
      }
      return;
    }
    if ((request.method === "GET" || request.method === "HEAD") && serveStatic(request, response, pathname)) return;
    sendJson(response, 404, { error: "Not found", code: "NOT_FOUND" });
  });
  if (ownsWeightStore) server.on("close", () => weightStore.close());
  server.weightStore = weightStore;
  return server;
}

if (require.main === module) {
  const config = getConfig();
  const settingsStore = new SystemSettingsStore(config);
  const server = createAppServer({ config, settingsStore });
  server.listen(config.port, "0.0.0.0", () => {
    const aiConfig = settingsStore.getAiConfig();
    console.log(`轻盈服务已启动：http://0.0.0.0:${config.port}`);
    console.log(`AI 模型：${aiConfig.model}（${aiConfig.apiKey ? "已配置" : "请登录系统配置 API Key"}）`);
  });
}

module.exports = { createAppServer, getConfig, parseModelContent, validateImage };
