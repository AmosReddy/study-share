"use client";

import { BookOpen, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/client/lib/utils";

type GroupTabsProps = {
  groupId: string;
  /** Only the owner gets the Settings tab. */
  showSettings: boolean;
};

/**
 * The group's sections. Below 1024px a bar fixed to the bottom of the screen, padded by the
 * safe area (the iPhone home bar); the group layout gives the content above it matching bottom
 * padding. From 1024px a row of tabs at the top of the group.
 */
export function GroupTabs({ groupId, showSettings }: GroupTabsProps) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  const items = [
    { href: base, label: "Library", Icon: BookOpen },
    { href: `${base}/members`, label: "Members", Icon: Users },
    ...(showSettings ? [{ href: `${base}/settings`, label: "Settings", Icon: Settings }] : []),
  ];

  return (
    <nav
      aria-label="Group sections"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background lg:static lg:z-auto lg:border-t-0 lg:border-b lg:bg-transparent"
    >
      <ul className="flex lg:gap-1">
        {items.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <li key={href} className="min-w-0 flex-1 lg:flex-none">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 border-transparent px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  "lg:min-h-11 lg:flex-row lg:gap-2 lg:border-t-0 lg:border-b-2 lg:px-4",
                  active && "border-foreground font-semibold text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0 lg:size-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
