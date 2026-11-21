import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'product_detail_screen.dart';
import 'states.dart';
import 'theme.dart';

/// Products: search always visible; each row shows name, available quantity
/// and sale price. Pages of 50 load as the list scrolls. Import and export
/// stay in the web version (never shown in the Android app).
class ProductsScreen extends StatefulWidget {
  const ProductsScreen({super.key});

  @override
  State<ProductsScreen> createState() => _ProductsScreenState();
}

class _ProductsScreenState extends State<ProductsScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  final List<ProductRow> _rows = [];
  int? _next = 0;
  bool _loading = false;
  Object? _error;
  Timer? _debounce;
  // Answers to an older search are dropped when a newer one is on its way.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) _loadMore();
    });
    _reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), _reload);
  }

  Future<void> _reload() async {
    _generation++;
    setState(() {
      _rows.clear();
      _next = 0;
      _error = null;
      _loading = false;
    });
    await _loadMore();
  }

  Future<void> _loadMore() async {
    if (_loading || _next == null) return;
    final gen = _generation;
    setState(() => _loading = true);
    try {
      final q = _search.text.trim();
      final page = ProductPage.fromJson(await AppScope.read(context).api.get('/api/app/products/', {if (q.isNotEmpty) 'q': q, 'offset': '$_next'}));
      if (!mounted || gen != _generation) return;
      setState(() {
        _rows.addAll(page.rows);
        _next = page.nextOffset;
      });
    } on ApiException catch (e) {
      if (mounted && gen == _generation) setState(() => _error = e);
    } finally {
      if (mounted && gen == _generation) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final searching = _search.text.trim().isNotEmpty;
    Widget list;
    if (_rows.isEmpty && _loading) {
      list = const LoadingRows();
    } else if (_rows.isEmpty && _error != null) {
      list = StateMessage.error(_error!, onRetry: _reload);
    } else if (_rows.isEmpty) {
      list = searching
          ? StateMessage(icon: Icons.search_off_rounded, title: 'No products match "${_search.text.trim()}"', detail: 'Check the spelling or search by barcode.', action: 'Clear search', onAction: () {
              _search.clear();
              _reload();
            })
          : const StateMessage(icon: Icons.inventory_2_outlined, title: 'No products yet', detail: 'Add products in the web version.');
    } else {
      list = RefreshIndicator(
        onRefresh: _reload,
        child: ListView.separated(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(12),
          itemCount: _rows.length + 1,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            if (i == _rows.length) {
              if (_error != null) return TextButton(onPressed: _loadMore, child: const Text('Couldn\'t load more. Try again'));
              if (_next != null) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
              return Padding(
                padding: const EdgeInsets.all(14),
                child: Text('${_rows.length} products · Import and export are in the web version.', style: const TextStyle(fontSize: 12, color: Color(0xFF667085))),
              );
            }
            return _ProductTile(row: _rows[i]);
          },
        ),
      );
    }
    return Column(children: [
      Material(
        color: Colors.white,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: TextField(
            controller: _search,
            onChanged: (v) {
              setState(() {});
              _onSearch(v);
            },
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search by product or barcode...',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: searching
                  ? IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(Icons.close_rounded),
                      onPressed: () {
                        _search.clear();
                        _reload();
                      },
                    )
                  : null,
            ),
          ),
        ),
      ),
      const Divider(),
      Expanded(child: list),
    ]);
  }
}

class _ProductTile extends StatelessWidget {
  const _ProductTile({required this.row});
  final ProductRow row;

  @override
  Widget build(BuildContext context) {
    // The website's phone card: the name, "Avail X" (red "Out of stock"), the price on the right.
    final out = row.qty <= 0;
    final low = !out && row.qty <= 5;
    return WebCard(
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ProductDetailScreen(id: row.id, name: row.name))),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(row.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Text(out ? 'Out of stock' : 'Avail ${qty(row.qty)}${row.packing > 1 ? ' · Pack of ${qty(row.packing)}' : ''}',
                style: TextStyle(fontSize: 12.5, color: out ? noStock : low ? lowStock : muted, fontWeight: out || low ? FontWeight.w600 : FontWeight.w500)),
          ]),
        ),
        const SizedBox(width: 12),
        Text(rs(row.salePrice), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5, fontFeatures: [FontFeature.tabularFigures()])),
      ]),
    );
  }
}
