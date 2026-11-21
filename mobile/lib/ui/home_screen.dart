import 'package:material_ui/material_ui.dart';

import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'product_detail_screen.dart';
import 'sales_screen.dart';
import 'states.dart';
import 'theme.dart';

/// Home: today's figures, low stock, batches expiring soon and the latest invoices.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onNewInvoice});
  final VoidCallback onNewInvoice;

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

  @override
  Widget build(BuildContext context) {
    final canSell = AppScope.of(context).boot?.section('invoices') != null;
    final d = _d;
    Widget content;
    if (d == null && _error != null) {
      content = StateMessage.error(_error!, onRetry: () => _load(force: true));
    } else if (d == null) {
      content = const Center(child: CircularProgressIndicator());
    } else {
      content = RefreshIndicator(
        onRefresh: () => _load(force: true),
        child: LayoutBuilder(builder: (context, c) {
          final cols = c.maxWidth >= 900 ? 4 : 2;
          return ListView(padding: const EdgeInsets.only(bottom: 96), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
              child: GridView.count(
                crossAxisCount: cols,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.75,
                children: [
                  _Tile('Today\'s sales', rs(d.sales), icon: Icons.trending_up_rounded, color: mavinBlue),
                  _Tile('Invoices today', '${d.invoiceCount}', icon: Icons.receipt_long_rounded, color: const Color(0xFF7A5AF8)),
                  _Tile('Money in', rs(d.cashIn), icon: Icons.south_west_rounded, color: mavinGreen),
                  _Tile('Money out', rs(d.cashOut), note: 'Expenses ${rs(d.expenses)}', icon: Icons.north_east_rounded, color: noStock),
                ],
              ),
            ),
            _Section('Low stock', d.lowStock.isEmpty
                ? [const _Empty('No product is running low.')]
                : [
                    for (final x in d.lowStock)
                      ListTile(
                        title: Text(x.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: Text(x.qty <= 0 ? 'Out of stock' : '${qty(x.qty)} left', style: TextStyle(color: x.qty <= 0 ? noStock : lowStock, fontWeight: FontWeight.w500)),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(id: x.id, name: x.name))),
                      ),
                  ]),
            _Section('Expiring within 6 months', d.expiring.isEmpty
                ? [const _Empty('No batch expires in the next 6 months.')]
                : [
                    for (final x in d.expiring)
                      ListTile(
                        title: Text(x.product, maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text('${x.batchNo ?? 'No batch'} · ${qty(x.qty)} in stock'),
                        trailing: Chip(label: Text(monthYear(x.expiry)), visualDensity: VisualDensity.compact, backgroundColor: const Color(0xFFFFF4E0), side: BorderSide.none),
                      ),
                  ]),
            _Section('Recent invoices', d.recent.isEmpty
                ? [const _Empty('No invoices yet.')]
                : [
                    for (final x in d.recent)
                      ListTile(
                        onTap: canSell ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: x.id, no: x.no))) : null,
                        title: Text('${x.no == null ? '' : '#${x.no} · '}${x.customer}', maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(rs(x.total), style: const TextStyle(fontWeight: FontWeight.w500)),
                          if (x.balance > 0) Text('Due ${rs(x.balance)}', style: const TextStyle(fontSize: 12, color: noStock)),
                        ]),
                      ),
                    if (canSell)
                      ListTile(
                        title: const Text('All invoices', style: TextStyle(color: mavinNavy, fontWeight: FontWeight.w500)),
                        trailing: const Icon(Icons.chevron_right_rounded, color: mavinNavy),
                        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SalesScreen())),
                      ),
                  ]),
          ]);
        }),
      );
    }
    return Scaffold(
      body: content,
      floatingActionButton: canSell ? FloatingActionButton.extended(onPressed: widget.onNewInvoice, icon: const Icon(Icons.add_rounded), label: const Text('New invoice')) : null,
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile(this.label, this.value, {this.note, required this.icon, required this.color});
  final String label;
  final String value;
  final String? note;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Row(children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(9)),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: muted, fontWeight: FontWeight.w500))),
          ]),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Color(0xFF101828), letterSpacing: -.3))),
          if (note != null) Text(note!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: muted)),
        ]),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.title, this.children);
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(title.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: .6, color: Color(0xFF667085))),
        ),
        Card(clipBehavior: Clip.antiAlias, child: Column(children: ListTile.divideTiles(context: context, tiles: children).toList())),
      ]),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.all(16), child: Text(text, style: const TextStyle(color: Color(0xFF667085))));
}
