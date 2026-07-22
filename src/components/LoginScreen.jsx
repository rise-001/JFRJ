import { useState } from "react";
import { ArrowRight, Database, Eye, EyeOff, Fingerprint, LoaderCircle, LockKeyhole, ScanLine, ShieldCheck, TrendingDown } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen({ setupRequired, onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (setupRequired && password !== passwordConfirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest(setupRequired ? "/api/admin/setup" : "/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      await onAuthenticated();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  const passwordType = showPassword ? "text" : "password";
  const clearError = () => error && setError("");

  return (
    <div className="login-page grid min-h-screen place-items-center px-4 py-5 sm:px-7 sm:py-8">
      <main className="grid w-full max-w-[1040px] overflow-hidden rounded-lg border border-[#dce2df] bg-white shadow-[0_30px_90px_rgba(31,37,34,.12)] lg:min-h-[620px] lg:grid-cols-[.88fr_1.12fr]">
        <aside className="relative hidden overflow-hidden bg-[#282d2b] p-10 text-white lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#d9665d] text-white shadow-[0_12px_28px_rgba(0,0,0,.2)]"><TrendingDown className="h-5 w-5" /></span>
            <span><strong className="block text-base">轻盈</strong><small className="block text-[9px] text-white/60">AI WEIGHT JOURNAL</small></span>
          </div>

          <div className="my-auto py-12">
            <div className="flex h-40 items-center justify-center border-y border-white/10">
              <div className="relative grid h-24 w-24 place-items-center rounded-full border border-white/25 bg-white/[.03] text-white">
                <ScanLine className="h-9 w-9" />
                <span className="absolute -right-1 top-3 h-3 w-3 rounded-full border-2 border-[#282d2b] bg-[#e4776e]" />
              </div>
            </div>
            <p className="mt-9 text-[11px] font-semibold text-[#f0a59e]">可靠识别，认真记录</p>
            <h1 className="mt-3 max-w-xs text-[32px] font-semibold leading-[1.35]">让每一次变化<br />都有清晰依据</h1>
            <p className="mt-4 max-w-xs text-xs leading-6 text-white/60">体重记录只接受通过可信度校验的 AI 识别结果。</p>
          </div>

          <div className="grid grid-cols-2 border-t border-white/10 pt-5 text-[10px] text-white/60">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-[#8fc9ad]" />加密会话</span>
            <span className="flex items-center justify-end gap-2"><Database className="h-4 w-4 text-[#8fc9ad]" />SQLite</span>
          </div>
        </aside>

        <section className="flex min-h-[620px] items-center bg-[#fcfdfc] px-6 py-10 sm:px-12 lg:px-16">
          <div className="mx-auto w-full max-w-[380px]">
            <div className="mb-10 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#b84f47] text-white"><TrendingDown className="h-5 w-5" /></span><span><strong className="block text-sm">轻盈</strong><small className="block text-[9px] text-muted-foreground">AI 体重记录</small></span></div>
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
            </div>

            <span className="grid h-11 w-11 place-items-center rounded-lg bg-[#f8e8e5] text-[#a9453e]"><LockKeyhole className="h-5 w-5" /></span>
            <p className="mt-6 text-[11px] font-semibold text-[#a9453e]">{setupRequired ? "首次初始化" : "管理员身份验证"}</p>
            <h2 className="mt-2 text-2xl font-bold">{setupRequired ? "创建管理员密码" : "欢迎回来"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{setupRequired ? "完成安全设置后进入工作台" : "输入管理员密码进入轻盈工作台"}</p>

            <form className="mt-8 space-y-5" onSubmit={submit}>
              <div className="space-y-2">
                <Label htmlFor="login-password">管理员密码</Label>
                <div className="relative">
                  <Fingerprint className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" />
                  <Input id="login-password" className="h-12 border-[#cfd7d3] bg-white pl-10 pr-11 shadow-none focus-visible:border-[#b84f47] focus-visible:ring-[#b84f47]/20" type={passwordType} value={password} onChange={(event) => { setPassword(event.target.value); clearError(); }} minLength={8} maxLength={128} autoComplete={setupRequired ? "new-password" : "current-password"} placeholder="至少 8 位" autoFocus required />
                  <button className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-md text-muted-foreground hover:bg-stone-100 hover:text-foreground" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"} title={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                </div>
              </div>

              {setupRequired && <div className="space-y-2"><Label htmlFor="login-password-confirm">确认密码</Label><div className="relative"><Fingerprint className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-muted-foreground" /><Input id="login-password-confirm" className="h-12 border-[#cfd7d3] bg-white pl-10 shadow-none focus-visible:border-[#b84f47] focus-visible:ring-[#b84f47]/20" type={passwordType} value={passwordConfirm} onChange={(event) => { setPasswordConfirm(event.target.value); clearError(); }} minLength={8} maxLength={128} autoComplete="new-password" placeholder="再次输入密码" required /></div></div>}

              {error && <p role="alert" className="rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-destructive">{error}</p>}
              <Button className="h-12 w-full bg-[#b84f47] text-white shadow-none hover:bg-[#a3413a] focus-visible:ring-[#b84f47]/30" disabled={busy}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{setupRequired ? "创建并进入" : "安全登录"}</Button>
            </form>

            <div className="mt-7 flex items-center justify-center gap-2 border-t pt-5 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />密码哈希保护 · 会话到期自动退出</div>
          </div>
        </section>
      </main>
    </div>
  );
}
