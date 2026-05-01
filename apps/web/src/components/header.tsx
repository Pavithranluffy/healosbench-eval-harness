"use client";
import Link from "next/link";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
  const links = [
    { to: "/", label: "Home" },
    { to: "/runs", label: "Runs" },
    { to: "/compare", label: "Compare" },
  ] as const;

  return (
    <div>
      <div className="flex flex-row items-center justify-between px-2 py-1">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-black text-xl tracking-tighter">
            HEALOSBENCH
          </Link>
          <nav className="flex gap-4 text-sm font-medium">
            {links
              .filter((l) => l.to !== "/")
              .map(({ to, label }) => {
                return (
                  <Link key={to} href={to} className="text-zinc-500 hover:text-black dark:hover:text-white transition-colors">
                    {label}
                  </Link>
                );
              })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
      <hr />
    </div>
  );
}
