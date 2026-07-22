function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateOffset(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function createInitialDashboard() {
  return {
    profile: { startWeight: 70, goalWeight: 60 },
    walletBase: 0,
    entries: []
  };
}

export function todayKey() {
  return toDateKey(new Date());
}

export function sortEntries(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function calendarDayDifference(dateA, dateB) {
  const a = new Date(`${dateA}T12:00:00`);
  const b = new Date(`${dateB}T12:00:00`);
  return Math.round((a - b) / 86400000);
}

export function getDashboardStats(dashboard) {
  const entries = sortEntries(dashboard.entries);
  const hasEntries = entries.length > 0;
  const current = entries[0]?.weight ?? null;
  const previous = entries[1]?.weight ?? current;
  const totalLoss = hasEntries ? dashboard.profile.startWeight - current : 0;
  const targetSpan = dashboard.profile.startWeight - dashboard.profile.goalWeight;
  const progress = targetSpan > 0 ? Math.max(0, Math.min(100, (totalLoss / targetSpan) * 100)) : 0;
  const wallet = dashboard.walletBase + entries.reduce((sum, entry) => sum + (entry.reward || 0), 0);
  const thirtyDaysAgo = dateOffset(-29);
  const recentMonth = entries.filter((entry) => entry.date >= thirtyDaysAgo);
  const monthStart = recentMonth.at(-1)?.weight ?? current;
  const uniqueDates = [...new Set(entries.map((entry) => entry.date))];
  const today = todayKey();
  let streak = 0;
  if (uniqueDates[0] && calendarDayDifference(today, uniqueDates[0]) <= 1) {
    streak = 1;
    for (let index = 1; index < uniqueDates.length; index += 1) {
      if (calendarDayDifference(uniqueDates[index - 1], uniqueDates[index]) !== 1) break;
      streak += 1;
    }
  }
  return {
    hasEntries,
    current,
    previous,
    lastChange: hasEntries ? current - previous : 0,
    totalLoss,
    remaining: hasEntries ? Math.max(0, current - dashboard.profile.goalWeight) : 0,
    progress,
    wallet,
    monthChange: hasEntries ? current - monthStart : 0,
    streak
  };
}

export function chartEntries(entries, range) {
  const sorted = sortEntries(entries);
  if (range === "recent") return sorted.slice(0, 7).reverse();
  const cutoff = dateOffset(-29);
  return sorted.filter((entry) => entry.date >= cutoff).reverse();
}

export function formatEntryDate(dateKey, long = false) {
  const date = new Date(`${dateKey}T12:00:00`);
  if (dateKey === todayKey()) return long ? "今天" : "今天";
  if (dateKey === dateOffset(-1)) return long ? "昨天" : "昨天";
  return new Intl.DateTimeFormat("zh-CN", long ? { month: "long", day: "numeric", weekday: "short" } : { month: "numeric", day: "numeric" }).format(date);
}
