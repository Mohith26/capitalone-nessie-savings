import { loadDirectory } from "@/src/db/directory";

export const dynamic = "force-dynamic";

export default function AccountsPage() {
  const directory = loadDirectory();
  const shown = directory.slice(0, 50);

  return (
    <div className="stack">
      <div className="card">
        <h1>Accounts</h1>
        <p className="muted">
          Showing {shown.length} of {directory.length} seeded customers. Click one to view balances, rules, goals,
          and transfer history.
        </p>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Persona</th>
              <th>Monthly income</th>
              <th>Purchases (6mo)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.customerId}>
                <td>
                  {c.firstName} {c.lastName}
                </td>
                <td>
                  <span className="badge">{c.personaKind.replace("_", " ")}</span>
                </td>
                <td>${(c.monthlyIncomeCents / 100).toFixed(2)}</td>
                <td>{c.purchaseCount}</td>
                <td>
                  <a href={`/accounts/${c.customerId}`}>View →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
