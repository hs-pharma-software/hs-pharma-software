import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'product_detail_screen.dart';
import 'sales_screen.dart';
import 'states.dart';
import 'theme.dart';
import 'web_section.dart';

/// The website's Dashboard (src/app/dashboard/page.tsx, GeneralDashboard) on
/// a phone, in the same order: date and business name with New Invoice and
/// New Purchase; Today's Sales, Invoices Today, Cash In, Cash Out; Receivable,
/// Payable, Products, Expenses; Expiring Within 6 Months; Low Stock Alert;
/// Recent Invoices; Top Selling Products; Customers, Suppliers, Products.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onNewInvoice, required this.onNewPurchase});
  final VoidCallback onNewInvoice;
  final VoidCallback onNewPurchase;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Dashboard? _d;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool force = false}) async {
    try {
      final d = await AppScope.read(context).dashboard(force: force);
      if (mounted) {
        setState(() {
          _d = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  void _web(String title, String path) => Navigator.push(context, MaterialPageRoute(builder: (_) => WebSectionPage(title: title, path: path)));

  @override
  Widget build(BuildContext context) {
    final boot = AppScope.of(context).boot!;
    final canSell = boot.section('invoices') != null;
    final canBuy = boot.section('purchase') != null;
    final d = _d;
    if (d == null && _error != null) return StateMessage.error(_error!, onRetry: () => _load(force: true));
    if (d == null) return const Center(child: CircularProgressIndicator());

    final day = DateTime.tryParse(d.today) ?? DateTime.now();
    return RefreshIndicator(
      onRefresh: () => _load(force: true),
      child: ListView(padding: const EdgeInsets.fromLTRB(12, 14, 12, 24), children: [
        // Header: date, business name, New Invoice / New Purchase.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SmallCaps(DateFormat('EEEE, MMMM d, y', 'en_US').format(day)),
            const SizedBox(height: 2),
            Text(boot.businessName, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: ink, letterSpacing: -.3)),
          ]),
        ),
        if (canSell || canBuy) ...[
          const SizedBox(height: 12),
          Row(children: [
            if (canSell)
              Expanded(child: GradientButton(label: 'New Invoice', icon: Icons.description_outlined, colors: const [saleGreen, mavinGreen], onPressed: widget.onNewInvoice)),
            if (canSell && canBuy) const SizedBox(width: 10),
            if (canBuy)
              Expanded(child: GradientButton(label: 'New Purchase', icon: Icons.shopping_cart_outlined, colors: const [purchaseBlue, Color(0xFF3B82F6)], onPressed: widget.onNewPurchase)),
          ]),
        ],
        const SizedBox(height: 14),
        _KpiGrid([
          _Kpi('Today\'s Sales', rs0(d.sales), accent: const Color(0xFF10B981)),
          _Kpi('Invoices Today', '${d.invoiceCount}'),
          _Kpi('Cash In', rs0(d.cashIn), accent: const Color(0xFF3B82F6)),
          _Kpi('Cash Out', rs0(d.cashOut), accent: const Color(0xFFF43F5E)),
          _Kpi('Receivable', rs0(d.receivable), accent: const Color(0xFF8B5CF6)),
          _Kpi('Payable', rs0(d.payable), accent: const Color(0xFFF97316)),
          _Kpi('Products', '${d.products}'),
          _Kpi('Expenses', rs0(d.expenses), accent: const Color(0xFFF43F5E)),
        ]),
        const SizedBox(height: 14),
        _Panel(
          title: 'Expiring Within 6 Months',
          count: d.expiring.length,
          onViewAll: boot.section('stock') == null ? null : () => _web('Stock Details', boot.section('stock')!.path),
          children: d.expiring.isEmpty
              ? const [_Empty('No batches expiring soon.')]
              : [
                  for (final x in d.expiring)
                    _Line(
                      title: x.product,
                      sub: 'Batch: ${x.batchNo ?? '—'}',
                      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
                        _ExpiryBadge(expiry: x.expiry, today: day),
                        const SizedBox(height: 3),
                        Text('${qty(x.qty)} units', style: const TextStyle(fontSize: 11.5, color: muted)),
                      ]),
                    ),
                ],
        ),
        const SizedBox(height: 12),
        _Panel(
          title: 'Low Stock Alert',
          count: d.lowStock.length,
          onViewAll: boot.section('stock') == null ? null : () => _web('Stock Details', boot.section('stock')!.path),
          children: d.lowStock.isEmpty
              ? const [_Empty('All products sufficiently stocked.')]
              : [
                  for (final x in d.lowStock)
                    _Line(
                      title: x.name,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(id: x.id, name: x.name))),
                      trailing: _Pill('${qty(x.qty)} left', fg: const Color(0xFFB45309), bg: amberHi),
                    ),
                ],
        ),
        const SizedBox(height: 12),
        _Panel(
          title: 'Recent Invoices',
          count: d.recent.length,
          onViewAll: canSell ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SalesScreen())) : null,
          children: d.recent.isEmpty
              ? const [_Empty('No invoices yet.')]
              : [
                  for (final x in d.recent)
                    _Line(
                      title: '${x.no == null ? '' : '#${x.no} · '}${x.customer}',
                      sub: dayMonthYear(x.date),
                      onTap: canSell ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: x.id, no: x.no))) : null,
                      trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
                        Text(rs(x.total), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                        if (x.balance > 0.004) Text('Due ${rs(x.balance)}', style: const TextStyle(fontSize: 11.5, color: noStock, fontWeight: FontWeight.w600)),
                      ]),
                    ),
                ],
        ),
        const SizedBox(height: 12),
        _Panel(
          title: 'Top Selling Products',
          count: d.topSelling.length,
          children: d.topSelling.isEmpty
              ? const [_Empty('No sales yet.')]
              : [
                  for (var i = 0; i < d.topSelling.length; i++)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          SizedBox(width: 26, child: Text('#${i + 1}', style: const TextStyle(color: faint, fontWeight: FontWeight.w700, fontSize: 12.5))),
                          Expanded(child: Text(d.topSelling[i].name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
                          Text('${qty(d.topSelling[i].qty)} sold', style: const TextStyle(color: muted, fontSize: 12)),
                        ]),
                        const SizedBox(height: 6),
                        Padding(
                          padding: const EdgeInsets.only(left: 26),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              minHeight: 5,
                              value: d.topSelling.first.sales <= 0 ? 0 : d.topSelling[i].sales / d.topSelling.first.sales,
                              backgroundColor: const Color(0xFFF0F0F0),
                              color: mavinAccent,
                            ),
                          ),
                        ),
                      ]),
                    ),
                ],
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: _CountTile('Customers', d.customers, Icons.groups_outlined, onTap: boot.section('customers') == null ? null : () => _web('Customers', boot.section('customers')!.path))),
          const SizedBox(width: 10),
          Expanded(child: _CountTile('Suppliers', d.suppliers, Icons.local_shipping_outlined, onTap: boot.section('suppliers') == null ? null : () => _web('Suppliers', boot.section('suppliers')!.path))),
          const SizedBox(width: 10),
          Expanded(child: _CountTile('Products', d.products, Icons.inventory_2_outlined)),
        ]),
      ]),
    );
  }
}

