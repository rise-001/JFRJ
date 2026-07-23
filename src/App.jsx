import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Camera,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ClipboardList,
  Image as ImageIcon,
  ImageUp,
  LayoutDashboard,
  LoaderCircle,
  Pencil,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingDown,
  UploadCloud,
  WalletCards
} from "lucide-react";
import { LoginScreen } from "@/components/LoginScreen";
import { WeightChart } from "@/components/WeightChart";
import { apiRequest, readFileAsDataUrl } from "@/lib/api";
import { formatWeightJin, jinToKg, kgToJin } from "@/lib/weight";
import {
  chartEntries,
  createInitialDashboard,
  formatEntryDate,
  getDashboardStats,
  sortEntries,
  todayKey
} from "@/lib/dashboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AdminSettingsDialog = lazy(() => import("@/components/AdminSettingsDialog").then((module) => ({ default: module.AdminSettingsDialog })));
const RECOGNITION_POLL_MS = 1500;

function currentDateLabel() {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
}

function createRecognitionJobId() {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function signedWeight(value) {
  if (Math.abs(value) < 0.05) return "持平";
  return `${value > 0 ? "+" : ""}${kgToJin(value).toFixed(1)} 斤`;
}

function Toast({ message }) {
  if (!message) return null;
  return <div role="status" className="fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-md bg-stone-900 px-4 py-2.5 text-sm text-white shadow-soft lg:bottom-6">{message}</div>;
}

function CoinRain() {
  return <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <span key={index} className="rain-coin animate-coin-fall" style={{ left: `${(index * 37) % 96}%`, "--duration": `${2.4 + (index % 7) * 0.24}s`, "--delay": `${(index % 9) * 0.11}s` }}>¥</span>)}</div>;
}

const WALLET_COINS = [
  { left: "54%", top: "17%", size: 12, delay: "-1.1s", duration: "5.8s", drift: "-8px" },
  { left: "65%", top: "58%", size: 18, delay: "-3.8s", duration: "6.4s", drift: "6px" },
  { left: "73%", top: "29%", size: 14, delay: "-2.2s", duration: "5.5s", drift: "-5px" },
  { left: "81%", top: "67%", size: 22, delay: "-4.6s", duration: "6.8s", drift: "8px" },
  { left: "87%", top: "39%", size: 16, delay: "-.5s", duration: "6.1s", drift: "-6px" },
  { left: "92%", top: "77%", size: 11, delay: "-3s", duration: "5.7s", drift: "4px" },
  { left: "59%", top: "79%", size: 10, delay: "-5.1s", duration: "6.6s", drift: "7px" }
];

function WalletCoinScatter() {
  return (
    <div className="wallet-coin-scatter" aria-hidden="true">
      {WALLET_COINS.map((coin, index) => (
        <span
          key={index}
          className="wallet-scatter-coin"
          style={{ left: coin.left, top: coin.top, width: coin.size, height: coin.size, fontSize: Math.max(7, Math.round(coin.size * .42)), "--delay": coin.delay, "--duration": coin.duration, "--drift-x": coin.drift }}
        >
          ¥
        </span>
      ))}
    </div>
  );
}

function AnimatedWalletBalance({ value }) {
  const [displayValue, setDisplayValue] = useState(0);
  const displayedValueRef = useRef(0);

  useEffect(() => {
    const from = displayedValueRef.current;
    if (from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedValueRef.current = value;
      setDisplayValue(value);
      return undefined;
    }

    const startedAt = performance.now();
    const duration = 700;
    let animationFrame;
    function update(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(from + (value - from) * eased);
      displayedValueRef.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) animationFrame = window.requestAnimationFrame(update);
    }
    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [value]);

  return <strong className="wallet-balance mt-2 block text-4xl sm:text-5xl" aria-label={`钱包余额 ${value} 元`}><span aria-hidden="true">¥{displayValue.toLocaleString("zh-CN")}</span></strong>;
}

