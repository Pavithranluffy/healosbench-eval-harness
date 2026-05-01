import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  // if (!session?.user) {
  //   redirect("/login");
  // }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Dashboard</h1>
      <p className="text-zinc-500 mb-8">Welcome, {session?.user?.name ?? "Guest"}</p>
      <Dashboard session={session as any} />
    </div>
  );
}
