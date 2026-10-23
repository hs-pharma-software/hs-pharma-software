"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { dbSelect } from "@/lib/db";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { CountUp } from "@/components/ui/CountUp";
import {
  getLowStockProducts,
  getExpiringSoonBatches,
  getRecentInvoices,
  getTopSellingProducts,
  getTodaySummary,
  getInventoryByUnitType,
  countProducts,
  type LowStockRow,
  type ExpiringBatchRow,
  type RecentInvoiceRow,
  type TopProductRow,
  type TodaySummary,
  type InventoryUnitRow,
} from "@/lib/repo/dashboard";
import { getTotalPartyBalance } from "@/lib/repo/ledger";
import { loadLogo } from "@/lib/printTemplates";
import { businessType } from "@/config/businessTypes";
import { RestaurantDashboard } from "@/components/restaurant/RestaurantDashboard";
import { ElectricDashboard } from "@/components/electric/ElectricDashboard";
import { ELECTRIC_TYPE } from "@/lib/electric";
import { DistDashboard } from "@/components/dist/DistDashboard";

interface DashboardStats {
  customers: number;
  suppliers: number;
  products: number;
  customerReceivable: number;
  supplierPayable: number;
}

const EMPTY_STATS: DashboardStats = { customers: 0, suppliers: 0, products: 0, customerReceivable: 0, supplierPayable: 0 };
const EMPTY_TODAY: TodaySummary = { sales: 0, invoiceCount: 0, expenses: 0, cashIn: 0, cashOut: 0 };

