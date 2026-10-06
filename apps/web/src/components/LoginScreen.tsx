import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import logoUrl from "../../images/ResQmap-logo-mono-black.svg";

type Props = {
  onAuthenticated: (email: string) => void;
  notice?: string | null;
};

export default function LoginScreen({ onAuthenticated, notice }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [error, setError] = useState<string | null>(notice || null);

  useEffect(() => setError(notice || null), [notice]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "idle") return;
    if (!email.trim() || !password) {
      setError("Please enter your official email and password.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) {
          setError("Too many attempts. Please wait a few minutes and try again.");
        } else if (response.status === 503 || response.status >= 500) {
          setError("Authentication service unavailable. Please try again.");
        } else {
          setError("Authentication failed. Please verify your credentials.");
        }
        setStatus("idle");
        return;
      }
      if (result?.authenticated !== true || typeof result?.user?.email !== "string") {
        setError("Authentication service unavailable. Please try again.");
        setStatus("idle");
        return;
      }
      setEmail("");
      setPassword("");
      setStatus("success");
      window.setTimeout(() => onAuthenticated(result.user.email), 700);
    } catch {
      setError("Authentication service unavailable. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <main className="login-shell min-h-screen overflow-hidden px-4 py-7 text-slate-100 sm:px-8 sm:py-10">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-topline relative mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="ResQmap Logo" className="h-10 w-auto" />
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.2em] text-white">NDRF</p>
            <p className="hidden text-[9px] font-medium uppercase tracking-[0.18em] text-slate-400 sm:block">
              National Disaster Response Force
            </p>
          </div>
        </div>
        <span className="prototype-badge">Authorized prototype environment</span>
      </div>

      <div className="relative mx-auto grid min-h-[calc(100vh-125px)] max-w-6xl items-center gap-10 py-9 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <section className="login-intro max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 border-b border-cyan-300/25 pb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-200">
            <span className="status-light" /> Secure system · prototype
          </div>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-slate-400">Disaster response</p>
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl">
            Command<br className="hidden sm:block" /> Center
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-slate-400">
            A geospatial response workspace for incident awareness, affected-area clusters, nearby medical resources, and validated road routes.
          </p>
          <div className="mt-9 grid max-w-lg grid-cols-3 gap-2 border-y border-white/10 py-4 font-mono text-[9px] uppercase tracking-[0.13em] text-slate-500 sm:gap-5">
            <span>Incident view</span><span>GIS response</span><span>Route validation</span>
          </div>
        </section>

        <section className="login-card mx-auto w-full max-w-md" aria-labelledby="login-title">
          <div className="mb-7 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.19em] text-cyan-200">Command authentication</p>
              <h2 id="login-title" className="mt-2 text-xl font-semibold tracking-tight text-white">Authorized personnel access</h2>
              <p className="mt-1 text-xs text-slate-400">Sign in to open the response workspace.</p>
            </div>
            <div className="login-lock"><LockKeyhole className="h-4 w-4" /></div>
          </div>

          {status === "success" ? (
            <div className="login-success" role="status" aria-live="polite">
              <ShieldCheck className="h-7 w-7 text-emerald-300" />
              <div>
                <p className="text-sm font-semibold text-white">Authentication verified</p>
                <p className="mt-1 text-xs text-slate-400">Secure session established · Command center online</p>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <label className="login-label" htmlFor="operator-email">Official email</label>
              <input
                id="operator-email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your authorized email"
                className="login-input"
                disabled={status === "loading"}
              />

              <div className="mt-5 flex items-center justify-between gap-2">
                <label className="login-label mb-0" htmlFor="operator-password">Password</label>
                <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">HTTP-only session</span>
              </div>
              <div className="login-password-wrap">
                <input
                  id="operator-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  className="login-input pr-11"
                  disabled={status === "loading"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="login-password-toggle"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="mt-0.5 accent-cyan-400"
                />
                <span>Remember this device <span className="block pt-0.5 text-[10px] text-slate-500">This setting does not extend the session lifetime.</span></span>
              </label>

              {error && <p className="login-error" role="alert">{error}</p>}
              <button type="submit" className="login-submit mt-6" disabled={status === "loading"}>
                {status === "loading" ? (
                  <><span className="login-spinner" /> Verifying credentials…</>
                ) : (
                  <>Authenticate &amp; enter command center <ArrowRight className="h-4 w-4" /></>
                )}
              </button>
            </form>
          )}

          <div className="login-card-footer mt-7 flex items-center gap-2 border-t border-white/10 pt-4 text-[10px] leading-4 text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
            Prototype demonstration. This is not a government authentication portal.
          </div>
        </section>
      </div>
    </main>
  );
}
