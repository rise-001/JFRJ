const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PENDING_TTL_MS = 10 * 60 * 1000;
const IMAGE_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"]
]);
const IMAGE_CONTENT_TYPES = new Map([...IMAGE_EXTENSIONS].map(([contentType, extension]) => [extension, contentType]));

function dateKey(timestamp, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestamp));
}

function mapEntry(row) {
  return {
    id: row.id,
    date: row.record_date,
    weight: row.weight,
    source: "ai",
    confidence: row.confidence,
    model: row.model,
    reward: row.reward,
    imageUrl: row.image_filename ? `/api/weight-records/${encodeURIComponent(row.id)}/image` : null,
    createdAt: row.created_at
  };
}

class WeightStore {
  constructor(config) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.timeZone = config.timeZone || "Asia/Shanghai";
    this.filePath = config.weightDbPath || path.join(config.dataDir, "qingying.sqlite");
    this.imageDir = path.join(config.dataDir, "weight-images");
    fs.mkdirSync(this.imageDir, { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(this.filePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        start_weight REAL NOT NULL,
        goal_weight REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO profile (id, start_weight, goal_weight, updated_at)
      VALUES (1, 70.0, 60.0, CURRENT_TIMESTAMP);

      CREATE TABLE IF NOT EXISTS weight_records (
        id TEXT PRIMARY KEY,
        record_date TEXT NOT NULL UNIQUE,
        weight REAL NOT NULL CHECK (weight >= 30 AND weight <= 250),
        confidence INTEGER NOT NULL CHECK (confidence >= 85 AND confidence <= 100),
        model TEXT NOT NULL,
        reward INTEGER NOT NULL DEFAULT 0 CHECK (reward >= 0),
        image_filename TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_recognitions (
        id TEXT PRIMARY KEY,
        weight REAL NOT NULL CHECK (weight >= 30 AND weight <= 250),
        confidence INTEGER NOT NULL CHECK (confidence >= 85 AND confidence <= 100),
        model TEXT NOT NULL,
        image_filename TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    this.ensureColumn("weight_records", "image_filename", "TEXT");
    this.ensureColumn("pending_recognitions", "image_filename", "TEXT");
    this.cleanupExpiredRecognitions(Date.now());
  }

  ensureColumn(table, column, definition) {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((item) => item.name === column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  imagePath(filename) {
    return path.join(this.imageDir, path.basename(filename));
  }

  removeImage(filename) {
    if (filename) fs.rmSync(this.imagePath(filename), { force: true });
  }

  cleanupExpiredRecognitions(now) {
    const expired = this.database.prepare("SELECT image_filename FROM pending_recognitions WHERE expires_at < ?").all(now);
    this.database.prepare("DELETE FROM pending_recognitions WHERE expires_at < ?").run(now);
    expired.forEach((row) => this.removeImage(row.image_filename));
  }

  close() {
    if (!this.database) return;
    this.database.close();
    this.database = null;
  }

  getDashboard() {
    const profile = this.database.prepare("SELECT start_weight, goal_weight FROM profile WHERE id = 1").get();
    const rows = this.database.prepare("SELECT * FROM weight_records ORDER BY record_date DESC, created_at DESC").all();
    return {
      profile: { startWeight: profile.start_weight, goalWeight: profile.goal_weight },
      walletBase: 0,
      entries: rows.map(mapEntry)
    };
  }

  createPendingRecognition(result, model, image) {
    const now = Date.now();
    const id = randomUUID();
    this.cleanupExpiredRecognitions(now);
    const extension = IMAGE_EXTENSIONS.get(image?.contentType);
    const imageFilename = extension ? `${id}${extension}` : null;
    if (imageFilename) fs.writeFileSync(this.imagePath(imageFilename), image.buffer, { mode: 0o600 });
    try {
      this.database.prepare(`
        INSERT INTO pending_recognitions (id, weight, confidence, model, image_filename, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, result.weight, result.confidence, model, imageFilename, now, now + PENDING_TTL_MS);
    } catch (error) {
      this.removeImage(imageFilename);
      throw error;
    }
    return { id, expiresAt: now + PENDING_TTL_MS };
  }

  confirmRecognition(recognitionId) {
    if (typeof recognitionId !== "string" || !recognitionId) {
      throw Object.assign(new Error("缺少有效的 AI 识别凭证"), { code: "RECOGNITION_REQUIRED" });
    }
    const now = Date.now();
    const pending = this.database.prepare("SELECT * FROM pending_recognitions WHERE id = ? AND expires_at >= ?").get(recognitionId, now);
    if (!pending) {
      throw Object.assign(new Error("AI 识别凭证无效或已过期，请重新上传截图"), { code: "RECOGNITION_EXPIRED" });
    }

    const recordDate = dateKey(pending.created_at, this.timeZone);
    const existing = this.database.prepare("SELECT * FROM weight_records WHERE record_date = ?").get(recordDate);
    const previous = this.database.prepare("SELECT weight FROM weight_records WHERE record_date < ? ORDER BY record_date DESC LIMIT 1").get(recordDate);
    const reward = previous ? Math.max(0, Math.round((previous.weight - pending.weight) * 200)) : 0;
    const entryId = existing?.id || randomUUID();
    const createdAt = existing?.created_at || new Date(pending.created_at).toISOString();
    const extension = pending.image_filename ? path.extname(pending.image_filename).toLowerCase() : "";
    const imageFilename = extension ? `${entryId}-${randomUUID()}${extension}` : null;
    let imageMoved = false;
    let transactionStarted = false;

    try {
      if (imageFilename) {
        if (!fs.existsSync(this.imagePath(pending.image_filename))) {
          throw Object.assign(new Error("待保存的记录照片不存在，请重新上传"), { code: "IMAGE_NOT_FOUND", statusCode: 500 });
        }
        fs.renameSync(this.imagePath(pending.image_filename), this.imagePath(imageFilename));
        imageMoved = true;
      }
      this.database.exec("BEGIN IMMEDIATE");
      transactionStarted = true;
      this.database.prepare(`
        INSERT INTO weight_records (id, record_date, weight, confidence, model, reward, image_filename, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_date) DO UPDATE SET
          weight = excluded.weight,
          confidence = excluded.confidence,
          model = excluded.model,
          reward = excluded.reward,
          image_filename = excluded.image_filename
      `).run(entryId, recordDate, pending.weight, pending.confidence, pending.model, reward, imageMoved ? imageFilename : existing?.image_filename || null, createdAt);
      this.database.prepare("DELETE FROM pending_recognitions WHERE id = ?").run(recognitionId);
      this.database.exec("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) this.database.exec("ROLLBACK");
      if (imageMoved) fs.renameSync(this.imagePath(imageFilename), this.imagePath(pending.image_filename));
      throw error;
    }
    if (imageMoved && existing?.image_filename && existing.image_filename !== imageFilename) this.removeImage(existing.image_filename);

    const entry = mapEntry(this.database.prepare("SELECT * FROM weight_records WHERE record_date = ?").get(recordDate));
    return { dashboard: this.getDashboard(), entry, replaced: Boolean(existing) };
  }

  updateProfile(startWeight, goalWeight) {
    const start = Number(startWeight);
    const goal = Number(goalWeight);
    if (![start, goal].every((value) => Number.isFinite(value) && value >= 30 && value <= 250)) {
      throw Object.assign(new Error("请输入 60 至 500 斤之间的有效体重"), { code: "INVALID_PROFILE" });
    }
    if (goal >= start) {
      throw Object.assign(new Error("目标体重需要低于起始体重"), { code: "INVALID_PROFILE" });
    }
    this.database.prepare("UPDATE profile SET start_weight = ?, goal_weight = ?, updated_at = ? WHERE id = 1").run(start, goal, new Date().toISOString());
    return this.getDashboard();
  }

  deleteEntry(entryId) {
    if (typeof entryId !== "string" || !entryId) {
      throw Object.assign(new Error("缺少记录 ID"), { code: "ENTRY_REQUIRED" });
    }
    const existing = this.database.prepare("SELECT image_filename FROM weight_records WHERE id = ?").get(entryId);
    const result = this.database.prepare("DELETE FROM weight_records WHERE id = ?").run(entryId);
    if (!result.changes) {
      throw Object.assign(new Error("体重记录不存在"), { code: "ENTRY_NOT_FOUND", statusCode: 404 });
    }
    this.removeImage(existing?.image_filename);
    return this.getDashboard();
  }

  getEntryImage(entryId) {
    const entry = this.database.prepare("SELECT image_filename FROM weight_records WHERE id = ?").get(entryId);
    if (!entry) throw Object.assign(new Error("体重记录不存在"), { code: "ENTRY_NOT_FOUND", statusCode: 404 });
    if (!entry.image_filename) throw Object.assign(new Error("该记录没有保存照片"), { code: "IMAGE_NOT_FOUND", statusCode: 404 });
    const filePath = this.imagePath(entry.image_filename);
    if (!fs.existsSync(filePath)) throw Object.assign(new Error("记录照片文件不存在"), { code: "IMAGE_NOT_FOUND", statusCode: 404 });
    return {
      body: fs.readFileSync(filePath),
      contentType: IMAGE_CONTENT_TYPES.get(path.extname(entry.image_filename).toLowerCase()) || "application/octet-stream"
    };
  }
}

module.exports = { WeightStore };
