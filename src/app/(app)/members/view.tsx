"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Cake, Download, FileSpreadsheet, Plus, Upload, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { LinkTabs } from "@/components/ui/tabs";
import { Person } from "@/components/ui/avatar";
import { useAction } from "@/components/ui/use-action";
import { formatPhone } from "@/lib/phone";
import { fullName } from "@/lib/format";
import type { MemberFilters } from "@/server/services/members";
import { bulkAction } from "./actions";
import { MemberDrawer } from "./member-form";
import { MONTHS, STAGE_LABEL, STAGE_TONE, STATUS_LABEL } from "./labels";

type Row = {
  id: string;
  memberNo: string;
  title: string | null;
  firstName: string;
  lastName: string;
  gender: string;
  stage: string;
  status: string;
  phone: string | null;
  dobDay: number | null;
  dobMonth: number | null;
  joinDate: string;
  branchName: string;
  groups: string[];
};

export function MembersView({
  list,
  filters,
  branches,
  groups,
  tags,
  can,
}: {
  list: { rows: Row[]; total: number; page: number; pageSize: number };
  filters: MemberFilters;
  branches: { id: string; name: string }[];
  groups: { id: string; name: string; kind: string }[];
  tags: { id: string; name: string }[];
  can: { write: boolean; import: boolean; export: boolean; sensitive: boolean };
}) {
  const sp = useSearchParams();
  const path = usePathname();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const bulk = useAction(bulkAction, { onSuccess: () => setSelected(new Set()) });

  const href = (patch: Record<string, string | undefined>) => {
    const n = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v);
      else n.delete(k);
    }
    if (!("page" in patch)) n.delete("page");
    const s = n.toString();
    return s ? `${path}?${s}` : path;
  };
  const setParam = (k: string, v: string) => router.replace(href({ [k]: v || undefined }), { scroll: false });
  const filtered = !!(
    filters.q ||
    filters.branchId ||
    filters.groupId ||
    filters.tagId ||
    filters.gender ||
    filters.birthdays ||
    filters.status
  );
  const exportQs = useMemo(() => {
    const n = new URLSearchParams(sp.toString());
    n.delete("page");
    return n.toString();
  }, [sp]);
  const allOnPage = list.rows.length > 0 && list.rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Members"
        description={`${list.total.toLocaleString()} ${filtered || filters.stage ? "matching" : list.total === 1 ? "person" : "people"}`}
        actions={
          <>
            {can.export && (
              <Dropdown>
                <DropdownTrigger asChild>
                  <Button>
                    <Download /> Export
                  </Button>
                </DropdownTrigger>
                <DropdownContent align="end">
                  <DropdownItem asChild>
                    <a href={`/members/export?format=xlsx&${exportQs}`}>
                      <FileSpreadsheet /> Excel (.xlsx)
                    </a>
                  </DropdownItem>
                  <DropdownItem asChild>
                    <a href={`/members/export?format=csv&${exportQs}`}>
                      <Download /> CSV
                    </a>
                  </DropdownItem>
                </DropdownContent>
              </Dropdown>
            )}
            {can.import && (
              <Button asChild>
                <Link href="/members/import">
                  <Upload /> Import
                </Link>
              </Button>
            )}
            {can.write && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus /> Add member
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <LinkTabs
          className="self-start"
          current={filters.stage ?? "all"}
          tabs={[
            { key: "all", label: "Everyone", href: href({ stage: undefined }) },
            { key: "member", label: "Members", href: href({ stage: "member" }) },
            { key: "regular", label: "Regulars", href: href({ stage: "regular" }) },
            { key: "first_timer", label: "First timers", href: href({ stage: "first_timer" }) },
            { key: "second_timer", label: "Second timers", href: href({ stage: "second_timer" }) },
            { key: "visitor", label: "Visitors", href: href({ stage: "visitor" }) },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox placeholder="Search name, phone or member number" className="w-[300px] max-sm:w-full" />
          <div className="flex flex-wrap items-center gap-2 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1">
            {branches.length > 1 && (
              <FilterSelect label="Branch" value={filters.branchId} onChange={(v) => setParam("branch", v)}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </FilterSelect>
            )}
            {groups.length > 0 && (
              <FilterSelect label="Group" value={filters.groupId} onChange={(v) => setParam("group", v)}>
                {(["department", "cell", "ministry"] as const).map((k) => {
                  const g = groups.filter((x) => x.kind === k);
                  return g.length ? (
                    <optgroup
                      key={k}
                      label={k === "cell" ? "Home cells" : k === "department" ? "Departments" : "Ministries"}
                    >
                      {g.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </FilterSelect>
            )}
            {tags.length > 0 && (
              <FilterSelect label="Tag" value={filters.tagId} onChange={(v) => setParam("tag", v)}>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </FilterSelect>
            )}
            <FilterSelect label="Gender" value={filters.gender} onChange={(v) => setParam("gender", v)}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </FilterSelect>
            <FilterSelect label="Birthdays" value={filters.birthdays} onChange={(v) => setParam("birthdays", v)}>
              <option value="week">Next 7 days</option>
              <option value="month">This month</option>
            </FilterSelect>
            <FilterSelect label="Status: active" value={filters.status} onChange={(v) => setParam("status", v)}>
              {Object.entries(STATUS_LABEL)
                .filter(([k]) => k !== "active")
                .map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
            </FilterSelect>
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" asChild>
              <Link href={filters.stage ? `${path}?stage=${filters.stage}` : path}>
                <X /> Clear filters
              </Link>
            </Button>
          )}
        </div>
      </div>

      {selected.size > 0 && can.write && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-accent-line bg-accent-soft px-3 py-2 text-[13px] shadow-card">
          <b className="text-accent">{selected.size} selected</b>
          <Select
            aria-label="Change stage"
            className="h-8 w-auto"
            value=""
            onChange={(e) => e.target.value && bulk.run({ ids: [...selected], stage: e.target.value as never })}
          >
            <option value="">Change stage…</option>
            {Object.entries(STAGE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          {groups.length > 0 && (
            <Select
              aria-label="Add to group"
              className="h-8 w-auto"
              value=""
              onChange={(e) => e.target.value && bulk.run({ ids: [...selected], groupId: e.target.value })}
            >
              <option value="">Add to group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          )}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (bulkTag.trim()) bulk.run({ ids: [...selected], addTag: bulkTag }).then(() => setBulkTag(""));
            }}
          >
            <Input
              aria-label="Tag"
              list="bulk-tags"
              placeholder="Add a tag"
              className="h-8 w-36"
              value={bulkTag}
              onChange={(e) => setBulkTag(e.target.value)}
            />
            <datalist id="bulk-tags">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <Button size="sm" type="submit" loading={bulk.pending}>
              Tag
            </Button>
          </form>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card>
        {list.rows.length === 0 ? (
          filtered || filters.stage ? (
            <EmptyState icon={<Users />} title="No one matches these filters">
              Try a different spelling or the last 4 digits of their phone number.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Users />}
              title="Add your first members"
              action={
                <div className="flex gap-2">
                  {can.import && (
                    <Button asChild>
                      <Link href="/members/import">
                        <Upload /> Import a spreadsheet
                      </Link>
                    </Button>
                  )}
                  {can.write && (
                    <Button variant="primary" onClick={() => setAdding(true)}>
                      <Plus /> Add member
                    </Button>
                  )}
                </div>
              }
            >
              Bring your existing list in from Excel or a CSV file, or add people one at a time.
            </EmptyState>
          )
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {can.write && (
                    <Th className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        className="size-4 accent-[var(--accent)]"
                        checked={allOnPage}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            list.rows.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id)));
                            return n;
                          })
                        }
                      />
                    </Th>
                  )}
                  <Th>Name</Th>
                  <Th className="max-md:hidden">Phone</Th>
                  <Th className="max-lg:hidden">Groups</Th>
                  <Th>Stage</Th>
                  {branches.length > 1 && <Th className="max-lg:hidden">Branch</Th>}
                  <Th className="max-md:hidden">Birthday</Th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <Tr key={r.id} className="cursor-pointer" onClick={() => router.push(`/members/${r.id}`)}>
                    {can.write && (
                      <Td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.firstName} ${r.lastName}`}
                          className="size-4 accent-[var(--accent)]"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </Td>
                    )}
                    <Td>
                      <Link href={`/members/${r.id}`} className="block" onClick={(e) => e.stopPropagation()}>
                        <Person
                          name={fullName(r)}
                          sub={
                            <>
                              {r.memberNo}
                              {r.status !== "active" && ` · ${STATUS_LABEL[r.status]}`}
                            </>
                          }
                        />
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs whitespace-nowrap max-md:hidden">
                      {r.phone ? formatPhone(r.phone) : <span className="text-faint">—</span>}
                    </Td>
                    <Td className="max-w-[220px] truncate text-muted max-lg:hidden">
                      {r.groups.join(", ") || <span className="text-faint">—</span>}
                    </Td>
                    <Td>
                      <Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>
                    </Td>
                    {branches.length > 1 && <Td className="text-muted max-lg:hidden">{r.branchName}</Td>}
                    <Td className="whitespace-nowrap text-muted max-md:hidden">
                      {r.dobDay && r.dobMonth ? (
                        <span className="inline-flex items-center gap-1">
                          {filters.birthdays && <Cake className="size-3.5 text-c2" />}
                          {r.dobDay} {MONTHS[r.dobMonth - 1]!.slice(0, 3)}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              hrefFor={(p) => href({ page: String(p) })}
            />
          </>
        )}
      </Card>

      <MemberDrawer
        open={adding}
        onOpenChange={setAdding}
        branches={branches}
        canSensitive={can.sensitive}
        initial={filters.stage ? { stage: filters.stage } : undefined}
      />
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Select
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 w-auto max-w-[180px] shrink-0 ${value ? "border-accent text-accent" : ""}`}
    >
      <option value="">{label}</option>
      {children}
    </Select>
  );
}
