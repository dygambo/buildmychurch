import { Lock } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/card";

export function NoAccess({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState icon={<Lock />} title="You don't have access to this page">
        Your role doesn't allow you to {what}. Ask a Super Admin if you need it.
      </EmptyState>
    </Card>
  );
}
