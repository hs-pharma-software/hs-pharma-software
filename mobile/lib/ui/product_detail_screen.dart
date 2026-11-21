import 'package:material_ui/material_ui.dart';

import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'states.dart';
import 'theme.dart';

/// One product: stock, prices and its batches (earliest expiry first).
/// Purchase prices show only to logins allowed to see them.
class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.id, required this.name});
  final String id;
  final String name;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  ProductDetail? _p;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final p = ProductDetail.fromJson(await AppScope.read(context).api.get('/api/app/products/', {'id': widget.id}));
      if (mounted) setState(() => _p = p);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    Widget body;
    if (p == null && _error != null) {
      body = StateMessage.error(_error!, onRetry: _load);
    } else if (p == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final facts = <(String, String)>[
        ('Available', p.qty <= 0 ? 'Out of stock' : qty(p.qty)),
        ('Sale price', rs(p.salePrice)),
        if (p.mrp > 0) ('MRP', rs(p.mrp)),
        if (p.packing > 1) ('Packing', qty(p.packing)),
        if (p.unit != null) ('Unit', p.unit!),
        if (p.company != null) ('Company', p.company!),
        if (p.category != null) ('Category', p.category!),
        if (p.barcode != null) ('Barcode', p.barcode!),
      ];
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text(p.name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w500)),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(children: [
                for (final (k, v) in facts)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
                    child: Row(children: [
                      Expanded(child: Text(k, style: const TextStyle(color: Color(0xFF667085)))),
                      Text(v, style: TextStyle(fontWeight: FontWeight.w500, color: k == 'Available' && p.qty <= 0 ? noStock : null)),
                    ]),
                  ),
              ]),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 18, 4, 6),
            child: Text('BATCHES', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: .6, color: Color(0xFF667085))),
          ),
          Card(
            clipBehavior: Clip.antiAlias,
            child: p.batches.isEmpty
                ? const Padding(padding: EdgeInsets.all(16), child: Text('No stock in any batch.', style: TextStyle(color: Color(0xFF667085))))
                : Column(
                    children: ListTile.divideTiles(context: context, tiles: [
                      for (final b in p.batches)
                        ListTile(
                          title: Text(b.batchNo ?? 'No batch number'),
                          subtitle: Text([if (b.expiry != null) 'Expires ${monthYear(b.expiry)}', if (b.purchasePrice != null) 'Purchase ${rs(b.purchasePrice!)}'].join(' · ')),
                          trailing: Text(qty(b.qty), style: const TextStyle(fontWeight: FontWeight.w500)),
                        ),
                    ]).toList(),
                  ),
          ),
        ]),
      );
    }
    return Scaffold(appBar: AppBar(title: Text(p?.name ?? widget.name, overflow: TextOverflow.ellipsis)), body: body);
  }
}
