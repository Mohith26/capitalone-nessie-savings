import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoundUps — Micro-Savings Engine",
  description: "A micro-savings platform on Capital One's Nessie mock-banking API.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <a href="/" className="brand">
              RoundUps
            </a>
            <nav>
              <a href="/accounts">Accounts</a>
              <a href="/simulation">Simulation</a>
            </nav>
          </header>
          <main className="app-main">{children}</main>
        </div>
      </body>
    </html>
  );
}
