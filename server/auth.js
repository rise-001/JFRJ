const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const COOKIE_NAME = "qingying_admin";
const COOKIE_MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, item) => {
    const separator = item.indexOf("=");
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

class AdminAuth {
  constructor({ dataDir = path.join(__dirname, "..", "data"), cookieSecure = false } = {}) {
    this.cookieSecure = cookieSecure;
    this.sessionsPath = path.join(dataDir, "admin-sessions.json");
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.sessions = this.loadSessions();
    this.attempts = new Map();
  }

  loadSessions() {
    if (!fs.existsSync(this.sessionsPath)) return new Set();
    try {
      const tokens = JSON.parse(fs.readFileSync(this.sessionsPath, "utf8"));
      return new Set(Array.isArray(tokens) ? tokens.filter((token) => typeof token === "string" && token.length === 43) : []);
    } catch {
      return new Set();
    }
  }

  saveSessions() {
    const tempPath = `${this.sessionsPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify([...this.sessions])}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, this.sessionsPath);
  }

  getSession(request) {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    if (!this.sessions.has(token)) return null;
    return { token };
  }

  isAuthenticated(request) {
    return Boolean(this.getSession(request));
  }

  createSession(response) {
    const token = randomBytes(32).toString("base64url");
    this.sessions.add(token);
    this.saveSessions();
    const secure = this.cookieSecure ? "; Secure" : "";
    response.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure}`
    );
  }

  destroySession(request, response) {
    const session = this.getSession(request);
    if (session) {
      this.sessions.delete(session.token);
      this.saveSessions();
    }
    this.clearSessionCookie(response);
  }

  destroyAllSessions(response) {
    this.sessions.clear();
    this.saveSessions();
    if (response) this.clearSessionCookie(response);
  }

  clearSessionCookie(response) {
    const secure = this.cookieSecure ? "; Secure" : "";
    response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
  }

  getAttemptState(ip) {
    const now = Date.now();
    const state = this.attempts.get(ip);
    if (!state || state.resetAt <= now) {
      const next = { count: 0, resetAt: now + 5 * 60 * 1000 };
      this.attempts.set(ip, next);
      return next;
    }
    return state;
  }

  canAttempt(ip) {
    const state = this.getAttemptState(ip);
    return { allowed: state.count < 5, retryAfter: Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1000)) };
  }

  recordFailure(ip) {
    this.getAttemptState(ip).count += 1;
  }

  clearFailures(ip) {
    this.attempts.delete(ip);
  }
}

module.exports = { AdminAuth };
