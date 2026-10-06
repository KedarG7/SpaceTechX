import { useState } from "react";
import { Activity, Clock3, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import logoUrl from "../../images/ResQmap-logo-mono-black.svg";

type Props = {
  clock: string;
  mode: string;
  onMode: (mode: string) => void;
  liveIndia: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  operatorEmail: string;
  onLogout: () => Promise<void>;
};

export default function TopBar({
  clock,
  mode,
  onMode,
  liveIndia,
  isRefreshing,
  onRefresh,
  operatorEmail,
  onLogout,
}: Props) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await onLogout();
    } catch {
      setLogoutError("Logout service unavailable. Session remains protected until it expires.");
      setLoggingOut(false);
    }
  }

  return (
    <header className="topbar relative z-20 flex min-h-14 flex-nowrap items-center justify-between gap-2 border-b px-3 py-2 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <img src={logoUrl} alt="ResQmap Logo" className="h-8 w-auto ndrf-mark-replaced" />
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-[10px] font-semibold tracking-[0.06em] text-slate-100 sm:text-xs sm:tracking-[0.1em]">NDRF · DISASTER RESPONSE COMMAND CENTER</h1>
          <p className="hidden items-center gap-1.5 pt-0.5 text-[9px] uppercase tracking-[0.12em] text-slate-500 xl:flex">
            <span className="status-light" /> Authorized prototype environment
          </p>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5 sm:gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-200 xl:flex">
          <Activity className="h-3 w-3" /> System operational
        </span>
        <span className="hidden items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-1.5 text-[9px] text-cyan-100 2xl:flex">
          <Activity className="h-3 w-3" /> {liveIndia} live India
        </span>
        <select
          aria-label="Incident data view"
          value={mode}
          onChange={(event) => onMode(event.target.value)}
          className="h-8 max-w-[94px] rounded-md border border-slate-700 bg-ink-950 px-1.5 text-[9px] font-medium text-slate-200 outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-400 sm:max-w-[132px] sm:px-2 sm:text-[10px]"
        >
          <option value="india">India focus</option>
          <option value="demo">Demo / historical</option>
          <option value="live">Live Copernicus only</option>
          <option value="regional">South Asia watch</option>
        </select>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-700 bg-ink-950 px-2 text-[10px] text-slate-200 transition hover:border-cyan-400/50 disabled:cursor-wait disabled:opacity-60 sm:gap-1.5 sm:px-2.5"
        >
          <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          <span className="hidden lg:inline">Refresh</span>
        </button>
        <div className="hidden items-center gap-1.5 font-mono text-[10px] text-slate-500 2xl:flex">
          <Clock3 className="h-3.5 w-3.5" /> {clock} IST
        </div>
        <div className="hidden min-w-0 items-center gap-2 border-l border-white/10 pl-2.5 xl:flex">
          <ShieldCheck className="h-4 w-4 shrink-0 text-cyan-300" />
          <div className="min-w-0">
            <div className="text-[8px] uppercase tracking-wider text-slate-500">Authorized command</div>
            <div className="max-w-40 truncate text-[10px] text-slate-200">{operatorEmail}</div>
          </div>
        </div>
        <button type="button" onClick={logout} disabled={loggingOut} className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-300/20 bg-rose-300/5 px-2 text-[9px] font-semibold uppercase tracking-wide text-rose-100 transition hover:border-rose-300/40 hover:bg-rose-300/10 disabled:opacity-60 sm:gap-1.5 sm:px-2.5">
          <LogOut className="h-3.5 w-3.5" /> <span className="sm:hidden">Logout</span><span className="hidden sm:inline">{loggingOut ? "Signing out…" : "Secure logout"}</span>
        </button>
      </div>
      {logoutError && <p role="alert" className="basis-full text-right text-[10px] text-rose-300">{logoutError}</p>}
    </header>
  );
}
