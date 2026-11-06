"use client";

import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/client/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/client/components/ui/sheet";
import { GroupSidebar, type SidebarGroup } from "./group-sidebar";
import { ThemeToggle } from "./theme-toggle";

type AppShellProps = {
  groups: SidebarGroup[];
  activeGroupId?: string;
  /** The account menu, shown at the right of the header. */
  accountMenu: ReactNode;
  children: ReactNode;
};

export function AppShell({ groups, activeGroupId, accountMenu, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop: permanent sidebar. Hidden below 1024px, where the sheet below takes over. */}
      <aside className="hidden w-72 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
        <div className="sticky top-0 h-dvh">
          <GroupSidebar groups={groups} activeGroupId={activeGroupId} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-3 lg:px-6">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 lg:hidden"
            aria-label="Open group list"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          <p className="font-heading min-w-0 flex-1 truncate font-semibold lg:hidden">
            <span className="marker px-0.5">study-share</span>
          </p>
          <div className="flex min-w-0 shrink-0 items-center gap-1 lg:ml-auto">
            {accountMenu}
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-80 max-w-[85vw] bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Your groups</SheetTitle>
          <SheetDescription className="sr-only">Choose a group to open its library.</SheetDescription>
          <GroupSidebar groups={groups} activeGroupId={activeGroupId} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