/// "Rs 12,345" (whole rupees, as the website's KPI cards).
String rs0(num v) => 'Rs ${NumberFormat('#,##0', 'en_US').format(v.round())}';

class _Kpi {
  const _Kpi(this.label, this.value, {this.accent});
  final String label;
  final String value;
  final Color? accent;
}

class _KpiGrid extends StatelessWidget {
  const _KpiGrid(this.items);
  final List<_Kpi> items;

  @override
  Widget build(BuildContext context) {
    final cols = MediaQuery.sizeOf(context).width >= 700 ? 4 : 2;
    return GridView.count(
      crossAxisCount: cols,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.9,
      children: [
        for (final k in items)
          WebCard(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Row(children: [
                if (k.accent != null) Container(width: 6, height: 6, margin: const EdgeInsets.only(right: 6), decoration: BoxDecoration(color: k.accent, shape: BoxShape.circle)),
                Expanded(child: SmallCaps(k.label)),
              ]),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(k.value, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: k.accent ?? ink, letterSpacing: -.4)),
              ),
            ]),
          ),
      ],
    );
  }
}

/// A dashboard card: title, a grey count badge and "View all →".
class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.count, required this.children, this.onViewAll});
  final String title;
  final int count;
  final List<Widget> children;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    return WebCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(
            child: Row(children: [
              Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700))),
              const SizedBox(width: 6),
              _Pill('$count', fg: muted, bg: const Color(0xFFF0F0F0)),
            ]),
          ),
          const SizedBox(width: 8),
          if (onViewAll != null)
            InkWell(
              onTap: onViewAll,
              child: const Padding(padding: EdgeInsets.symmetric(vertical: 4), child: Text('View all →', style: TextStyle(fontSize: 12.5, color: mavinAccent, fontWeight: FontWeight.w600))),
            ),
        ]),
        const SizedBox(height: 4),
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const Divider(), children[i]],
      ]),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.title, this.sub, this.trailing, this.onTap});
  final String title;
  final String? sub;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
              if (sub != null) Text(sub!, style: const TextStyle(fontSize: 12, color: muted)),
            ]),
          ),
          if (trailing != null) ...[const SizedBox(width: 10), trailing!],
        ]),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, {required this.fg, required this.bg});
  final String text;
  final Color fg;
  final Color bg;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg)),
      );
}

/// The website's expiry badge: Expired red, within 30 days rose, 90 days orange, else amber.
class _ExpiryBadge extends StatelessWidget {
  const _ExpiryBadge({required this.expiry, required this.today});
  final String expiry;
  final DateTime today;

  @override
  Widget build(BuildContext context) {
    final d = DateTime.tryParse(expiry);
    final days = d == null ? 9999 : d.difference(DateTime(today.year, today.month, today.day)).inDays;
    final (fg, bg) = days < 0
        ? (const Color(0xFFDC2626), const Color(0xFFFEE2E2))
        : days <= 30
            ? (const Color(0xFFE11D48), const Color(0xFFFFE4E6))
            : days <= 90
                ? (const Color(0xFFEA580C), const Color(0xFFFFEDD5))
                : (const Color(0xFFB45309), amberHi);
    return _Pill(days < 0 ? 'Expired' : monthYear(expiry), fg: fg, bg: bg);
  }
}

class _CountTile extends StatelessWidget {
  const _CountTile(this.label, this.count, this.icon, {this.onTap});
  final String label;
  final int count;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => WebCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20, color: mavinAccent),
          const SizedBox(height: 6),
          Text('$count', style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w700)),
          Text(label, style: const TextStyle(fontSize: 12, color: muted)),
        ]),
      );
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(text, style: const TextStyle(color: muted, fontSize: 13)));
}
