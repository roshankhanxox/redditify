import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarState = (await cookies()).get("sidebar_state")?.value;
  return <AppShell defaultOpen={sidebarState !== "false"}>{children}</AppShell>;
}
