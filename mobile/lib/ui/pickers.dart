import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'states.dart';
import 'theme.dart';

/// Full-screen search that returns the chosen product (name, stock, price).
class ProductPicker extends StatefulWidget {
  const ProductPicker({super.key, this.title = 'Add product', this.hideOutOfStock = false});
  final String title;

  /// Sale: a product with no stock can't be sold, so it is shown greyed out.
  final bool hideOutOfStock;

  @override
  State<ProductPicker> createState() => _ProductPickerState();
}

class _ProductPickerState extends State<ProductPicker> {
  final _q = TextEditingController();
  List<ProductRow>? _rows;
  Object? _error;
  Timer? _t;
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _t?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final gen = ++_gen;
    try {
      final q = _q.text.trim();
      final page = ProductPage.fromJson(await AppScope.read(context).api.get('/api/app/products/', {if (q.isNotEmpty) 'q': q}));
      if (mounted && gen == _gen) {
        setState(() {
          _rows = page.rows;
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _q,
              autofocus: true,
              textInputAction: TextInputAction.search,
              onChanged: (_) {
                _t?.cancel();
                _t = Timer(const Duration(milliseconds: 300), _load);
              },
              decoration: InputDecoration(
                hintText: 'Search name or barcode',
                prefixIcon: const Icon(Icons.search_rounded),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
      ),
      body: rows == null && _error != null
          ? StateMessage.error(_error!, onRetry: _load)
          : rows == null
              ? const LoadingRows()
              : rows.isEmpty
                  ? StateMessage(icon: Icons.search_off_rounded, title: 'No products match', detail: 'Check the spelling or search by barcode.')
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) {
                        final p = rows[i];
                        final out = p.qty <= 0;
                        final disabled = widget.hideOutOfStock && out;
                        return ListTile(
                          tileColor: Colors.white,
                          enabled: !disabled,
                          title: Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                          subtitle: Text(out ? 'Out of stock' : '${qty(p.qty)} in stock', style: TextStyle(color: out ? noStock : null)),
                          trailing: Text(rs(p.salePrice), style: const TextStyle(fontWeight: FontWeight.w500)),
                          onTap: disabled ? null : () => Navigator.pop(context, p),
                        );
                      },
                    ),
    );
  }
}

/// Full-screen search for a customer or supplier.
class PartyPicker extends StatefulWidget {
  const PartyPicker({super.key, required this.kind});

  /// 'customer' or 'supplier'.
  final String kind;

  @override
  State<PartyPicker> createState() => _PartyPickerState();
}

class _PartyPickerState extends State<PartyPicker> {
  final _q = TextEditingController();
  List<Party>? _rows;
  Object? _error;
  Timer? _t;
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _t?.cancel();
    _q.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final gen = ++_gen;
    try {
      final q = _q.text.trim();
      final r = await AppScope.read(context).api.get('/api/app/parties/', {'kind': widget.kind, if (q.isNotEmpty) 'q': q});
      if (mounted && gen == _gen) {
        setState(() {
          _rows = [for (final x in (r['rows'] as List? ?? const [])) Party.fromJson(x as Map<String, dynamic>)];
          _error = null;
        });
      }
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final what = widget.kind == 'customer' ? 'customer' : 'supplier';
    return Scaffold(
      appBar: AppBar(
        title: Text('Choose $what'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _q,
              autofocus: true,
              onChanged: (_) {
                _t?.cancel();
                _t = Timer(const Duration(milliseconds: 300), _load);
              },
              decoration: InputDecoration(
                hintText: 'Search name or mobile',
                prefixIcon: const Icon(Icons.search_rounded),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
      ),
      body: rows == null && _error != null
          ? StateMessage.error(_error!, onRetry: _load)
          : rows == null
              ? const LoadingRows(height: 64)
              : rows.isEmpty
                  ? StateMessage(icon: Icons.person_search_outlined, title: 'No $what found', detail: 'Add new ${what}s in the web version.')
                  : ListView.separated(
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const Divider(),
                      itemBuilder: (_, i) {
                        final p = rows[i];
                        final sub = [if (p.phone != null) p.phone!, if (p.detail != null) p.detail!].join(' · ');
                        return ListTile(
                          tileColor: Colors.white,
                          title: Text(p.name),
                          subtitle: sub.isEmpty ? null : Text(sub),
                          onTap: () => Navigator.pop(context, p),
                        );
                      },
                    ),
    );
  }
}
