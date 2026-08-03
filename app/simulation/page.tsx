"use client";

import { useEffect, useState } from "react";
import { RuleMixChart, PersonaMixChart } from "@/components/SimulationCharts";

interface SimReport {
  ranAt: string;
  overall: {
    customerCount: number;
    medianMonthlySavedCents: number;
    p25MonthlySavedCents: number;
    p75MonthlySavedCents: number;
    totalTransfersExecuted: number;
    totalTransfersBlocked: number;
  };
  byRuleMix: Array<{
    ruleMixName: string;
    customerCount: number;
    medianMonthlySavedCents: number;
    p25MonthlySavedCents: number;
    p75MonthlySavedCents: number;
  }>;
  byPersonaAndMix: Array<{
    personaKind: string;
    ruleMixName: string;
    customerCount: number;
    medianMonthlySavedCents: number;
    p25MonthlySavedCents: number;
    p75MonthlySavedCents: number;
  }>;
}

export default function SimulationPage() {
  const [report, setReport] = useState<SimReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/simulate")
      .then(async (res) => {
        if (!res.ok) {
          setErrorMsg((await res.json()).error ?? "failed to load");
          return;
        }
        setReport(await res.json());
      })
      .catch(() => setErrorMsg("failed to load simulation results"));
  }, []);

  if (errorMsg) return <div className="card">{errorMsg}</div>;
  if (!report) return <div className="card">Loading…</div>;

  return (
    <div className="stack">
      <div className="card">
        <h1>Simulation results</h1>
        <p className="muted">
          {report.overall.customerCount} synthetic customers replayed across 6 months of seeded history. Ran at{" "}
          {new Date(report.ranAt).toLocaleString()}.
        </p>
        <div className="grid grid-2">
          <div>
            <div className="muted">Overall median monthly savings</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>${(report.overall.medianMonthlySavedCents / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="muted">Transfers executed / blocked by safety rails</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {report.overall.totalTransfersExecuted} / {report.overall.totalTransfersBlocked}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Median monthly savings by rule mix (with p25/p75 band)</h3>
        <RuleMixChart data={report.byRuleMix} />
      </div>

      <div className="card">
        <h3>Median monthly savings by persona × rule mix</h3>
        <PersonaMixChart data={report.byPersonaAndMix} />
      </div>
    </div>
  );
}
