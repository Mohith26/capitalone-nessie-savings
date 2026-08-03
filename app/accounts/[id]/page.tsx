"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { GoalThermometer } from "@/components/GoalThermometer";

interface RuleRow {
  id: string;
  name: string;
  sourceText: string | null;
  dsl: { trigger: { type: string }; action: { type: string } };
  active: boolean;
}
interface TransferRow {
  id: string;
  amountCents: number;
  transactionDate: string;
  triggeringTransactionId: string;
  ruleName: string | null;
  ruleSourceText: string | null;
}
interface GoalRow {
  id: string;
  name: string;
  targetCents: number;
}
interface CustomerDetail {
  entry: { customerId: string; firstName: string; lastName: string; personaKind: string };
  checking: { balance: number };
  savings: { balance: number };
  rules: RuleRow[];
  goals: GoalRow[];
  transfers: TransferRow[];
}

type PreviewOutcome =
  | { status: "preview"; dsl: unknown; explanation: string; projectedMonthlyImpactCents: number }
  | { status: "rejected"; reason: string };

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;

  const [data, setData] = useState<CustomerDetail | null>(null);
  const [nlText, setNlText] = useState("save $5 every time I order coffee");
  const [preview, setPreview] = useState<PreviewOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/${customerId}`);
    if (res.ok) setData(await res.json());
  }, [customerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/rules/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId, text: nlText }),
      });
      const outcome = (await res.json()) as PreviewOutcome;
      setPreview(outcome);
    } catch {
      setError("Preview request failed. Is the Ollama server running?");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    if (!preview || preview.status !== "preview") return;
    setBusy(true);
    try {
      await fetch("/api/rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId,
          name: ruleName || nlText.slice(0, 40),
          sourceText: nlText,
          dsl: preview.dsl,
        }),
      });
      setPreview(null);
      setNlText("");
      setRuleName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="card">Loading…</div>;

  return (
    <div className="stack">
      <div className="card">
        <h1>
          {data.entry.firstName} {data.entry.lastName}
        </h1>
        <span className="badge">{data.entry.personaKind.replace("_", " ")}</span>
        <div className="grid grid-2" style={{ marginTop: 16 }}>
          <div>
            <div className="muted">Checking</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>${(data.checking.balance / 100).toFixed(2)}</div>
          </div>
          <div>
            <div className="muted">Savings</div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "var(--accent)" }}>
              ${(data.savings.balance / 100).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {data.goals.length > 0 && (
        <div className="card stack">
          <h3>Goals</h3>
          {data.goals.map((g) => (
            <GoalThermometer key={g.id} name={g.name} targetCents={g.targetCents} currentCents={data.savings.balance} />
          ))}
        </div>
      )}

      <div className="card stack">
        <h3>Add a rule (plain English)</h3>
        <textarea rows={2} value={nlText} onChange={(e) => setNlText(e.target.value)} />
        <div className="row">
          <button onClick={handlePreview} disabled={busy || !nlText.trim()}>
            {busy ? "Working…" : "Preview"}
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {preview && preview.status === "rejected" && (
          <div className="badge danger" style={{ padding: 12 }}>
            Rejected: {preview.reason}
          </div>
        )}
        {preview && preview.status === "preview" && (
          <div className="card" style={{ background: "var(--panel-2)" }}>
            <p>{preview.explanation}</p>
            <p className="muted">
              Projected impact: ${(preview.projectedMonthlyImpactCents / 100).toFixed(2)}/month based on this
              customer&apos;s 6-month history.
            </p>
            <input placeholder="Rule name (optional)" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}>
              <button onClick={handleActivate} disabled={busy}>
                Activate
              </button>
              <button className="secondary" onClick={() => setPreview(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Active rules</h3>
        {data.rules.length === 0 && <p className="muted">No rules yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Trigger</th>
              <th>Action</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.dsl.trigger.type}</td>
                <td>{r.dsl.action.type}</td>
                <td className="muted">{r.sourceText ?? "form"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Transfer history</h3>
        {data.transfers.length === 0 && <p className="muted">No transfers yet.</p>}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Rule</th>
              <th>Triggering transaction</th>
            </tr>
          </thead>
          <tbody>
            {data.transfers.map((t) => (
              <tr key={t.id}>
                <td>{t.transactionDate}</td>
                <td>${(t.amountCents / 100).toFixed(2)}</td>
                <td>{t.ruleName ?? "—"}</td>
                <td className="muted">{t.triggeringTransactionId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
