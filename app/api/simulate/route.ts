import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  const filePath = path.resolve("data/simulation-results.json");
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "no simulation results yet -- run `npm run sim`" }, { status: 404 });
  }
  const report = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return NextResponse.json(report);
}
