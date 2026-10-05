import { Activity, Clock3, Radio, Satellite } from "lucide-react";
import brandLogo from "../../images/Gemini_Generated_Image_wlb5spwlb5spwlb5.png";

type Props = {
  clock: string;
  mode: string;
  onMode: (m: string) => void;
  liveIndia: number;
  notice?: string | null;
  freshness?: string;
};

export default function TopBar({ clock, mode, onMode, liveIndia, notice, freshness }: Props) {
  return (
    <header className="relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sky-200/10 bg-[#07162a]/80 px-3 py-2.5 shadow-[0_8px_32px_rgba(1,8,20,0.22)] backdrop-blur-2xl sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <img src={brandLogo} alt="ResQMap" className="h-9 w-16 shrink-0 object-contain sm:h-11 sm:w-24" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[11px] font-semibold tracking-[0.12em] text-slate-50 sm:text-[13px] sm:tracking-[0.16em]">
              EMERGENCY RESPONSE OPERATIONS
            </h1>
            <span className="hidden rounded-md border border-sky-300/20 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[9px] text-sky-200 sm:inline">
              EOC
            </span>
          </div>
          <p className="hidden max-w-full truncate text-[10px] text-slate-400 sm:block sm:text-[11px]">
            Disaster impact · cluster-to-hospital routing · operational awareness
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 text-[10px] sm:gap-2 sm:text-[11px]">
        <div className="hidden items-center gap-1.5 rounded-lg border border-sky-100/10 bg-sky-950/45 px-2.5 py-1.5 2xl:flex">
          <Satellite className="h-3.5 w-3.5 text-sky-400" />
          <span className="text-slate-400">CEMS</span>
          <span className="font-mono text-slate-200">{freshness || "—"}</span>
        </div>
        <div className="hidden items-center gap-1.5 rounded-lg border border-sky-100/10 bg-sky-950/45 px-2.5 py-1.5 md:flex">
          <Radio className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-slate-400">Live India</span>
          <span className="font-mono text-white">{liveIndia}</span>
        </div>
        <select
          value={mode}
          onChange={(e) => onMode(e.target.value)}
          className="max-w-[128px] rounded-lg border border-sky-100/15 bg-[#0b2340] px-2 py-1.5 font-medium text-slate-100 outline-none transition focus:border-sky-300/50 sm:max-w-none"
        >
          <option value="india">India focus</option>
          <option value="demo">Demo / historical</option>
          <option value="live">Live Copernicus only</option>
          <option value="regional">South Asia watch</option>
        </select>
        <div className="flex items-center gap-1 font-mono text-slate-300 sm:gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          {clock}
          <span className="text-slate-500">IST</span>
        </div>
        <div className="hidden items-center gap-1 rounded-full border border-emerald-300/15 bg-emerald-400/[0.06] px-2 py-1 text-emerald-300 sm:flex">
          <Activity className="h-3.5 w-3.5" />
          OPS
        </div>
      </div>
      {notice ? (
        <div className="absolute left-1/2 top-full z-20 hidden w-[min(640px,70vw)] -translate-x-1/2 rounded-b-md border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-center text-[10px] text-amber-200 xl:block">
          {notice}
        </div>
      ) : null}
    </header>
  );
}
