import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, LogOut, Save, ScanText, Settings2, ShieldCheck, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function AdminSettingsDialog({ open, onOpenChange, onConfigured, notify, onSessionEnd }) {
  const [view, setView] = useState("loading");
  const [setupMode, setSetupMode] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState({ apiUrl: "", model: "", apiKey: "", recognitionEngine: "vision", ddddocrUrl: "", jsonMode: true, apiKeyConfigured: false, apiKeyMask: "", recognitionConfigured: false });
  const [settingsError, setSettingsError] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const recognitionConfigured = settings.recognitionEngine === "ddddocr"
    ? Boolean(settings.ddddocrUrl)
    : settings.apiKeyConfigured || Boolean(settings.apiKey.trim());

  async function loadSettings() {
    const data = await apiRequest("/api/admin/settings");
    setSettings({ ...data, apiKey: "" });
    setView("settings");
  }

  useEffect(() => {
    if (!open) return;
    setView("loading");
    setAuthError("");
    apiRequest("/api/admin/status")
      .then(async (status) => {
        onConfigured(status.aiConfigured);
        if (status.authenticated) await loadSettings();
        else {
          setSetupMode(status.setupRequired);
          setView("auth");
        }
      })
      .catch((error) => {
        setView("auth");
        setAuthError(error.message);
      });
  }, [open]);

  async function handleAuth(event) {
    event.preventDefault();
    if (setupMode && password !== passwordConfirm) {
      setAuthError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setAuthError("");
    try {
      await apiRequest(setupMode ? "/api/admin/setup" : "/api/admin/login", { method: "POST", body: JSON.stringify({ password }) });
      setPassword("");
      setPasswordConfirm("");
      await loadSettings();
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    setBusy(true);
    setSettingsError("");
    try {
      const data = await apiRequest("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ apiUrl: settings.apiUrl, model: settings.model, apiKey: settings.apiKey, recognitionEngine: settings.recognitionEngine, ddddocrUrl: settings.ddddocrUrl, jsonMode: settings.jsonMode })
      });
      setSettings({ ...data, apiKey: "" });
      onConfigured(data.recognitionConfigured);
      notify("识别配置已安全保存");
    } catch (error) {
      setSettingsError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordChange(event) {
    event.preventDefault();
    setBusy(true);
    setSettingsError("");
    try {
      await apiRequest("/api/admin/password", { method: "PUT", body: JSON.stringify({ currentPassword, nextPassword }) });
      setCurrentPassword("");
      setNextPassword("");
      notify("密码已更新，请重新登录");
      onSessionEnd();
    } catch (error) {
      setSettingsError(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await apiRequest("/api/admin/logout", { method: "POST" });
    notify("已退出管理员登录");
    onSessionEnd();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
        {view === "loading" && (
          <div className="grid min-h-56 place-items-center text-muted-foreground">
            <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
          </div>
        )}

        {view === "auth" && (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-3 grid h-14 w-14 place-items-center rounded-lg bg-gradient-to-br from-[#ef9b91] to-[#7eb7a3] text-white shadow-soft"><ShieldCheck className="h-7 w-7" /></div>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">{setupMode ? "首次使用" : "系统管理"}</Badge>
              <DialogTitle className="pt-2 text-xl">{setupMode ? "创建管理员密码" : "管理员登录"}</DialogTitle>
              <DialogDescription>{setupMode ? "此密码用于保护模型配置与 API Key" : "登录后管理识图模型配置"}</DialogDescription>
            </DialogHeader>
            <form className="space-y-4 pt-2" onSubmit={handleAuth}>
              <div className="space-y-2"><Label htmlFor="admin-password">管理员密码</Label><Input id="admin-password" type="password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={setupMode ? "new-password" : "current-password"} placeholder="至少 8 位" required /></div>
              {setupMode && <div className="space-y-2"><Label htmlFor="admin-password-confirm">确认密码</Label><Input id="admin-password-confirm" type="password" minLength={8} maxLength={128} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} autoComplete="new-password" placeholder="再次输入密码" required /></div>}
              {authError && <p className="text-sm text-destructive">{authError}</p>}
              <Button className="w-full" size="lg" disabled={busy}>{busy && <LoaderCircle className="h-4 w-4 animate-spin" />}{setupMode ? "创建并进入系统" : "登录"}</Button>
            </form>
          </>
        )}

        {view === "settings" && (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between pr-8">
                <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-primary"><Settings2 className="h-5 w-5" /></div><div><DialogTitle>识别设置</DialogTitle><DialogDescription className="mt-1">选择体重图片识别引擎</DialogDescription></div></div>
                <Badge className={recognitionConfigured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"} variant="outline"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current" />{recognitionConfigured ? "已配置" : "待配置"}</Badge>
              </div>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleSave}>
              <div className="grid grid-cols-2 gap-1 rounded-md border bg-stone-100 p-1" role="group" aria-label="识别引擎">
                <button type="button" aria-pressed={settings.recognitionEngine === "vision"} className={`flex min-h-11 items-center justify-center gap-2 rounded px-3 text-xs font-medium transition-colors ${settings.recognitionEngine === "vision" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSettings((value) => ({ ...value, recognitionEngine: "vision" }))}><Sparkles className="h-4 w-4" />视觉大模型</button>
                <button type="button" aria-pressed={settings.recognitionEngine === "ddddocr"} className={`flex min-h-11 items-center justify-center gap-2 rounded px-3 text-xs font-medium transition-colors ${settings.recognitionEngine === "ddddocr" ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`} onClick={() => setSettings((value) => ({ ...value, recognitionEngine: "ddddocr" }))}><ScanText className="h-4 w-4" />ddddocr</button>
              </div>
              {settings.recognitionEngine === "vision" ? (
                <>
                  <div className="space-y-2"><Label htmlFor="api-url">API 地址</Label><Input id="api-url" type="url" value={settings.apiUrl} onChange={(event) => setSettings((value) => ({ ...value, apiUrl: event.target.value }))} required /></div>
                  <div className="space-y-2"><Label htmlFor="model-name">视觉模型</Label><Input id="model-name" value={settings.model} onChange={(event) => setSettings((value) => ({ ...value, model: event.target.value }))} required /></div>
                  <div className="space-y-2"><Label htmlFor="api-key">API Key</Label><div className="relative"><KeyRound className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="api-key" className="pl-9" type="password" value={settings.apiKey} onChange={(event) => setSettings((value) => ({ ...value, apiKey: event.target.value }))} placeholder={settings.apiKeyConfigured ? "留空则保留现有 Key" : "输入 API Key"} /></div>{settings.apiKeyConfigured && <p className="text-xs text-muted-foreground">已配置 {settings.apiKeyMask}</p>}</div>
                  <div className="flex items-center justify-between border-y py-4"><div><Label htmlFor="json-mode">JSON 输出模式</Label><p className="mt-1 text-xs text-muted-foreground">模型不支持 response_format 时关闭</p></div><Switch id="json-mode" checked={settings.jsonMode} onCheckedChange={(checked) => setSettings((value) => ({ ...value, jsonMode: checked }))} /></div>
                </>
              ) : (
                <div className="space-y-2"><Label htmlFor="ddddocr-url">ddddocr 服务地址</Label><Input id="ddddocr-url" type="url" value={settings.ddddocrUrl} onChange={(event) => setSettings((value) => ({ ...value, ddddocrUrl: event.target.value }))} placeholder="http://127.0.0.1:8000/recognize" required /><p className="text-xs text-muted-foreground">Docker 镜像已内置 ddddocr，默认地址无需修改</p></div>
              )}
              {settingsError && <p className="text-sm text-destructive">{settingsError}</p>}
              <Button className="w-full" size="lg" disabled={busy}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存识别配置</Button>
            </form>
            <div className="border-t pt-4">
              <Button variant="ghost" size="sm" className="px-0" onClick={() => setShowPasswordForm((value) => !value)}>修改管理员密码</Button>
              {showPasswordForm && <form className="mt-3 space-y-3" onSubmit={handlePasswordChange}><Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" required /><Input type="password" minLength={8} value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="新密码，至少 8 位" required /><Button variant="outline" className="w-full" disabled={busy}><CheckCircle2 className="h-4 w-4" />更新密码</Button></form>}
              <Button variant="ghost" className="mt-2 w-full text-destructive hover:bg-red-50 hover:text-destructive" onClick={logout}><LogOut className="h-4 w-4" />退出管理员登录</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
