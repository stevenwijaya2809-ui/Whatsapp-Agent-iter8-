import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/http";
import { getDashboardStats } from "@/lib/stats";

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), MAX_DAYS) : DEFAULT_DAYS;

  try {
    return Response.json(await getDashboardStats(days));
  } catch (error) {
    return errorResponse(error);
  }
}
