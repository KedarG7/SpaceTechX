import { Activity, Clock3, RefreshCw } from "lucide-react";

type Props = {
  clock: string;
  mode: string;
  onMode: (mode: string) => void;
  liveIndia: number;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export default function TopBar({
  clock,
  mode,
  onMode,
  liveIndia,
  isRefreshing,
  onRefresh,
}: Props) {
  return (
    <header className="topbar relative z-20 flex min-h-16 flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div aria-hidden="true" className="h-10 w-20 shrink-0" />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight text-slate-950">
            ResQMap
          </h1>
          <p className="hidden text-xs text-slate-500 sm:block">
            Emergency response operations
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-800 sm:flex">
          <Activity className="h-3.5 w-3.5 text-sky-600" />
          {liveIndia} live in India
        </span>
        <select
          aria-label="Incident data view"
          value={mode}
          onChange={(event) => onMode(event.target.value)}
          className="h-9 max-w-[150px] rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-sky-500 sm:max-w-none"
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
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
        <div className="hidden items-center gap-1.5 font-mono text-xs text-slate-500 md:flex">
          <Clock3 className="h-3.5 w-3.5" />
          {clock} IST
        </div>
      </div>
    </header>
  );
}
