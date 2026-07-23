const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PENDING_TTL_MS = 10 * 60 * 1000;

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
    createdAt: row.created_at
  };
}

class WeightStore {
  constructor(config) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.timeZone = config.timeZone || "Asia/Shanghai";
    this.filePath = config.weightDbPath || path.join(config.dataDir, "qingying.sqlite");
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
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pending_recognitions (
        id TEXT PRIMARY KEY,
        weight REAL NOT NULL CHECK (weight >= 30 AND weight <= 250),
        confidence INTEGER NOT NULL CHECK (confidence >= 85 AND confidence <= 100),
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
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

  createPendingRecognition(result, model) {
    const now = Date.now();
    const id = randomUUID();
    this.database.prepare("DELETE FROM pending_recognitions WHERE expires_at < ?").run(now);
    this.database.prepare(`
      INSERT INTO pending_recognitions (id, weight, confidence, model, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, result.weight, result.confidence, model, now, now + PENDING_TTL_MS);
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

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO weight_records (id, record_date, weight, confidence, model, reward, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_date) DO UPDATE SET
          weight = excluded.weight,
          confidence = excluded.confidence,
          model = excluded.model,
          reward = excluded.reward
      `).run(entryId, recordDate, pending.weight, pending.confidence, pending.model, reward, createdAt);
      this.database.prepare("DELETE FROM pending_recognitions WHERE id = ?").run(recognitionId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

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
    const result = this.database.prepare("DELETE FROM weight_records WHERE id = ?").run(entryId);
    if (!result.changes) {
      throw Object.assign(new Error("体重记录不存在"), { code: "ENTRY_NOT_FOUND", statusCode: 404 });
    }
    return this.getDashboard();
  }
}

module.exports = { WeightStore };