async function count(table: string, tenantScoped = false): Promise<number> {
  const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) as n FROM ${table} WHERE deleted_at IS NULL ${tenantScoped ? "AND tenant_id = ?" : ""}`,
    tenantScoped ? [tenantId] : []
  );
  return rows[0]?.n ?? 0;
}

/* ── Donut chart ── */
const DONUT_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f97316", "#f43f5e", "#0ea5e9", "#f59e0b", "#14b8a6"];
const R = 46;
const CX = 60;
const CY = 60;
const CIRCUMFERENCE = 2 * Math.PI * R;

function DonutChart({ data }: { data: InventoryUnitRow[] }) {
  const total = data.reduce((s, r) => s + r.product_count, 0);
  if (total === 0) {
    return (
      <div className="flex h-36 items-center justify-center text-xs text-neutral-400">No inventory data</div>
    );
  }

  let cumOffset = 0;
  const segments = data.map((row, i) => {
    const frac = row.product_count / total;
    const dashLen = frac * CIRCUMFERENCE;
    const offset = cumOffset;
    cumOffset += frac;
    return { ...row, frac, dashLen, offset, color: DONUT_COLORS[i % DONUT_COLORS.length] };
  });

  return (
    <div className="flex items-center gap-6">
      <div className="shrink-0">
        <svg width="120" height="120" viewBox="0 0 120 120">
          {/* Track */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f3f4f6" strokeWidth="14" />
          {segments.map((seg, i) => (
            <circle
              key={i}
              cx={CX} cy={CY} r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth="14"
              strokeDasharray={`${seg.dashLen} ${CIRCUMFERENCE}`}
              strokeDashoffset={-seg.offset * CIRCUMFERENCE}
              strokeLinecap="butt"
              transform={`rotate(-90 ${CX} ${CY})`}
            />
          ))}
          <text x={CX} y={CY - 5} textAnchor="middle" fontSize="16" fontWeight="700" fill="#111827">{total}</text>
          <text x={CX} y={CY + 10} textAnchor="middle" fontSize="8" fill="#9ca3af" letterSpacing="0.5">PRODUCTS</text>
        </svg>
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        {segments.map((seg) => (
          <div key={seg.unit_type} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seg.color }} />
            <span className="truncate text-neutral-600">{seg.unit_type}</span>
            <span className="ml-auto shrink-0 font-semibold text-neutral-800">{seg.product_count}</span>
            <span className="shrink-0 text-neutral-400">{(seg.frac * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── KPI card ── */
function KpiCard({
  label, value, sub, money, accent, delay = 0,
}: {
  label: string; value: number; sub?: string; money?: boolean; accent?: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 260, damping: 28 }}
      className="flex flex-col gap-1 rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]"
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="text-2xl font-bold tracking-tight text-neutral-900" style={accent ? { color: accent } : {}}>
        <CountUp value={value} format={(n) => (money ? `Rs ${Math.round(n).toLocaleString()}` : String(Math.round(n)))} />
      </p>
      {sub && <p className="text-xs text-neutral-400">{sub}</p>}
    </motion.div>
  );
}

/* ── Section card ── */
function Card({ title, badge, href, children }: { title: string; badge?: string | number; href?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-2xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
          {badge !== undefined && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">{badge}</span>
          )}
        </div>
        {href && (
          <Link href={href} className="text-[11px] font-medium hover:underline" style={{ color: "var(--accent)" }}>
            View all →
          </Link>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ── Days-until formatter ── */
function daysUntil(dateStr: string): number {
  const now = new Date();
  const exp = new Date(dateStr);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function ExpiryBadge({ dateStr }: { dateStr: string }) {
  const days = daysUntil(dateStr);
  if (days < 0) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Expired</span>;
  if (days <= 30) return <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">{days}d</span>;
  if (days <= 90) return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">{days}d</span>;
  return <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">{days}d</span>;
}

/* ══════════════════════════════════════════════ Page ══════════════════════════════════════════════ */
/** Restaurant and electric/solar store tenants get their own dashboards; everyone else the general one. */
export default function DashboardPage() {
  const tenant = useAuthStore((s) => s.currentTenant);
  if (tenant && businessType(tenant.businessType).id === "restaurant") return <RestaurantDashboard name={tenant.name} />;
  if (tenant && businessType(tenant.businessType).id === ELECTRIC_TYPE) return <ElectricDashboard name={tenant.name} />;
  if (tenant && businessType(tenant.businessType).id === "distributor") return <DistDashboard name={tenant.name} />;
  return <GeneralDashboard />;
}

function GeneralDashboard() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [today, setToday] = useState<TodaySummary>(EMPTY_TODAY);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [expiring, setExpiring] = useState<ExpiringBatchRow[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoiceRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [unitBreakdown, setUnitBreakdown] = useState<InventoryUnitRow[]>([]);
  const tauriReady = useIsTauri();

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const [customers, suppliers, products, customerReceivable, supplierPayable, todaySummary, low, exp, recent, top, units] =
          await Promise.all([
            count("customers", true),
            count("suppliers", true),
            countProducts(),
            getTotalPartyBalance("customer"),
            getTotalPartyBalance("supplier"),
            getTodaySummary(),
            getLowStockProducts(8),
            getExpiringSoonBatches(180, 12),
            getRecentInvoices(6),
            getTopSellingProducts(5),
            getInventoryByUnitType(),
          ]);
        setStats({ customers, suppliers, products, customerReceivable, supplierPayable });
        setToday(todaySummary);
        setLowStock(low);
        setExpiring(exp);
        setRecentInvoices(recent);
        setTopProducts(top);
        setUnitBreakdown(units);
      } catch (err) {
        console.error("dashboard load failed", err);
      }
    })();
  }, []);

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-PK", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const sessionTenant = useAuthStore((s) => s.currentTenant);
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => {
    if (tauriReady) void loadLogo().then(setLogo);
  }, [tauriReady]);

  return (
    <div className="space-y-5 pb-8">
      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div className="flex items-center gap-4">
          {logo && (
            <div className="flex h-14 max-w-[9rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-[0_1px_4px_rgba(0,0,0,0.07)] ring-1 ring-black/[0.04]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
            </div>
          )}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-neutral-400">{dateLabel}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-neutral-900">
              {sessionTenant?.name ?? "Dashboard"}
            </h1>
          </div>
        </div>
        {!tauriReady && (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-700">
            Browser preview {"\u2014"} no live data
          </span>
        )}
      </div>

      {/* ── KPI row 1: Today's financials ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Today's Sales"   value={today.sales}         money delay={0}    accent="#10b981" />
        <KpiCard label="Invoices Today"  value={today.invoiceCount}         delay={0.04} />
        <KpiCard label="Cash In"         value={today.cashIn}        money delay={0.08} accent="#3b82f6" />
        <KpiCard label="Cash Out"        value={today.cashOut}       money delay={0.12} accent="#f43f5e" />
      </div>

      {/* ── KPI row 2: Master data ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Receivable"  value={stats.customerReceivable} money delay={0.16} accent="#8b5cf6" />
        <KpiCard label="Payable"     value={stats.supplierPayable}    money delay={0.20} accent="#f97316" />
        <KpiCard label="Products"    value={stats.products}                 delay={0.24} />
        <KpiCard label="Expenses"    value={today.expenses}          money delay={0.28} accent="#f43f5e" />
      </div>

      {/* ── Main content ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Inventory breakdown donut */}
        <Card title="Inventory Breakdown" badge={unitBreakdown.reduce((s, r) => s + r.product_count, 0)} href="/products">
          <DonutChart data={unitBreakdown} />
        </Card>

        {/* Expiring in 6 months */}
        <Card title="Expiring Within 6 Months" badge={expiring.length} href="/stock">
          {expiring.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">No batches expiring soon.</p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-50">
              {expiring.map((b) => (
                <div key={b.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-neutral-800">{b.product_name}</p>
                    {b.batch_no && <p className="text-[10px] text-neutral-400">Batch: {b.batch_no}</p>}
                  </div>
                  <div className="ml-3 flex shrink-0 flex-col items-end gap-0.5">
                    <ExpiryBadge dateStr={b.expiry_date} />
                    <span className="text-[10px] text-neutral-400">{b.qty} units</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Low stock */}
        <Card title="Low Stock Alert" badge={lowStock.length} href="/stock">
          {lowStock.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">All products sufficiently stocked.</p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-50">
              {lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <p className="truncate text-xs font-medium text-neutral-800">{p.name}</p>
                  <span className="ml-3 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    {p.avail_qty} left
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Recent invoices */}
        <Card title="Recent Invoices" href="/invoices">
          {recentInvoices.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">No invoices yet.</p>
          ) : (
            <div className="flex flex-col divide-y divide-neutral-50">
              {recentInvoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-xs font-semibold text-neutral-800">#{inv.invoice_no} · {inv.customer_name}</p>
                    <p className="text-[10px] text-neutral-400">{inv.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-neutral-900">Rs {inv.total.toLocaleString()}</p>
                    {inv.balance > 0 && (
                      <p className="text-[10px] text-rose-500">Due Rs {inv.balance.toLocaleString()}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top selling */}
        <Card title="Top Selling Products" href="/reports/product-sales">
          {topProducts.length === 0 ? (
            <p className="py-4 text-center text-xs text-neutral-400">No sales data yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {topProducts.map((p, i) => {
                const maxSales = topProducts[0]?.sales ?? 1;
                const pct = (p.sales / maxSales) * 100;
                return (
                  <div key={p.id}>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-neutral-300">#{i + 1}</span>
                        <span className="text-xs font-medium text-neutral-800 truncate max-w-[160px]">{p.name}</span>
                      </div>
                      <span className="text-xs text-neutral-500">{p.qty} sold</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: 0.3 + i * 0.07, duration: 0.5 }}
                        className="h-full rounded-full"
                        style={{ background: "var(--accent)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ── Quick counts footer ── */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/customers" className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] hover:shadow-md transition-shadow">
          <span className="text-xs font-medium text-neutral-500">Customers</span>
          <span className="text-sm font-bold text-neutral-900">{stats.customers}</span>
        </Link>
        <Link href="/suppliers" className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] hover:shadow-md transition-shadow">
          <span className="text-xs font-medium text-neutral-500">Suppliers</span>
          <span className="text-sm font-bold text-neutral-900">{stats.suppliers}</span>
        </Link>
        <Link href="/products" className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] hover:shadow-md transition-shadow">
          <span className="text-xs font-medium text-neutral-500">Products</span>
          <span className="text-sm font-bold text-neutral-900">{stats.products}</span>
        </Link>
      </div>
    </div>
  );
}
