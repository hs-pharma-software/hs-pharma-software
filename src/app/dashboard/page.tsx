"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Truck,
  Package,
  HandCoins,
  Landmark,
  BadgeDollarSign,
  AlertTriangle,
  CalendarClock,
  Receipt,
  TrendingUp,
} from "lucide-react";
import { motion } from "motion/react";
import { dbSelect } from "@/lib/db";
import { isTauri, useIsTauri } from "@/lib/platform";
import { useAuthStore } from "@/store/authStore";
import { CountUp } from "@/components/ui/CountUp";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  getLowStockProducts,
  getExpiringSoonBatches,
  getRecentInvoices,
  getTopSellingProducts,
  getTodaySummary,
  type LowStockRow,
  type ExpiringBatchRow,
  type RecentInvoiceRow,
  type TopProductRow,
  type TodaySummary,
} from "@/lib/repo/dashboard";
import { getTotalPartyBalance } from "@/lib/repo/ledger";

interface DashboardStats {
  customers: number;
  suppliers: number;
  products: number;
  customerReceivable: number;
  supplierPayable: number;
}

const EMPTY_STATS: DashboardStats = {
  customers: 0,
  suppliers: 0,
  products: 0,
  customerReceivable: 0,
  supplierPayable: 0,
};

const EMPTY_TODAY: TodaySummary = { sales: 0, invoiceCount: 0, expenses: 0, cashIn: 0, cashOut: 0 };

/** `tenantScoped` adds a `tenant_id` filter — pass it for any table other
 * than the shared catalog (categories/sub_categories/uoms/products), whose
 * counts are meant to be the same for every tenant. */
async function count(table: string, tenantScoped = false): Promise<number> {
  const tenantId = useAuthStore.getState().currentTenant?.id ?? null;
  const rows = await dbSelect<{ n: number }>(
    `SELECT COUNT(*) as n FROM ${table} WHERE deleted_at IS NULL ${tenantScoped ? "AND tenant_id = ?" : ""}`,
    tenantScoped ? [tenantId] : []
  );
  return rows[0]?.n ?? 0;
}

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 300, damping: 26 } },
};

