"use client";

import { useEffect, useState } from "react";
import type { DailyCount, DashboardStats } from "@/lib/stats";

const PERIODS = [7, 30];

/** Chart geometry, in the SVG's own coordinates. */
const CHART = { width: 640, plotHeight: 110, axisBand: 20, padLeft: 34, padRight: 8, maxBarWidth: 24, gap: 2 };

interface ResultsSummaryProps {
  className?: string;
}

export function ResultsSummary({ className = "" }: ResultsSummaryProps) {
  const [days, setDays] = useState(PERIODS[1]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/stats?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <section className={`overflow-y-auto px-6 py-8 ${className}`} aria-label="Results summary">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Results</h2>
          <div role="group" aria-label="Time range" className="flex rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-xs font-medium">
            {PERIODS.map((period) => (
              <button
                key={period}
                type="button"
                aria-pressed={period === days}
                onClick={() => {
                  if (period === days) return;
                  setLoading(true);
                  setDays(period);
                }}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  period === days ? "bg-white/[0.08] text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {period} days
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        ) : !stats ? (
          <p className="text-xs text-white/30">{loading ? "Loading results…" : "No results yet"}</p>
        ) : (
          <>
            <p className="text-5xl font-semibold tracking-tight text-white">{formatNumber(stats.conversations)}</p>
            <p className="mt-1 text-xs text-white/40">
              conversation{stats.conversations === 1 ? "" : "s"} in the last {stats.days} days
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Tile label="Messages received" value={formatNumber(stats.customerMessages)} />
              <Tile label="Handled by AI alone" value={formatNumber(stats.handledByAiOnly)} dot="bg-emerald-400" />
              <Tile label="Arrived after hours" value={formatNumber(stats.afterHours)} />
              <Tile label="Replies you sent" value={formatNumber(stats.humanReplies)} dot="bg-orange-400" />
              <Tile label="Median reply time" value={formatMinutes(stats.medianReplyMinutes)} />
              <Tile
                label="Awaiting your reply"
                value={formatNumber(stats.awaitingReply)}
                dot={stats.awaitingReply > 0 ? "bg-amber-400" : undefined}
              />
            </div>

            <h3 className="mt-8 mb-3 text-xs font-medium text-white/60">Messages received per day</h3>
            <DailyChart daily={stats.daily} />
          </>
        )}
      </div>
    </section>
  );
}

function Tile({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] text-white/40">
        {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />}
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function DailyChart({ daily }: { daily: DailyCount[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const height = CHART.plotHeight + CHART.axisBand;
  const plotWidth = CHART.width - CHART.padLeft - CHART.padRight;
  const band = plotWidth / Math.max(daily.length, 1);
  const barWidth = Math.max(2, Math.min(CHART.maxBarWidth, band - CHART.gap));
  const peak = Math.max(...daily.map((day) => day.messages), 1);
  const scale = (value: number) => (value / peak) * CHART.plotHeight;
  const active = hovered === null ? null : daily[hovered];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${CHART.width} ${height}`} className="h-auto w-full" role="img" aria-label="Messages received per day">
        <line x1={CHART.padLeft} y1={0.5} x2={CHART.width - CHART.padRight} y2={0.5} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        <line
          x1={CHART.padLeft}
          y1={CHART.plotHeight + 0.5}
          x2={CHART.width - CHART.padRight}
          y2={CHART.plotHeight + 0.5}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
        />
        <text x={0} y={9} fill="rgba(255,255,255,0.35)" fontSize="10">
          {peak}
        </text>
        <text x={0} y={CHART.plotHeight + 3} fill="rgba(255,255,255,0.35)" fontSize="10">
          0
        </text>

        {daily.map((day, i) => {
          const barHeight = scale(day.messages);
          const x = CHART.padLeft + i * band + (band - barWidth) / 2;
          const y = CHART.plotHeight - barHeight;
          return (
            <g key={day.date}>
              {barHeight > 0 && (
                <path
                  d={roundedTopBar(x, y, barWidth, barHeight)}
                  fill={hovered === i ? "#34d399" : "#10b981"}
                />
              )}
              <rect
                x={CHART.padLeft + i * band}
                y={0}
                width={band}
                height={CHART.plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              />
            </g>
          );
        })}

        {daily.map((day, i) => {
          const isEdge = i === 0 || i === daily.length - 1 || i === Math.floor((daily.length - 1) / 2);
          if (!isEdge) return null;
          return (
            <text
              key={day.date}
              x={CHART.padLeft + i * band + band / 2}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"}
              fill="rgba(255,255,255,0.35)"
              fontSize="10"
            >
              {formatDay(day.date)}
            </text>
          );
        })}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute -top-2 rounded-lg border border-white/10 bg-[#1c1c1c] px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white/90 shadow-lg"
          style={{
            left: `${((CHART.padLeft + (hovered! + 0.5) * band) / CHART.width) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <span className="font-medium">{active.messages}</span> on {formatDay(active.date)}
        </div>
      )}
    </div>
  );
}

/** Bar with a 4px rounded top and square feet on the baseline. */
function roundedTopBar(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M ${x} ${y + height} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height} Z`;
}

function formatNumber(value: number): string {
  return value >= 10_000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${Math.round(minutes % 60)}m`;
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], { day: "numeric", month: "short" });
}
