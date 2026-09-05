"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Clapperboard,
  FolderOpen,
  House,
  LibraryBig,
  LogOut,
  Scissors,
  ShieldUser,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

const CREATE_GROUP: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, exact: true },
  { href: "/dashboard/create", label: "New Reel", icon: Clapperboard },
];

const WORKSPACE_GROUP: NavItem[] = [
  { href: "/dashboard/reels", label: "My Reels", icon: LibraryBig },
  { href: "/dashboard/clips", label: "Clip Engine", icon: Scissors },
  { href: "/dashboard/library", label: "Library", icon: FolderOpen },
];

function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={`text-base font-semibold tracking-tight ${className ?? ""}`}
    >
      Reel<span className="text-brand">Bot</span>
    </Link>
  );
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isActive(pathname, item)}
                tooltip={item.label}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppShell({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const email = session?.user?.email ?? "";

  return (
    <TooltipProvider>
      <SidebarProvider
        defaultOpen={defaultOpen}
        style={{ "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}
      >
        <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* Collapsed: single centered trigger; expanded: brand + trigger */}
          <div className="flex items-center justify-between gap-2 px-2 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-center">
            <BrandMark className="group-data-[collapsible=icon]:hidden" />
            <SidebarTrigger />
          </div>
        </SidebarHeader>
          <SidebarContent>
            <NavSection label="Create" items={CREATE_GROUP} />
            <NavSection label="Workspace" items={WORKSPACE_GROUP} />
            {isAdmin && (
              <NavSection
                label="Admin"
                items={[{ href: "/admin", label: "Admin", icon: ShieldUser }]}
              />
            )}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors hover:bg-sidebar-accent"
                    >
                      <Avatar className="size-7">
                        <AvatarFallback className="text-xs">
                          {email.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                        {email}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start">
                    <DropdownMenuLabel className="truncate font-normal">
                      {email}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => signOut({ redirectTo: "/" })}
                    >
                      <LogOut />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur md:hidden">
            <SidebarTrigger />
            <BrandMark />
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
