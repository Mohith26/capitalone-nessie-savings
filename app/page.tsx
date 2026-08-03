export default function HomePage() {
  return (
    <div className="stack">
      <div className="card">
        <h1>RoundUps</h1>
        <p className="muted">
          A micro-savings platform built on Capital One&apos;s Nessie mock-banking API: round-up rules, a
          plain-English rule compiler with safety rails, goal tracking, and a 500-customer savings simulation.
        </p>
        <div className="row">
          <a href="/accounts">
            <button>Browse accounts</button>
          </a>
          <a href="/simulation">
            <button className="secondary">View simulation results</button>
          </a>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <h3>Safety rails</h3>
          <p className="muted">
            Every rule always enforces a balance floor and a daily transfer cap, and every transfer amount is a
            positive integer number of cents. These are enforced by code at execution time, not by the LLM.
          </p>
        </div>
        <div className="card">
          <h3>Plain-English compiler</h3>
          <p className="muted">
            Type a rule like &ldquo;save $5 every time I order coffee&rdquo; and a local LLM (Ollama) proposes a
            structured rule, which is validated and previewed with a projected monthly impact before you activate
            it.
          </p>
        </div>
      </div>
    </div>
  );
}
