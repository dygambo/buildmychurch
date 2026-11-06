"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, MoreHorizontal, Package, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Stat } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SearchBox } from "@/components/ui/search-box";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formToObject, useAction } from "@/components/ui/use-action";
import { formatDate, naira, todayISO } from "@/lib/format";
import { ASSET_CATEGORY_LABEL, DEFAULT_LIFE } from "@/lib/assets";
import type { AssetRow } from "@/server/services/expenses";
import { disposeAssetAction, saveAssetAction } from "../actions";
import { ASSET_STATUS, CONDITION } from "../labels";

export function AssetsView({
  list,
  filters,
  branches,
}: {
  list: { rows: AssetRow[]; totals: { cost: number; book: number; count: number; needsAttention: number } };
  filters: { category: string; status: string; branch: string };
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [editing, setEditing] = useState<AssetRow | "new" | null>(null);
  const [disposing, setDisposing] = useState<AssetRow | null>(null);
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${path}?${next}`, { scroll: false });
  };
  return (
    <>
      <PageHeader
        title="Assets"
        description="The church's equipment, vehicles, buildings and land: who has them, what condition they're in, and what they're worth now."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus /> Add asset
          </Button>
        }
      />
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        <Stat label="Items in use" value={list.totals.count.toLocaleString("en-NG")} />
        <Stat label="Bought for" value={naira(list.totals.cost, { compact: list.totals.cost >= 100_000_000 })} />
        <Stat label="Worth now" value={naira(list.totals.book, { compact: list.totals.book >= 100_000_000 })} sub="After wear (straight-line)" />
        <Stat
          label="Need attention"
          value={list.totals.needsAttention}
          tone={list.totals.needsAttention ? "bad" : undefined}
          sub="In repair, poor or broken"
        />
      </div>
      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchBox placeholder="Name, tag, serial, who has it" className="w-64 max-sm:w-full" />
        <Field label="Type" htmlFor="a-cat">
          <Select id="a-cat" value={filters.category} onChange={(e) => setParam("category", e.target.value)}>
            <option value="">All types</option>
            {Object.entries(ASSET_CATEGORY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Show" htmlFor="a-status">
          <Select id="a-status" value={filters.status} onChange={(e) => setParam("status", e.target.value)}>
            <option value="">Current assets</option>
            <option value="disposed">Disposed</option>
            <option value="all">Everything</option>
          </Select>
        </Field>
        {branches.length > 1 && (
          <Field label="Branch" htmlFor="a-branch">
            <Select id="a-branch" value={filters.branch} onChange={(e) => setParam("branch", e.target.value)}>
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>
      <Card>
        {list.rows.length === 0 ? (
          <EmptyState
            icon={<Package />}
            title="No assets here"
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                <Plus /> Add the first asset
              </Button>
            }
          >
            Keep the generator, sound desk, instruments, vehicles and land on record, with who looks after each.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Asset</Th>
                <Th className="max-md:hidden">Where / who</Th>
                <Th className="max-lg:hidden">Bought</Th>
                <Th num>Worth now</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.rows.map((a) => {
                const st = ASSET_STATUS[a.status]!;
                return (
                  <Tr key={a.id} className={a.status === "disposed" ? "opacity-60" : undefined}>
                    <Td>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-faint">
                        <span className="font-mono">{a.assetNo}</span> · {ASSET_CATEGORY_LABEL[a.category]}
                        {a.serialNo && <span> · S/N {a.serialNo}</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {a.status !== "disposed" && (a.condition === "poor" || a.condition === "broken") && (
                          <Badge tone="bad">{CONDITION[a.condition]}</Badge>
                        )}
                      </div>
                    </Td>
                    <Td className="max-md:hidden">
                      <div>{a.location ?? <span className="text-faint">No location</span>}</div>
                      <div className="text-xs text-muted">
                        {a.custodian ?? "No one assigned"}
                        {branches.length > 1 && <span className="text-faint"> · {a.branchName}</span>}
                      </div>
                    </Td>
                    <Td className="max-lg:hidden">
                      {a.purchasedOn ? formatDate(a.purchasedOn) : <span className="text-faint">Unknown</span>}
                      <div className="tabular text-xs text-muted">{naira(a.costKobo)}</div>
                    </Td>
                    <Td num>
                      {a.status === "disposed" ? (
                        <span className="text-xs text-muted">
                          Disposed {a.disposedOn ? formatDate(a.disposedOn) : ""}
                          <br />
                          for {naira(a.disposalKobo ?? 0)}
                        </span>
                      ) : (
                        <>
                          <span className="font-medium">{naira(a.bookValueKobo)}</span>
                          {a.usefulLifeMonths && a.costKobo > 0 && (
                            <div className="text-xs text-faint">{Math.round((a.bookValueKobo / a.costKobo) * 100)}% of cost</div>
                          )}
                        </>
                      )}
                    </Td>
                    <Td>
                      {a.status !== "disposed" && (
                        <Dropdown>
                          <DropdownTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${a.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownTrigger>
                          <DropdownContent>
                            <DropdownItem onSelect={() => setEditing(a)}>
                              <Pencil /> Edit
                            </DropdownItem>
                            <DropdownItem danger onSelect={() => setDisposing(a)}>
                              <Archive /> Dispose of it
                            </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <AssetDialog asset={editing} branches={branches} onClose={() => setEditing(null)} />
      <DisposeDialog asset={disposing} onClose={() => setDisposing(null)} />
    </>
  );
}

function AssetDialog({
  asset,
  branches,
  onClose,
}: {
  asset: AssetRow | "new" | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const a = asset && asset !== "new" ? asset : null;
  const [category, setCategory] = useState<keyof typeof DEFAULT_LIFE>(a?.category ?? "sound");
  const [life, setLife] = useState(String(a?.usefulLifeMonths ?? DEFAULT_LIFE[a?.category ?? "sound"] ?? ""));
  const save = useAction(saveAssetAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const fe = save.fieldErrors;
  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      {asset && (
        <DialogContent
          wide
          title={a ? `Edit ${a.assetNo}` : "Add an asset"}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="asset-form" variant="primary" loading={save.pending}>
                {a ? "Save" : "Add asset"}
              </Button>
            </>
          }
        >
          <form
            id="asset-form"
            key={a?.id ?? "new"}
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              save.run({ ...(formToObject(e.currentTarget) as Record<string, string>), id: a?.id } as Parameters<typeof saveAssetAction>[0]);
            }}
          >
            <Field label="Name" htmlFor="as-name" error={fe.name} className="col-span-full">
              <Input id="as-name" name="name" defaultValue={a?.name} placeholder="e.g. Yamaha TF5 mixing console" required />
            </Field>
            <Field label="Type" htmlFor="as-cat">
              <Select
                id="as-cat"
                name="category"
                value={category}
                onChange={(e) => {
                  const c = e.target.value as keyof typeof DEFAULT_LIFE;
                  setCategory(c);
                  setLife(String(DEFAULT_LIFE[c] ?? ""));
                }}
              >
                {Object.entries(ASSET_CATEGORY_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condition" htmlFor="as-cond">
              <Select id="as-cond" name="condition" defaultValue={a?.condition ?? "good"}>
                {Object.entries(CONDITION).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bought on" htmlFor="as-date" error={fe.purchasedOn} optional>
              <Input id="as-date" name="purchasedOn" type="date" max={todayISO()} defaultValue={a?.purchasedOn ?? ""} />
            </Field>
            <Field label="Cost (₦)" htmlFor="as-cost" error={fe.cost}>
              <Input id="as-cost" name="cost" inputMode="decimal" className="tabular" defaultValue={a ? String(a.costKobo / 100) : ""} required />
            </Field>
            {category !== "land" && (
              <>
                <Field label="Lasts (months)" htmlFor="as-life" error={fe.usefulLifeMonths} optional>
                  <Input id="as-life" name="usefulLifeMonths" inputMode="numeric" value={life} onChange={(e) => setLife(e.target.value)} />
                </Field>
                <Field label="Worth at the end (₦)" htmlFor="as-salv" error={fe.salvage} optional>
                  <Input id="as-salv" name="salvage" inputMode="decimal" className="tabular" defaultValue={a ? String(a.salvageKobo / 100) : "0"} />
                </Field>
              </>
            )}
            <Field label="Where it's kept" htmlFor="as-loc" optional>
              <Input id="as-loc" name="location" defaultValue={a?.location ?? ""} placeholder="e.g. Main auditorium" />
            </Field>
            <Field label="Who looks after it" htmlFor="as-cust" optional>
              <Input id="as-cust" name="custodian" defaultValue={a?.custodian ?? ""} placeholder="e.g. Media department" />
            </Field>
            <Field label="Serial number" htmlFor="as-sn" optional>
              <Input id="as-sn" name="serialNo" defaultValue={a?.serialNo ?? ""} />
            </Field>
            {a ? (
              <Field label="Status" htmlFor="as-st">
                <Select id="as-st" name="status" defaultValue={a.status}>
                  <option value="in_use">In use</option>
                  <option value="in_repair">In repair</option>
                  <option value="lost">Missing</option>
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="status" value="in_use" />
            )}
            {branches.length > 1 ? (
              <Field label="Branch" htmlFor="as-br">
                <Select id="as-br" name="branchId" defaultValue={a?.branchId ?? branches[0]?.id}>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="branchId" value={a?.branchId ?? branches[0]?.id ?? ""} />
            )}
            <Field label="Notes" htmlFor="as-desc" optional className="col-span-full">
              <Textarea id="as-desc" name="description" rows={2} defaultValue={a?.description ?? ""} />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DisposeDialog({ asset, onClose }: { asset: AssetRow | null; onClose: () => void }) {
  const router = useRouter();
  const act = useAction(disposeAssetAction, {
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={!!asset} onOpenChange={(o) => !o && onClose()}>
      {asset && (
        <DialogContent
          title={`Dispose of ${asset.name}?`}
          description={`Worth ${naira(asset.bookValueKobo)} on paper today. It moves to the disposed list and stays on record.`}
          footer={
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form="dispose-form" variant="danger" loading={act.pending}>
                <Archive /> Dispose
              </Button>
            </>
          }
        >
          <form
            id="dispose-form"
            className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act.run({ id: asset.id, disposedOn: String(f.get("disposedOn")), amount: String(f.get("amount")), note: String(f.get("note")) });
            }}
          >
            <Field label="Date" htmlFor="d-date" error={act.fieldErrors.disposedOn}>
              <Input id="d-date" name="disposedOn" type="date" max={todayISO()} defaultValue={todayISO()} />
            </Field>
            <Field label="Sold for (₦)" htmlFor="d-amt" error={act.fieldErrors.amount}>
              <Input id="d-amt" name="amount" inputMode="decimal" defaultValue="0" />
            </Field>
            <Field label="What happened to it?" htmlFor="d-note" error={act.fieldErrors.note} className="col-span-full">
              <Textarea id="d-note" name="note" rows={2} placeholder="e.g. Sold to a member, scrapped after a fault, donated to a mission station" />
            </Field>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
