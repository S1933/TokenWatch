import { NavLink } from "react-router-dom";

export function Header(): JSX.Element {
  return (
    <header className="border-b border-zinc-800">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-6">
        <span className="font-semibold tracking-wide text-zinc-100">TokenWatch</span>
        <nav className="flex gap-4 text-sm">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/accounts"
            className={({ isActive }) =>
              isActive ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }
          >
            Accounts
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
