"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Baby, HeartPulse, Plus, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Stat } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Person } from "@/components/ui/avatar";
import { ChildDrawer, CLASS_NAMES } from "./child-form";

type Row = {
  id: string;
  childNo: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  classGroup: string;
  hasAllergies: boolean;
  here: boolean;
  guardians: { firstName: string; lastName: string; title: string | null; relationship: string }[];
};

export function ChildrenView({
  rows,
  stats,
  filters,
  branches,
  canManage,
  canMedical,
}: {
  rows: Row[];
  stats: { registered: number; here: number };
  filters: { q?: string; classGroup?: string; here: boolean; status?: string };
  branches: { id: string; name: string }[];
  canManage: boolean;
  canMedical: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v);
    else n.delete(k);
    router.replace(`${path}?${n}`, { scroll: false });
  };
  const filtered = !!(filters.q || filters.classGroup || filters.here || filters.status);
  return (
    <>
      <PageHeader
        title="Children"
        description="Every child has a QR tag for fast, safe check-in and check-out."
        actions={
          <>
            <Button asChild>
              <Link href="/children/desk">
                <ScanLine /> Check-in desk
              </Link>
            </Button>
            {canManage && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> Register child
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        <Stat label="Registered" value={stats.registered.toLocaleString("en-NG")} />
        <Stat
          label="In church now"
          value={stats.here.toLocaleString("en-NG")}
          sub={
            stats.here ? (
              <Link href="/children/desk" className="text-accent">
                Open the desk
              </Link>
            ) : (
              "No one checked in"
            )
          }
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox placeholder="Search a child, or a parent's name or phone" className="w-[320px] max-sm:w-full" />
        <Select
          aria-label="Class"
          className="h-9 w-auto"
          value={filters.classGroup ?? ""}
          onChange={(e) => setParam("class", e.target.value)}
        >
          <option value="">All classes</option>
          {CLASS_NAMES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Select
          aria-label="Show"
          className="h-9 w-auto"
          value={filters.here ? "1" : ""}
          onChange={(e) => setParam("here", e.target.value)}
        >
          <option value="">Everyone</option>
          <option value="1">In church now</option>
        </Select>
        <Select
          aria-label="Status"
          className="h-9 w-auto"
          value={filters.status ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
        >
          <option value="">Active</option>
          <option value="graduated">Graduated</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Baby />}
            title={filtered ? "No children match" : "Register your first child"}
            action={
              !filtered &&
              canManage && (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  <Plus /> Register child
                </Button>
              )
            }
          >
            {filtered
              ? "Try another name, or a parent's phone number."
              : "Add the child with their parents' details. Each child gets a QR tag you can print."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Child</Th>
                <Th>Class</Th>
                <Th className="max-md:hidden">Parents</Th>
                <Th>Now</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/children/${r.id}`)}>
                  <Td>
                    <Link href={`/children/${r.id}`} onClick={(e) => e.stopPropagation()} className="block">
                      <Person
                        name={`${r.firstName} ${r.lastName}`}
                        sub={
                          <span className="inline-flex items-center gap-1">
                            {r.childNo} · {r.age} yr{r.age === 1 ? "" : "s"}
                            {r.hasAllergies && (
                              <HeartPulse className="size-3.5 text-bad" aria-label="Has medical notes" />
                            )}
                          </span>
                        }
                      />
                    </Link>
                  </Td>
                  <Td>{r.classGroup}</Td>
                  <Td className="text-muted max-md:hidden">
                    {r.guardians
                      .slice(0, 2)
                      .map((g) => `${g.firstName} ${g.lastName} (${g.relationship})`)
                      .join(", ")}
                  </Td>
                  <Td>{r.here ? <Badge tone="good">In church</Badge> : <span className="text-faint">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ChildDrawer open={adding} onOpenChange={setAdding} branches={branches} canMedical={canMedical} />
    </>
  );
}
