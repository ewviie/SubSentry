"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Logout failed");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error("Couldn't log out. Try again.");
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={loading}>
      {loading ? "Logging out…" : "Log out"}
    </Button>
  );
}
