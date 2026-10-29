"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, TriangleAlert, Undo2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Note } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { useAction } from "@/components/ui/use-action";
import { formatDateTime } from "@/lib/format";
import { checkImportAction, commitImportAction, startImportAction, undoImportAction } from "../actions";

type Problem = { row: number; problem: string; value?: string };
type Check = { total: number; valid: number; problems: Problem[]; problemCount: number };
type Started = Check & {
  jobId: string;
  headers: string[];
  mapping: Record<string, string>;
  sample: Record<string, string>[];
};

export function ImportWizard({
  fields,
  recent,
}: {
  fields: Record<string, string>;
  recent: {
    id: string;
    filename: string;
    status: string;
    added: number;
    total: number;
    at: string;
    canUndo: boolean;
  }[];
}) {
  const [job, setJob] = useState<Started | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [check, setCheck] = useState<Check | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number; groupsCreated: string[] } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const start = useAction(startImportAction, {
    onSuccess: (d) => {
      const s = d as Started;
      setJob(s);
      setMapping(s.mapping);
      setCheck(s);
    },
  });
  const recheck = useAction(checkImportAction, { onSuccess: (d) => setCheck(d) });
  const commit = useAction(commitImportAction, { onSuccess: (d) => setDone(d) });
  const undo = useAction(undoImportAction);

  function upload(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start.run(fd);
  }
  function remap(header: string, field: string) {
    // a field can only come from one column
    const next = Object.fromEntries(Object.entries(mapping).map(([h, f]) => [h, f === field && field ? "" : f]));
    next[header] = field;
    setMapping(next);
    recheck.run({ jobId: job!.jobId, mapping: next as never });
  }
  function downloadProblems() {
    if (!check) return;
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = [
      "Row,Problem,Value",
      ...check.problems.map((p) => [p.row, esc(p.problem), esc(p.value ?? "")].join(",")),
    ].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "import-problems.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const reset = () => {
    setJob(null);
    setCheck(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <Link href="/members" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Members
      </Link>
      <PageHeader
        title="Import members"
        description="Bring in your existing list from Excel or a CSV file. Nothing is added until you confirm."
        actions={
          <Button asChild>
            <Link href="/members/import/template" prefetch={false}>
              <Download /> Download template
            </Link>
          </Button>
        }
      />

      <ol className="flex flex-wrap gap-2 text-[13px]" aria-label="Steps">
        {["Upload", "Check columns", "Import"].map((s, i) => {
          const step = done ? 2 : job ? 1 : 0;
          return (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i === step ? "border-accent bg-accent-soft text-accent" : i < step ? "border-line text-good" : "border-line text-faint"}`}
            >
              <span className="font-mono text-xs">{i + 1}</span> {s}
            </li>
          );
        })}
      </ol>

      {done ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-good" />
            <h3 className="text-lg font-semibold">
              {done.added.toLocaleString()} member{done.added === 1 ? "" : "s"} imported
            </h3>
            <p className="max-w-md text-[13px] text-muted">
              {done.skipped > 0 &&
                `${done.skipped} row${done.skipped === 1 ? " was" : "s were"} skipped because of problems. `}
              {done.groupsCreated.length > 0 && `New groups created: ${done.groupsCreated.join(", ")}. `}
              You can undo this import for 7 days.
            </p>
            <div className="flex gap-2">
              <Button onClick={reset}>Import another file</Button>
              <Button variant="primary" asChild>
                <Link href="/members">See members</Link>
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : !job ? (
        <Card>
          <CardBody>
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                upload(e.dataTransfer.files[0]);
              }}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${drag ? "border-accent bg-accent-soft" : "border-line-strong hover:bg-surface-2"}`}
            >
              <div className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
                {start.pending ? <FileSpreadsheet className="size-6 animate-pulse" /> : <Upload className="size-6" />}
              </div>
              <span className="text-[15px] font-semibold">
                {start.pending ? "Reading your file…" : "Drop a file here, or choose one"}
              </span>
              <span className="text-[13px] text-muted">Excel (.xlsx) or CSV, up to 5,000 people and 10 MB</span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                aria-label="Choose a spreadsheet"
                disabled={start.pending}
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            <ul className="mt-4 grid grid-cols-3 gap-3 text-[12.5px] text-muted max-md:grid-cols-1">
              <li>
                <b className="text-fg">Any column order.</b> We match columns like “Full Name”, “Sex” or “GSM”
                automatically, and you can fix anything we get wrong.
              </li>
              <li>
                <b className="text-fg">Nigerian formats.</b> Phone numbers in any style, and birthdays like 12/03/1990
                or 12 March.
              </li>
              <li>
                <b className="text-fg">Safe.</b> Duplicates are caught, problems are listed by row, and the whole import
                can be undone.
              </li>
            </ul>
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-good" /> Match your columns
                </span>
              }
              action={
                <Button size="sm" variant="ghost" onClick={reset}>
                  Choose a different file
                </Button>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Column in your file</Th>
                  <Th>Example</Th>
                  <Th>Save as</Th>
                </tr>
              </thead>
              <tbody>
                {job.headers.map((h) => (
                  <Tr key={h}>
                    <Td className="font-medium">{h}</Td>
                    <Td className="max-w-[260px] truncate text-muted">
                      {job.sample.map((s) => s[h]).find(Boolean) || <span className="text-faint">empty</span>}
                    </Td>
                    <Td>
                      <Select
                        aria-label={`Save ${h} as`}
                        value={mapping[h] ?? ""}
                        onChange={(e) => remap(h, e.target.value)}
                        className={`h-8 w-56 max-sm:w-40 ${mapping[h] ? "" : "text-faint"}`}
                      >
                        <option value="">Don&apos;t import</option>
                        {Object.entries(fields).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {check && (
            <Card>
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1">
                    <div className="text-[15px] font-semibold">
                      {check.valid.toLocaleString()} of {check.total.toLocaleString()} ready to import
                    </div>
                    <div className="text-[13px] text-muted">
                      {check.problemCount
                        ? `${check.problemCount} problem${check.problemCount === 1 ? "" : "s"} found. Those rows will be skipped. Fix them in your file and import them later, or change the column matches above.`
                        : "No problems found."}
                    </div>
                  </div>
                  {check.problemCount > 0 && (
                    <Button onClick={downloadProblems}>
                      <Download /> Problems (.csv)
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    disabled={!check.valid || recheck.pending}
                    loading={commit.pending}
                    onClick={() => commit.run({ jobId: job.jobId, mapping: mapping as never })}
                  >
                    Import {check.valid.toLocaleString()} member{check.valid === 1 ? "" : "s"}
                  </Button>
                </div>
                {check.problems.length > 0 && (
                  <div className="max-h-80 overflow-y-auto rounded-xl border border-line">
                    <Table>
                      <thead>
                        <tr>
                          <Th className="w-16">Row</Th>
                          <Th>Problem</Th>
                          <Th>Value</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {check.problems.map((p, i) => (
                          <Tr key={i}>
                            <Td className="font-mono text-xs">{p.row || "—"}</Td>
                            <Td>
                              <span className="inline-flex items-start gap-1.5">
                                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                                {p.problem}
                              </span>
                            </Td>
                            <Td className="max-w-[200px] truncate text-muted">{p.value}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </>
      )}

      {recent.length > 0 && !job && (
        <Card>
          <CardHeader title="Recent imports" />
          <Table>
            <tbody>
              {recent.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <div className="font-medium">{r.filename}</div>
                    <div className="text-xs text-faint">{formatDateTime(r.at)}</div>
                  </Td>
                  <Td>
                    {r.status === "rolled_back" ? (
                      <Badge>Undone</Badge>
                    ) : (
                      <Badge tone="good">
                        {r.added} of {r.total} added
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {r.canUndo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={undo.pending}
                        onClick={() => undo.run({ jobId: r.id })}
                      >
                        <Undo2 /> Undo
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Note className="m-3">
            Undo removes exactly the people that import added. It&apos;s available for 7 days.
          </Note>
        </Card>
      )}
    </>
  );
}