function Stat({ label, value, detail, tone = "default" }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5"><strong className={`truncate text-xl ${tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-foreground"}`}>{value}</strong></div>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function RecordPhotoThumbnail({ entry, onOpen }) {
  const [failed, setFailed] = useState(false);
  if (!entry.imageUrl || failed) {
    return <span className="grid h-10 w-10 place-items-center rounded-md border bg-stone-50 text-stone-400" title="无保存照片"><ImageIcon className="h-4 w-4" /></span>;
  }
  return (
    <button className="h-10 w-10 overflow-hidden rounded-md border bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={() => onOpen(entry)} aria-label={`查看 ${entry.date} 上传的照片`} title="查看上传照片">
      <img className="h-full w-full object-cover transition-transform hover:scale-105" src={entry.imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
    </button>
  );
}

export default function App() {
  const [dashboard, setDashboard] = useState(createInitialDashboard);
  const [authStatus, setAuthStatus] = useState({ loading: true, authenticated: false, setupRequired: false });
  const [range, setRange] = useState("recent");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recognized, setRecognized] = useState(null);
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [activeRecognitionJobId, setActiveRecognitionJobId] = useState("");
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ startWeight: "", goalWeight: "" });
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [photoCandidate, setPhotoCandidate] = useState(null);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [reward, setReward] = useState({ amount: 0, total: 0 });
  const [preview, setPreview] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [toast, setToast] = useState("");
  const [recordSaving, setRecordSaving] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const fileInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const recognitionJobRef = useRef("");
  const recognitionPollTimerRef = useRef(null);

  const stats = useMemo(() => getDashboardStats(dashboard), [dashboard]);
  const entries = useMemo(() => sortEntries(dashboard.entries), [dashboard.entries]);
  const visibleEntries = historyExpanded ? entries : entries.slice(0, 6);
  const trendEntries = useMemo(() => chartEntries(dashboard.entries, range), [dashboard.entries, range]);

  useEffect(() => {
    apiRequest("/api/admin/status")
      .then(async (status) => {
        setAiConfigured(status.aiConfigured);
        if (status.authenticated) {
          setDashboard(await apiRequest("/api/dashboard"));
          apiRequest("/api/recognition-jobs/active")
            .then(({ job }) => job && monitorRecognitionJob(job, true))
            .catch(() => {});
        }
        setDataLoading(false);
        setAuthStatus({ loading: false, authenticated: status.authenticated, setupRequired: status.setupRequired });
      })
      .catch(() => {
        setDataLoading(false);
        setAuthStatus({ loading: false, authenticated: false, setupRequired: false });
        setAiConfigured(false);
      });
    return () => window.clearTimeout(recognitionPollTimerRef.current);
  }, []);

  function notify(message, duration = 2800) {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), duration);
  }

  async function handleAuthenticated() {
    try {
      const status = await apiRequest("/api/admin/status");
      if (status.authenticated) {
        setDashboard(await apiRequest("/api/dashboard"));
        apiRequest("/api/recognition-jobs/active")
          .then(({ job }) => job && monitorRecognitionJob(job, true))
          .catch(() => {});
      }
      setDataLoading(false);
      setAuthStatus({ loading: false, authenticated: status.authenticated, setupRequired: status.setupRequired });
      setAiConfigured(status.aiConfigured);
    } catch {
      setDataLoading(false);
      setAuthStatus((current) => ({ ...current, loading: false }));
    }
  }

  function stopRecognitionMonitor() {
    window.clearTimeout(recognitionPollTimerRef.current);
    recognitionPollTimerRef.current = null;
    recognitionJobRef.current = "";
    setActiveRecognitionJobId("");
  }

  function scheduleRecognitionPoll(jobId, delay = RECOGNITION_POLL_MS) {
    window.clearTimeout(recognitionPollTimerRef.current);
    recognitionPollTimerRef.current = window.setTimeout(() => pollRecognitionJob(jobId), delay);
  }

  function monitorRecognitionJob(job, openLoading) {
    if (!job?.jobId) return;
    recognitionJobRef.current = job.jobId;
    setActiveRecognitionJobId(job.jobId);
    if (job.imageUrl) setPreview(job.imageUrl);

    if (job.status === "queued" || job.status === "running") {
      if (openLoading) setLoadingOpen(true);
      scheduleRecognitionPoll(job.jobId);
      return;
    }
    if (job.status === "succeeded" && job.result) {
      stopRecognitionMonitor();
      setLoadingOpen(false);
      setRecognized({
        weight: Number(job.result.weight),
        confidence: Math.round(job.result.confidence),
        recognitionId: job.result.recognitionId
      });
      setRecordOpen(true);
      return;
    }
    stopRecognitionMonitor();
    setLoadingOpen(false);
    if (job.status === "failed") {
      if (job.error?.code === "AI_NOT_CONFIGURED") setAiConfigured(false);
      notify(job.error?.message || "识别失败，请重新上传", 4200);
    }
  }

  async function pollRecognitionJob(jobId) {
    if (recognitionJobRef.current !== jobId) return;
    try {
      const job = await apiRequest(`/api/recognition-jobs/${encodeURIComponent(jobId)}`);
      if (recognitionJobRef.current === jobId) monitorRecognitionJob(job, false);
    } catch (error) {
      if (recognitionJobRef.current !== jobId) return;
      if (error.code === "RECOGNITION_JOB_NOT_FOUND") {
        stopRecognitionMonitor();
        setLoadingOpen(false);
        notify("图片未能完整上传，请重新选择", 4200);
        return;
      }
      scheduleRecognitionPoll(jobId, 3000);
    }
  }

  function openRecord() {
    if (activeRecognitionJobId) {
      setLoadingOpen(true);
      return;
    }
    setRecognized(null);
    setRecordOpen(true);
  }

  async function startRecognition(file) {
    if (!file) return;
    if (!aiConfigured) {
      notify("请先配置 AI 识图服务", 4000);
      setSettingsOpen(true);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      notify("请选择 PNG、JPEG 或 WebP 图片", 4000);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      notify("图片不能超过 8 MB", 4000);
      return;
    }
    try {
      const image = await readFileAsDataUrl(file);
      const jobId = createRecognitionJobId();
      setPreview(image);
      setRecordOpen(false);
      setLoadingOpen(true);
      recognitionJobRef.current = jobId;
      setActiveRecognitionJobId(jobId);
      const job = await apiRequest("/api/recognize-weight", { method: "POST", body: JSON.stringify({ image, jobId }) });
      monitorRecognitionJob(job, false);
    } catch (error) {
      const jobId = recognitionJobRef.current;
      if (!error.status && jobId) {
        notify("网络连接中断，正在从后台恢复识别任务", 4200);
        scheduleRecognitionPoll(jobId, 1500);
      } else {
        stopRecognitionMonitor();
        setLoadingOpen(false);
        if (error.code === "AI_NOT_CONFIGURED") setAiConfigured(false);
        notify(error.code === "AI_NOT_CONFIGURED" ? "AI 服务尚未配置" : error.message || "识别失败，请重试", 4200);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function saveRecord() {
    if (!recognized?.recognitionId || recordSaving) return;
    setRecordSaving(true);
    try {
      const result = await apiRequest("/api/weight-records/confirm", { method: "POST", body: JSON.stringify({ recognitionId: recognized.recognitionId }) });
      setDashboard(result.dashboard);
      setRecordOpen(false);
      if (result.rewardDelta > 0 && !result.replaced) {
        setReward({ amount: result.rewardDelta, total: result.entry.reward });
        setRewardOpen(true);
      } else notify(result.replaced ? "已更新当天的 AI 记录" : "AI 记录已保存");
    } catch (error) {
      notify(error.message || "记录保存失败，请重新识别", 4200);
      setRecognized(null);
    } finally {
      setRecordSaving(false);
    }
  }

  function openGoalSettings() {
    setGoalDraft({
      startWeight: kgToJin(dashboard.profile.startWeight).toFixed(1),
      goalWeight: kgToJin(dashboard.profile.goalWeight).toFixed(1)
    });
    setGoalOpen(true);
  }

  async function saveGoal(event) {
    event.preventDefault();
    const startWeightJin = Number(goalDraft.startWeight);
    const goalWeightJin = Number(goalDraft.goalWeight);
    if (![startWeightJin, goalWeightJin].every((value) => Number.isFinite(value) && value >= 60 && value <= 500)) {
      notify("请输入 60 至 500 斤之间的有效体重", 3800);
      return;
    }
    if (goalWeightJin >= startWeightJin) {
      notify("目标体重需要低于起始体重", 3800);
      return;
    }
    try {
      const startWeight = jinToKg(startWeightJin);
      const goalWeight = jinToKg(goalWeightJin);
      setDashboard(await apiRequest("/api/dashboard/profile", { method: "PUT", body: JSON.stringify({ startWeight, goalWeight }) }));
      setGoalOpen(false);
      notify("体重目标已更新");
    } catch (error) {
      notify(error.message || "目标更新失败", 3800);
    }
  }

  async function deleteEntry() {
    if (!deleteCandidate) return;
    try {
      setDashboard(await apiRequest(`/api/weight-records/${encodeURIComponent(deleteCandidate.id)}`, { method: "DELETE" }));
      setDeleteCandidate(null);
      notify("记录已删除，相关统计已重新计算");
    } catch (error) {
      notify(error.message || "记录删除失败", 3800);
    }
  }

  if (authStatus.loading || (authStatus.authenticated && dataLoading)) {
    return <div className="login-page grid min-h-screen place-items-center"><div className="text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-primary text-white shadow-peach"><TrendingDown className="h-6 w-6" /></span><LoaderCircle className="mx-auto mt-5 h-5 w-5 animate-spin text-primary" /></div></div>;
  }

  if (!authStatus.authenticated) return <LoginScreen setupRequired={authStatus.setupRequired} onAuthenticated={handleAuthenticated} />;

  return (
    <div className="min-h-screen bg-app text-foreground">
      <div className="mx-auto flex w-full max-w-[1440px] gap-6 px-4 pb-24 pt-4 sm:px-6 lg:px-7 lg:py-7">
        <aside className="sticky top-7 hidden h-[calc(100vh-3.5rem)] w-[210px] shrink-0 flex-col border-r border-stone-200/80 pr-5 lg:flex">
          <a href="#overview" className="flex h-12 items-center gap-3" aria-label="轻盈首页">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white shadow-peach"><TrendingDown className="h-5 w-5" /></span>
            <span><strong className="block text-base">轻盈</strong><small className="block text-[9px] text-muted-foreground">AI 体重记录</small></span>
          </a>
          <nav className="mt-9 space-y-1" aria-label="主要导航">
            <a className="side-link active" href="#overview"><LayoutDashboard />概览</a>
            <a className="side-link" href="#trend"><ChartNoAxesCombined />趋势</a>
            <a className="side-link" href="#history"><ClipboardList />记录</a>
            <a className="side-link" href="#wallet"><WalletCards />钱包</a>
          </nav>
          <div className="mt-auto space-y-2">
            <button className="side-link w-full" type="button" onClick={openGoalSettings}><Target />目标设置</button>
            <button className="side-link w-full" type="button" onClick={() => setSettingsOpen(true)}><Settings />系统设置</button>
          </div>
        </aside>

        <main id="overview" className="min-w-0 flex-1">
          <header className="flex h-12 items-center justify-between">
            <a href="#overview" className="flex items-center gap-3 lg:hidden" aria-label="轻盈首页"><span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white"><TrendingDown className="h-5 w-5" /></span><strong>轻盈</strong></a>
            <div className="hidden lg:block"><p className="text-sm font-semibold">健康概览</p><p className="mt-0.5 text-[10px] text-muted-foreground">{currentDateLabel()}</p></div>
            <div className="ml-auto flex items-center gap-2">
              <button className="hidden items-center gap-2 rounded-md border bg-white/70 px-3 py-2 text-left md:flex" type="button" onClick={() => !aiConfigured && setSettingsOpen(true)}>
                <span className={`h-2 w-2 rounded-full ${aiConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span><small className="block text-[9px] text-muted-foreground">AI 识图</small><strong className="block text-[10px]">{aiConfigured ? "服务可用" : "待配置"}</strong></span>
              </button>
              <Button variant="outline" size="icon" className="relative bg-white/70" onClick={() => notify(entries[0]?.date === todayKey() ? "今天的体重已记录" : "今天还没有记录体重")} aria-label="记录提醒" title="记录提醒"><Bell className="h-4 w-4" />{entries[0]?.date !== todayKey() && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}</Button>
              <Button variant="outline" size="icon" className="bg-white/70" onClick={() => setSettingsOpen(true)} aria-label="系统设置" title="系统设置"><Settings className="h-4 w-4" /></Button>
            </div>
          </header>

          <section className="flex flex-col gap-4 pb-5 pt-7 sm:flex-row sm:items-end sm:justify-between lg:pt-9">
            <div><p className="text-xs text-muted-foreground">{entries[0]?.date === todayKey() ? "今日记录已完成" : "今天，从一次记录开始"}</p><h1 className="mt-1.5 text-2xl font-bold leading-tight sm:text-[28px]">体重管理工作台</h1></div>
            <Button size="lg" className="w-full sm:w-auto" onClick={openRecord}>{activeRecognitionJobId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{activeRecognitionJobId ? "后台识别中" : "AI 识别并记录"}</Button>
          </section>

          <Card id="wallet" className="wallet-surface relative isolate mb-5 scroll-mt-6 overflow-hidden border-0 text-white shadow-peach ring-1 ring-white/30">
            <WalletCoinScatter />
            <CardContent className="relative z-10 flex min-h-36 items-center justify-between gap-5 p-5 sm:min-h-40 sm:p-6">
              <div className="min-w-0"><p className="text-sm font-semibold text-white">轻盈钱包</p><p className="mt-1 text-[11px] text-white/75">当前累计奖励</p><AnimatedWalletBalance value={stats.wallet} /><p className="mt-3 text-[11px] text-white/80">较起始体重每减 0.2 斤，累计奖励 20 元</p></div>
              <span className="wallet-icon-motion grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-white/25 bg-white/15 shadow-sm backdrop-blur-sm" aria-hidden="true"><WalletCards className="h-7 w-7 text-white" /></span>
            </CardContent>
          </Card>

          <section className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-lg border bg-white/60 md:grid-cols-4 md:divide-y-0" aria-label="关键指标">
            <Stat label="当前体重" value={stats.hasEntries ? formatWeightJin(stats.current) : "--"} detail={stats.hasEntries ? (entries.length > 1 ? `较上次 ${signedWeight(stats.lastChange)}` : "首次 AI 识别记录") : "等待首次 AI 识别"} tone={stats.hasEntries && stats.lastChange <= 0 ? "good" : stats.hasEntries ? "warn" : "default"} />
            <Stat label="累计变化" value={stats.hasEntries ? `${stats.totalLoss >= 0 ? "-" : "+"}${kgToJin(Math.abs(stats.totalLoss)).toFixed(1)} 斤` : "--"} detail={stats.hasEntries ? `起始 ${formatWeightJin(dashboard.profile.startWeight)}` : "暂无可计算数据"} tone={stats.totalLoss > 0 ? "good" : "default"} />
            <Stat label="距离目标" value={stats.hasEntries ? formatWeightJin(stats.remaining) : "--"} detail={stats.hasEntries ? `目标 ${formatWeightJin(dashboard.profile.goalWeight)}` : "首次识别后计算"} />
            <Stat label="连续记录" value={`${stats.streak} 天`} detail={stats.streak ? "保持稳定记录" : "今天可以重新开始"} />
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(310px,.75fr)_minmax(0,1.55fr)]">
            <Card id="trend" className="scroll-mt-6 border-stone-200/80 bg-white/80 shadow-soft xl:col-start-2 xl:row-start-1">
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-0">
                <div><p className="text-xs font-medium text-muted-foreground">体重趋势</p><div className="mt-2 flex items-baseline gap-2"><strong className="text-4xl leading-none">{stats.hasEntries ? kgToJin(stats.current).toFixed(1) : "--"}</strong>{stats.hasEntries && <span className="text-sm text-muted-foreground">斤</span>}</div><p className={`mt-2 text-xs ${stats.hasEntries && stats.monthChange <= 0 ? "text-emerald-700" : "text-muted-foreground"}`}>{stats.hasEntries ? `近 30 天 ${signedWeight(stats.monthChange)}` : "等待首次 AI 识别"}</p></div>
                <Tabs value={range} onValueChange={setRange}><TabsList><TabsTrigger value="recent">近 7 次</TabsTrigger><TabsTrigger value="month">30 天</TabsTrigger></TabsList></Tabs>
              </CardHeader>
              <CardContent className="pt-2"><WeightChart entries={trendEntries} goalWeight={dashboard.profile.goalWeight} /></CardContent>
            </Card>

            <aside className="grid content-start gap-4 xl:col-start-1 xl:row-start-1">
              <Card className="border-stone-200/80 bg-white/80 shadow-soft">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">{activeRecognitionJobId ? "后台任务" : "今天记一下"}</p><p className="mt-1 text-sm font-semibold">{activeRecognitionJobId ? "AI 正在识别已上传的图片" : "只使用 AI 识别，保证数据一致"}</p></div><Scale className="h-5 w-5 text-primary" /></div>
                  <Button variant="secondary" className="mt-4 h-20 w-full justify-center" onClick={openRecord}>{activeRecognitionJobId ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}{activeRecognitionJobId ? "查看识别进度" : "上传截图开始识别"}{!activeRecognitionJobId && <UploadCloud className="ml-auto h-4 w-4" />}</Button>
                  <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground"><ShieldCheck className="h-3 w-3 text-emerald-600" />截图将随记录安全保存在服务器中</p>
                </CardContent>
              </Card>

              <Card className="border-stone-200/80 bg-white/60 shadow-none">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between"><div><p className="text-xs text-muted-foreground">目标进度</p><p className="mt-1 text-sm font-semibold">已完成 {Math.round(stats.progress)}%</p></div><Button variant="ghost" size="icon" onClick={openGoalSettings} aria-label="修改目标" title="修改目标"><Pencil className="h-4 w-4" /></Button></div>
                  <Progress value={stats.progress} className="mt-4 h-2 bg-emerald-100 [&>div]:bg-emerald-600" />
                  <div className="mt-3 flex justify-between text-[10px] text-muted-foreground"><span>{formatWeightJin(dashboard.profile.startWeight)}</span><span>{formatWeightJin(dashboard.profile.goalWeight)}</span></div>
                </CardContent>
              </Card>
            </aside>
          </div>

          <section id="history" className="scroll-mt-6 pt-8">
            <div className="flex items-end justify-between"><div><p className="text-xs text-muted-foreground">历史记录</p><h2 className="mt-1 text-lg font-semibold">最近的体重变化</h2></div><Badge variant="outline" className="bg-white/60">共 {entries.length} 条</Badge></div>
            <div className="mt-4 overflow-hidden rounded-lg border bg-white/70">
              <div className="hidden grid-cols-[1.1fr_52px_.75fr_.75fr_.8fr_.65fr_40px] gap-3 border-b bg-stone-50/80 px-5 py-3 text-[10px] text-muted-foreground md:grid"><span>日期</span><span>照片</span><span>体重</span><span>较上次</span><span>记录方式</span><span>累计奖励</span><span /></div>
              {visibleEntries.map((entry, index) => {
                const nextOlder = entries[entries.findIndex((item) => item.id === entry.id) + 1];
                const change = nextOlder ? entry.weight - nextOlder.weight : 0;
                return (
                  <div key={entry.id} className="grid grid-cols-[1fr_40px_auto_32px] items-center gap-3 border-b px-4 py-3 last:border-0 md:grid-cols-[1.1fr_52px_.75fr_.75fr_.8fr_.65fr_40px] md:px-5">
                    <div><strong className="text-sm md:font-medium">{formatEntryDate(entry.date, true)}</strong><p className="mt-0.5 text-[10px] text-muted-foreground md:hidden">AI 识图</p></div>
                    <RecordPhotoThumbnail entry={entry} onOpen={setPhotoCandidate} />
                    <strong className="text-right text-sm md:text-left">{formatWeightJin(entry.weight)}</strong>
                    <span className={`hidden text-xs md:block ${change < 0 ? "text-emerald-700" : change > 0 ? "text-amber-700" : "text-muted-foreground"}`}>{nextOlder ? signedWeight(change) : "起始记录"}</span>
                    <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex"><Sparkles className="h-3.5 w-3.5 text-primary" />AI {entry.confidence || "--"}%</span>
                    <span className="hidden text-xs md:block">{entry.reward ? <span className="text-emerald-700">¥{entry.reward}</span> : "--"}</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setDeleteCandidate(entry)} aria-label={`删除 ${entry.date} 的记录`} title="删除记录"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                );
              })}
              {!entries.length && <div className="grid min-h-32 place-items-center px-4 py-8 text-center"><div><ClipboardList className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm text-muted-foreground">暂无记录</p><p className="mt-1 text-[10px] text-muted-foreground">完成首次 AI 识别后会显示在这里</p></div></div>}
              {entries.length > 6 && <button className="flex w-full items-center justify-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground hover:bg-stone-50" type="button" onClick={() => setHistoryExpanded((value) => !value)}>{historyExpanded ? "收起记录" : `查看全部 ${entries.length} 条记录`}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${historyExpanded ? "rotate-180" : ""}`} /></button>}
            </div>
          </section>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_30px_rgba(42,38,34,.08)] backdrop-blur-lg lg:hidden" aria-label="移动导航">
        <a className="mobile-nav active" href="#overview"><LayoutDashboard />概览</a>
        <a className="mobile-nav" href="#trend"><ChartNoAxesCombined />趋势</a>
        <button className="mobile-nav" type="button" onClick={openRecord}><span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white">{activeRecognitionJobId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}</span>{activeRecognitionJobId ? "处理中" : "识别"}</button>
        <a className="mobile-nav" href="#history"><ClipboardList />历史</a>
      </nav>

      {settingsOpen && <Suspense fallback={null}><AdminSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onConfigured={setAiConfigured} notify={notify} onSessionEnd={() => { setSettingsOpen(false); setAuthStatus((current) => ({ ...current, authenticated: false })); }} /></Suspense>}

      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader><DialogTitle>{recognized ? "确认 AI 识别结果" : "AI 识别体重"}</DialogTitle><DialogDescription>{recognized ? "数值已通过可信度校验，确认后将按今天的日期保存。" : "上传体重秤或智能秤 App 截图，系统只接受高可信度结果。"}</DialogDescription></DialogHeader>
          {recognized ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"><img className="h-20 w-20 rounded-md object-cover" src={preview} alt="本次识别的体重截图" /><div><p className="text-xs text-emerald-700">识别到的体重</p><strong className="mt-1 block text-4xl text-emerald-800">{kgToJin(recognized.weight).toFixed(1)} <span className="text-sm font-normal">斤</span></strong></div></div>
              <div className="flex items-center justify-between rounded-md bg-stone-100 px-3 py-2.5 text-xs"><span>AI 识别可信度</span><strong className="text-emerald-700">{recognized.confidence}% · 已达到 85% 保存标准</strong></div>
              <p className="text-center text-[11px] text-muted-foreground">为保证数据可靠性，体重数值不可手动修改；如结果不符合截图，请重新上传。</p>
              <div className="grid grid-cols-2 gap-2"><Button variant="outline" size="lg" onClick={() => { setRecognized(null); fileInputRef.current?.click(); }}><ImageUp className="h-4 w-4" />重新上传</Button><Button size="lg" onClick={saveRecord}><Check className="h-4 w-4" />确认保存</Button></div>
            </div>
          ) : (
            <div>
              <button className="group grid min-h-56 w-full place-items-center rounded-lg border border-dashed border-stone-300 bg-stone-50/70 p-6 text-center transition-colors hover:border-primary hover:bg-red-50/30" type="button" onClick={() => { if (aiConfigured) fileInputRef.current?.click(); else { setRecordOpen(false); setSettingsOpen(true); } }}>
                <span><span className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-white text-primary shadow-sm"><UploadCloud className="h-5 w-5" /></span><strong className="mt-4 block text-sm">{aiConfigured ? "选择体重截图" : "先配置 AI 识图服务"}</strong><small className="mt-2 block text-[11px] font-normal text-muted-foreground">{aiConfigured ? "支持 PNG、JPEG、WebP，最大 8 MB" : "配置 API Key 后即可自动识别"}</small></span>
              </button>
              {!aiConfigured && <Button variant="outline" className="mt-3 w-full" onClick={() => { setRecordOpen(false); setSettingsOpen(true); }}><Settings className="h-4 w-4" />前往系统设置</Button>}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => startRecognition(event.target.files?.[0])} />

      <Dialog open={loadingOpen} onOpenChange={setLoadingOpen}>
        <DialogContent className="max-w-sm text-center"><div className="scan-preview mx-auto"><img src={preview} alt="待识别的体重截图" /><span className="animate-scan" /></div><DialogHeader className="items-center"><LoaderCircle className="h-5 w-5 animate-spin text-primary" /><DialogTitle>后台识别中</DialogTitle><DialogDescription>原图已保存到服务器，关闭窗口或暂时断网不会中断识别。</DialogDescription></DialogHeader><Button variant="outline" onClick={() => setLoadingOpen(false)}>在后台继续</Button></DialogContent>
      </Dialog>

      <Dialog open={Boolean(photoCandidate)} onOpenChange={(open) => !open && setPhotoCandidate(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>记录照片</DialogTitle><DialogDescription>{photoCandidate ? `${formatEntryDate(photoCandidate.date, true)} · ${formatWeightJin(photoCandidate.weight)}` : ""}</DialogDescription></DialogHeader>
          {photoCandidate?.imageUrl && <div className="grid max-h-[70vh] min-h-64 place-items-center overflow-hidden rounded-md bg-stone-100"><img className="max-h-[70vh] w-full object-contain" src={photoCandidate.imageUrl} alt={`${photoCandidate.date} 上传的体重截图`} /></div>}
        </DialogContent>
      </Dialog>

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
        <DialogContent className="sm:max-w-[420px]"><DialogHeader><div className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-secondary text-emerald-700"><Target className="h-5 w-5" /></div><DialogTitle>设置体重目标</DialogTitle><DialogDescription>起始体重用于计算累计变化，目标体重用于计算进度。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={saveGoal}><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="start-weight">起始体重（斤）</Label><Input id="start-weight" type="number" min="60" max="500" step="0.1" value={goalDraft.startWeight} onChange={(event) => setGoalDraft((value) => ({ ...value, startWeight: event.target.value }))} required /></div><div className="space-y-2"><Label htmlFor="goal-weight">目标体重（斤）</Label><Input id="goal-weight" type="number" min="60" max="500" step="0.1" value={goalDraft.goalWeight} onChange={(event) => setGoalDraft((value) => ({ ...value, goalWeight: event.target.value }))} required /></div></div><Button className="w-full" size="lg">保存目标</Button></form></DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteCandidate)} onOpenChange={(open) => !open && setDeleteCandidate(null)}>
        <DialogContent className="sm:max-w-[390px]"><DialogHeader><DialogTitle>删除这条记录？</DialogTitle><DialogDescription>{deleteCandidate ? `${formatEntryDate(deleteCandidate.date, true)} · ${formatWeightJin(deleteCandidate.weight)}` : ""}。删除后趋势、进度和该条记录的奖励会同步更新。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteCandidate(null)}>取消</Button><Button variant="destructive" onClick={deleteEntry}><Trash2 className="h-4 w-4" />删除记录</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={rewardOpen} onOpenChange={setRewardOpen}>
        {rewardOpen && <CoinRain />}
        <DialogContent className="z-[70] max-w-sm text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-[6px] border-[#ffd570] bg-[#f5b64f] font-serif text-3xl font-bold text-white shadow-peach">¥</div><DialogHeader className="items-center"><DialogDescription>轻盈奖励到账</DialogDescription><DialogTitle className="text-3xl text-primary">+¥{reward.amount}</DialogTitle><DialogDescription>当前累计奖励 ¥{reward.total}</DialogDescription></DialogHeader><Button size="lg" className="bg-stone-900 hover:bg-stone-800" onClick={() => setRewardOpen(false)}>收下奖励</Button></DialogContent>
      </Dialog>

      <Toast message={toast} />
    </div>
  );
}
