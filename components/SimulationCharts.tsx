"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface ByMix {
  ruleMixName: string;
  customerCount: number;
  medianMonthlySavedCents: number;
  p25MonthlySavedCents: number;
  p75MonthlySavedCents: number;
}
interface ByPersonaAndMix extends ByMix {
  personaKind: string;
}

export function RuleMixChart({ data }: { data: ByMix[] }) {
  const chartData = data.map((d) => ({
    name: d.ruleMixName.replace(/_/g, " "),
    median: +(d.medianMonthlySavedCents / 100).toFixed(2),
    p25: +(d.p25MonthlySavedCents / 100).toFixed(2),
    p75: +(d.p75MonthlySavedCents / 100).toFixed(2),
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#26313f" />
        <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} height={60} stroke="#93a4b8" />
        <YAxis stroke="#93a4b8" tickFormatter={(v) => `$${v}`} />
        <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} contentStyle={{ background: "#121821", border: "1px solid #26313f" }} />
        <Legend />
        <Bar dataKey="p25" name="p25" fill="#5b9cf6" opacity={0.5} />
        <Bar dataKey="median" name="median" fill="#4fd1a5" />
        <Bar dataKey="p75" name="p75" fill="#5b9cf6" opacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PersonaMixChart({ data }: { data: ByPersonaAndMix[] }) {
  const mixes = [...new Set(data.map((d) => d.ruleMixName))];
  const personas = [...new Set(data.map((d) => d.personaKind))];
  const chartData = personas.map((persona) => {
    const row: Record<string, number | string> = { persona: persona.replace(/_/g, " ") };
    for (const mix of mixes) {
      const match = data.find((d) => d.personaKind === persona && d.ruleMixName === mix);
      row[mix] = match ? +(match.medianMonthlySavedCents / 100).toFixed(2) : 0;
    }
    return row;
  });
  const colors = ["#4fd1a5", "#5b9cf6", "#f0b93d", "#f0605b"];

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#26313f" />
        <XAxis dataKey="persona" angle={-20} textAnchor="end" interval={0} height={60} stroke="#93a4b8" />
        <YAxis stroke="#93a4b8" tickFormatter={(v) => `$${v}`} />
        <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} contentStyle={{ background: "#121821", border: "1px solid #26313f" }} />
        <Legend />
        {mixes.map((mix, i) => (
          <Bar key={mix} dataKey={mix} name={mix.replace(/_/g, " ")} fill={colors[i % colors.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
