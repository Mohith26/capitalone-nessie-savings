import { NextResponse } from "next/server";
import { loadDirectory } from "@/src/db/directory";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const directory = loadDirectory();
  return NextResponse.json({ total: directory.length, customers: directory.slice(0, limit) });
}
