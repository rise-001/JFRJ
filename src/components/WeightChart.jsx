import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatEntryDate } from "@/lib/dashboard";
import { kgToJin } from "@/lib/weight";

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-white/80 bg-stone-900 px-3 py-2 text-xs text-white shadow-soft">
      <span className="text-stone-300">{label}</span>
      <strong className="ml-2">{payload[0].value.toFixed(1)} 斤</strong>
    </div>
  );
}

export function WeightChart({ entries, goalWeight }) {
  if (!entries.length) {
    return <div className="grid h-[250px] place-items-center text-center text-sm text-muted-foreground lg:h-[315px]">新增一条体重记录后，这里会生成趋势</div>;
  }
  const data = entries.map((entry) => ({ label: formatEntryDate(entry.date), weight: kgToJin(entry.weight) }));
  const values = data.map((entry) => entry.weight);
  const min = Math.min(...values) - 0.6;
  const max = Math.max(...values) + 0.6;

  return (
    <div className="h-[250px] w-full lg:h-[315px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 14, right: 10, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ee8078" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#ee8078" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#8b81751a" strokeDasharray="4 5" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#9c9389", fontSize: 11 }} dy={10} />
          <YAxis hide domain={[min, max]} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#ee8078", strokeOpacity: 0.16 }} />
          {kgToJin(goalWeight) >= min && kgToJin(goalWeight) <= max && <ReferenceLine y={kgToJin(goalWeight)} stroke="#5b8f7d" strokeDasharray="5 5" strokeOpacity={0.5} />}
          <Area type="monotone" dataKey="weight" fill="url(#weightFill)" stroke="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="weight" stroke="#ea7e76" strokeWidth={3.5} dot={{ r: 4, fill: "#fffaf5", stroke: "#ea7e76", strokeWidth: 3 }} activeDot={{ r: 6, fill: "#fff", stroke: "#df6f68", strokeWidth: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
