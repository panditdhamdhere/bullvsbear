"use client";

import { useUser } from "@/lib/user";

export default function PointsBadge() {
  const { user } = useUser();
  if (!user) return null;
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent"
      title={`${user.name} · ${user.correct}/${user.predictions} predictions correct`}
    >
      ◆ {user.points.toLocaleString()}
    </span>
  );
}
