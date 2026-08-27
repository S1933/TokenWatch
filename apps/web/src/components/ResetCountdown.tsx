import { useEffect, useState } from "react";

export function ResetCountdown({ resetAt }: { resetAt: string | null }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!resetAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resetAt]);

  if (!resetAt) return <span className="text-zinc-500">no reset</span>;
  const target = new Date(resetAt).getTime();
  const diffMs = target - now;
  if (diffMs <= 0) return <span className="text-zinc-500">resetting…</span>;
  return <span className="font-mono text-zinc-300">{formatDuration(diffMs)}</span>;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}
