import type { CreditWindow } from "../api.js";
import { formatLimit, formatValue } from "./format.js";
import { ResetCountdown } from "./ResetCountdown.js";

interface Props {
  window: CreditWindow;
  showLimit?: boolean;
}

export function CreditBar({ window: w, showLimit = true }: Props): JSX.Element {
  const pct = w.limit > 0 ? Math.min(100, Math.max(0, (w.remaining / w.limit) * 100)) : 0;
  const barColor =
    pct < 10 ? "bg-rose-500" : pct < 30 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-mono">
          {formatValue(w.remaining, w.unit)}
          {showLimit && (
            <span className="text-zinc-500">
              {" "}
              / {formatLimit(w.limit, w.unit)} {w.unit === "percent" ? "" : w.unit}
            </span>
          )}
        </span>
        <span className="text-zinc-500">
          <ResetCountdown resetAt={w.resetAt} />
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
