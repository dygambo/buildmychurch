"use client";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";

export function SignOut({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" className="self-center" loading={pending} onClick={() => start(() => signOutAction(slug))}>
      <LogOut /> Sign out
    </Button>
  );
}