function Tile({
  label,
  value,
  icon: Icon,
  tone,
  money,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  tone: string;
  money?: boolean;
}) {
  return (
    <motion.div
      variants={item}
      whileHover={{ y: -3, boxShadow: "0 10px 30px -10px rgba(0,0,0,0.15)" }}
      transition={{ type: "spring", stiffness: 350, damping: 25 }}
      className="flex items-center gap-4 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm"
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${tone} shadow-inner`}
      >
        <Icon size={20} className="text-white drop-shadow-sm" />
      </div>
      <div>
        <p className="text-xs font-medium text-neutral-500">{label}</p>
        <p className="text-xl font-semibold text-neutral-900">
          <CountUp
            value={value}
            format={(n) => (money ? Math.round(n).toLocaleString() : String(Math.round(n)))}
          />
        </p>
      </div>
    </motion.div>
  );
}

function WidgetCard({
  title,
  icon: Icon,
  tone,
  href,
  children,
  empty,
}: {
  title: string;
  icon: React.ElementType;
  tone: string;
  href?: string;
  children: React.ReactNode;
  empty: boolean;
}) {
  return (
    <motion.div
      variants={item}
      className="flex flex-col rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full ${tone}`}>
            <Icon size={14} className="text-white" />
          </span>
          <h2 className="font-serif text-base text-neutral-800">{title}</h2>
        </div>
        {href && (
          <Link href={href} className="text-xs text-amber-700 hover:underline">
            View all
          </Link>
        )}
      </div>
      {empty ? (
        <p className="py-6 text-center text-xs text-neutral-400">Nothing to show right now.</p>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}
    </motion.div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [today, setToday] = useState<TodaySummary>(EMPTY_TODAY);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [expiring, setExpiring] = useState<ExpiringBatchRow[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoiceRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setReady(true);
      return;
    }
    (async () => {
      try {
        const [customers, suppliers, products, customerReceivable, supplierPayable, todaySummary, low, exp, recent, top] =
          await Promise.all([
            count("customers", true),
            count("suppliers", true),
            count("products"),
            getTotalPartyBalance("customer"),
            getTotalPartyBalance("supplier"),
            getTodaySummary(),
            getLowStockProducts(),
            getExpiringSoonBatches(),
            getRecentInvoices(),
            getTopSellingProducts(),
          ]);
        setStats({ customers, suppliers, products, customerReceivable, supplierPayable });
        setToday(todaySummary);
        setLowStock(low);
        setExpiring(exp);
        setRecentInvoices(recent);
        setTopProducts(top);
      } catch (err) {
        console.error("dashboard load failed", err);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const tauriReady = useIsTauri();

  return (
    <div>
      <PageHeader title="Dashboard" />

      {!tauriReady && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          You&apos;re previewing this in a browser tab. Live data (local SQLite via Tauri) is only
          available when running inside the desktop app — run <code>npm run tauri dev</code>.
        </motion.div>
      )}

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Tile label="Today's Sales" value={today.sales} icon={BadgeDollarSign} tone="from-teal-400 to-teal-600" money />
        <Tile label="Invoices Today" value={today.invoiceCount} icon={Receipt} tone="from-purple-400 to-purple-600" />
        <Tile
          label="Customer Receivable"
          value={stats.customerReceivable}
          icon={HandCoins}
          tone="from-indigo-400 to-indigo-600"
          money
        />
        <Tile
          label="Supplier Payable"
          value={stats.supplierPayable}
          icon={Landmark}
          tone="from-rose-400 to-rose-600"
          money
        />
        <Tile label="No. of Customers" value={stats.customers} icon={Users} tone="from-sky-400 to-sky-600" />
        <Tile label="No. of Suppliers" value={stats.suppliers} icon={Truck} tone="from-orange-400 to-orange-600" />
        <Tile label="No. of Products" value={stats.products} icon={Package} tone="from-emerald-400 to-emerald-600" />
        <Tile label="Today's Expenses" value={today.expenses} icon={Receipt} tone="from-red-400 to-red-600" money />
      </motion.div>

      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WidgetCard title="Low Stock Alert" icon={AlertTriangle} tone="bg-amber-500" href="/stock" empty={lowStock.length === 0}>
          {lowStock.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span className="truncate text-neutral-700">{p.name}</span>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {p.avail_qty} left
              </span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard
          title="Expiring Within 30 Days"
          icon={CalendarClock}
          tone="bg-rose-500"
          href="/stock"
          empty={expiring.length === 0}
        >
          {expiring.map((b) => (
            <div key={b.id} className="flex items-center justify-between text-sm">
              <span className="truncate text-neutral-700">
                {b.product_name} {b.batch_no ? `(${b.batch_no})` : ""}
              </span>
              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
                {b.expiry_date}
              </span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard
          title="Recent Invoices"
          icon={Receipt}
          tone="bg-purple-500"
          href="/invoices"
          empty={recentInvoices.length === 0}
        >
          {recentInvoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between text-sm">
              <span className="truncate text-neutral-700">
                #{inv.invoice_no} — {inv.customer_name}
              </span>
              <span className="font-medium text-neutral-800">{inv.total.toFixed(0)}</span>
            </div>
          ))}
        </WidgetCard>

        <WidgetCard
          title="Top Selling Products"
          icon={TrendingUp}
          tone="bg-teal-500"
          href="/reports/product-sales"
          empty={topProducts.length === 0}
        >
          {topProducts.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span className="truncate text-neutral-700">{p.name}</span>
              <span className="text-xs text-neutral-500">
                {p.qty} sold · {p.sales.toFixed(0)}
              </span>
            </div>
          ))}
        </WidgetCard>
      </motion.div>

      {ready && stats.products === 0 && tauriReady && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm"
        >
          No data yet — start by adding{" "}
          <Link href="/products" className="text-amber-700 underline">
            Products
          </Link>{" "}
          and{" "}
          <Link href="/customers" className="text-amber-700 underline">
            Customers
          </Link>
          .
        </motion.div>
      )}
    </div>
  );
}
