import type { AccountStatus } from "../api.js";

const COLOR: Record<AccountStatus, string> = {
  healthy: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-rose-500",
  unsupported: "bg-zinc-500",
  manual: "bg-sky-400",
};

export function StatusDot({ status }: { status: AccountStatus }): JSX.Element {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR[status]}`}
      title={status}
    />
  );
}
