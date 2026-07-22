const fs = require("node:fs");
const path = require("node:path");
const {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} = require("node:crypto");

class SystemSettingsStore {
  constructor(baseConfig) {
    this.baseConfig = baseConfig;
    this.dataDir = baseConfig.dataDir;
    this.settingsPath = path.join(this.dataDir, "settings.json");
    this.keyPath = path.join(this.dataDir, ".config-key");
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    this.encryptionKey = this.loadEncryptionKey(baseConfig.configSecret);
    this.data = this.loadSettings();

    if (!this.data.admin && baseConfig.adminPassword) {
      this.createAdmin(baseConfig.adminPassword);
    }
  }

  loadEncryptionKey(secret) {
    if (secret) return createHash("sha256").update(secret).digest();
    if (fs.existsSync(this.keyPath)) {
      return Buffer.from(fs.readFileSync(this.keyPath, "utf8").trim(), "base64");
    }
    const key = randomBytes(32);
    fs.writeFileSync(this.keyPath, key.toString("base64"), { mode: 0o600 });
    return key;
  }

  loadSettings() {
    if (!fs.existsSync(this.settingsPath)) return { version: 1, admin: null, ai: {} };
    try {
      const data = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
      return { version: 1, admin: data.admin || null, ai: data.ai || {} };
    } catch (error) {
      throw new Error(`无法读取系统配置：${error.message}`);
    }
  }

  save() {
    const tempPath = `${this.settingsPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.settingsPath);
  }

  isSetupRequired() {
    return !this.data.admin;
  }

  createAdmin(password) {
    if (!this.isSetupRequired()) throw new Error("管理员已经初始化");
    this.assertPassword(password);
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64);
    this.data.admin = { salt: salt.toString("base64"), hash: hash.toString("base64") };
    this.save();
  }

  verifyAdmin(password) {
    if (!this.data.admin || typeof password !== "string") return false;
    const salt = Buffer.from(this.data.admin.salt, "base64");
    const expected = Buffer.from(this.data.admin.hash, "base64");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  changeAdminPassword(currentPassword, nextPassword) {
    if (!this.verifyAdmin(currentPassword)) throw new Error("当前密码不正确");
    this.assertPassword(nextPassword);
    const salt = randomBytes(16);
    const hash = scryptSync(nextPassword, salt, 64);
    this.data.admin = { salt: salt.toString("base64"), hash: hash.toString("base64") };
    this.save();
  }

  assertPassword(password) {
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw new Error("管理员密码长度需为 8 至 128 位");
    }
  }

  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64")
    };
  }

  decrypt(payload) {
    if (!payload) return "";
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  getAiConfig() {
    const ai = this.data.ai;
    let storedKey = "";
    if (ai.apiKey) {
      try {
        storedKey = this.decrypt(ai.apiKey);
      } catch {
        throw new Error("系统中的 API Key 无法解密，请登录后重新保存");
      }
    }
    return {
      ...this.baseConfig,
      apiUrl: ai.apiUrl || this.baseConfig.apiUrl,
      apiKey: storedKey || this.baseConfig.apiKey,
      model: ai.model || this.baseConfig.model,
      jsonMode: typeof ai.jsonMode === "boolean" ? ai.jsonMode : this.baseConfig.jsonMode
    };
  }

  getPublicAiSettings() {
    const config = this.getAiConfig();
    const suffix = config.apiKey ? config.apiKey.slice(-4) : "";
    return {
      apiUrl: config.apiUrl,
      model: config.model,
      jsonMode: config.jsonMode,
      apiKeyConfigured: Boolean(config.apiKey),
      apiKeyMask: suffix ? `••••••••${suffix}` : ""
    };
  }

  updateAiSettings(input) {
    const apiUrl = String(input.apiUrl || "").trim();
    const model = String(input.model || "").trim();
    let parsedUrl;
    try {
      parsedUrl = new URL(apiUrl);
    } catch {
      throw new Error("API 地址格式不正确");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("API 地址仅支持 HTTP 或 HTTPS");
    if (!model || model.length > 120) throw new Error("请输入有效的模型名称");

    this.data.ai.apiUrl = apiUrl;
    this.data.ai.model = model;
    this.data.ai.jsonMode = input.jsonMode !== false;
    if (input.clearApiKey === true) delete this.data.ai.apiKey;
    if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      if (input.apiKey.trim().length > 512) throw new Error("API Key 长度异常");
      this.data.ai.apiKey = this.encrypt(input.apiKey.trim());
    }
    this.save();
    return this.getPublicAiSettings();
  }
}

module.exports = { SystemSettingsStore };
