"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "var(--shadow-card, 0 4px 16px rgba(0,0,0,.08))",
};

/** Monthly bars. `data` is [{ label, value }]. */
export function MonthlyBars({
  data,
  name,
  height = 220,
}: {
  data: { label: string; value: number }[];
  name: string;
  height?: number;
}) {
  return (
    <div
      style={{ height }}
      role="img"
      aria-label={`${name} by month: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--faint)" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="var(--faint)" />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} contentStyle={tooltipStyle} formatter={(v) => [v, name]} />
          <Bar dataKey="value" fill="var(--c1)" radius={[5, 5, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with a legend. */
export function Donut({
  data,
  height = 180,
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex items-center gap-4">
      <div
        style={{ height, width: height }}
        className="shrink-0"
        role="img"
        aria-label={data.map((d) => `${d.label} ${d.value}`).join(", ")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={total ? data : [{ label: "None", value: 1, color: "var(--surface-3)" }]}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              strokeWidth={0}
              isAnimationActive={false}
            >
              {(total ? data : [{ color: "var(--surface-3)" }]).map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            {total > 0 && <Tooltip contentStyle={tooltipStyle} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5 text-[13px]">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
            <span className="text-muted">{d.label}</span>
            <b className="tabular ml-auto pl-3 font-semibold">{d.value.toLocaleString("en-NG")}</b>
            <span className="tabular w-10 text-right text-xs text-faint">
              {total ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stacked bars: one bar per label, one coloured segment per series (e.g. giving by fund each week). */
export function StackedBars({
  data,
  series,
  height = 240,
  format = (v: number) => v.toLocaleString("en-NG"),
  label,
  grouped = false,
}: {
  data: Record<string, number | string>[];
  series: { key: string; name: string; color: string }[];
  height?: number;
  format?: (v: number) => string;
  label: string;
  /** Bars side by side instead of stacked, e.g. income next to spending. */
  grouped?: boolean;
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="var(--faint)" />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            stroke="var(--faint)"
            width={56}
            tickFormatter={(v) => format(Number(v))}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={tooltipStyle}
            formatter={(v, n) => [format(Number(v)), n]}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId={grouped ? undefined : "a"}
              fill={s.color}
              maxBarSize={grouped ? 18 : 32}
              radius={grouped || i === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
