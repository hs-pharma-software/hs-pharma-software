import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'theme.dart';

/// The search that adds products to an invoice or purchase, right on the
/// form: type a name (or scan a barcode) and the matches show under the bar.
/// Tap one to add it; Enter adds the barcode match or the only match.
class ProductSearch extends ChangeNotifier {
  ProductSearch({required this.api, this.sale = true});
  final Api api;

  /// A sale: products without stock are shown but can't be added.
  final bool sale;

  final text = TextEditingController();
  final focus = FocusNode();
  List<ProductRow> results = const [];
  bool loading = false;
  String? error;
  Timer? _t;
  int _gen = 0;

  String get query => text.text.trim();
  bool get open => query.isNotEmpty;

  void changed() {
    _t?.cancel();
    if (!open) {
      _gen++;
      results = const [];
      loading = false;
      error = null;
      notifyListeners();
      return;
    }
    loading = true;
    notifyListeners();
    _t = Timer(const Duration(milliseconds: 250), _load);
  }

  Future<void> _load() async {
    final gen = ++_gen;
    final q = query;
    try {
      final page = ProductPage.fromJson(await api.get('/api/app/products/', {'q': q}));
      if (gen != _gen) return;
      results = page.rows;
      error = null;
    } on ApiException catch (e) {
      if (gen != _gen) return;
      error = e.message;
    }
    loading = false;
    notifyListeners();
  }

  /// Enter: the product whose barcode is exactly what was typed (a scanner), else the only match.
  ProductRow? bestMatch() {
    final q = query;
    for (final p in results) {
      if (p.barcode != null && p.barcode == q) return p;
    }
    return results.length == 1 ? results.first : null;
  }

  bool canAdd(ProductRow p) => !sale || p.qty > 0;

  /// After adding: empty again and ready for the next product.
  void clear() {
    text.clear();
    changed();
  }

  @override
  void dispose() {
    _t?.cancel();
    text.dispose();
    focus.dispose();
    super.dispose();
  }
}

/// The website's "Barcode/Product Name" input (placeholder "Type to search...").
/// Enter adds the barcode match or the only match; the keyboard stays up.
class ProductSearchField extends StatelessWidget {
  const ProductSearchField({super.key, required this.search, required this.onPick});
  final ProductSearch search;
  final ValueChanged<ProductRow> onPick;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: search,
      builder: (context, _) => TextField(
        controller: search.text,
        focusNode: search.focus,
        onChanged: (_) => search.changed(),
        textInputAction: TextInputAction.search,
        onSubmitted: (_) {
          final p = search.bestMatch() ?? (search.results.isNotEmpty ? search.results.first : null);
          if (p != null && search.canAdd(p)) onPick(p);
          search.focus.requestFocus();
        },
        decoration: InputDecoration(
          hintText: 'Type to search...',
          prefixIcon: const Icon(Icons.search_rounded, size: 20),
          suffixIcon: search.open
              ? IconButton(tooltip: 'Clear', icon: const Icon(Icons.close_rounded, size: 19), onPressed: search.clear)
              : const Icon(Icons.qr_code_scanner_rounded, size: 19),
        ),
      ),
    );
  }
}

/// The matches under the input, as the website's dropdown: "Name (barcode)",
/// stock and price; the first (Enter's choice) highlighted amber.
class ProductSearchDropdown extends StatelessWidget {
  const ProductSearchDropdown({super.key, required this.search, required this.onPick, this.inForm});
  final ProductSearch search;
  final ValueChanged<ProductRow> onPick;
  final double Function(String productId)? inForm;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: search,
      builder: (context, _) {
        final rows = search.results.take(12).toList();
        if (rows.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
            child: search.loading
                ? const Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)))
                : Text(search.error ?? 'No product matches "${search.query}".', style: const TextStyle(color: muted)),
          );
        }
        final best = search.bestMatch() ?? rows.first;
        return Container(
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: hairline)),
          clipBehavior: Clip.antiAlias,
          child: Column(children: [
            if (search.loading) const LinearProgressIndicator(minHeight: 2),
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) const Divider(),
              _DropRow(p: rows[i], highlight: identical(rows[i], best), ok: search.canAdd(rows[i]), added: inForm?.call(rows[i].id) ?? 0, onTap: () {
                HapticFeedback.selectionClick();
                onPick(rows[i]);
              }),
            ],
          ]),
        );
      },
    );
  }
}

class _DropRow extends StatelessWidget {
  const _DropRow({required this.p, required this.highlight, required this.ok, required this.added, required this.onTap});
  final ProductRow p;
  final bool highlight;
  final bool ok;
  final double added;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: highlight && ok ? const Color(0xFFFEF3C7) : Colors.white,
      child: InkWell(
        onTap: ok ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: p.name, style: TextStyle(fontWeight: FontWeight.w600, color: ok ? ink : faint)),
                    if (p.barcode != null) TextSpan(text: ' (${p.barcode})', style: const TextStyle(color: faint, fontSize: 12.5)),
                  ]),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14),
                ),
                const SizedBox(height: 2),
                Wrap(children: [
                  _Stock(p.qty),
                  if (p.packing > 1) Text('  ·  Pack of ${qty(p.packing)}', style: const TextStyle(fontSize: 12, color: muted)),
                  if (added > 0) Text('  ·  ${qty(added)} on invoice', style: const TextStyle(fontSize: 12, color: mavinAccent, fontWeight: FontWeight.w600)),
                ]),
              ]),
            ),
            const SizedBox(width: 8),
            Text(rs(p.salePrice), style: TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5, color: ok ? ink : faint)),
          ]),
        ),
      ),
    );
  }
}

/// The search bar (always visible at the top of the form).
class ProductSearchBar extends StatelessWidget {
  const ProductSearchBar({super.key, required this.search, required this.onPick, this.hint = 'Search medicine or scan barcode'});
  final ProductSearch search;
  final ValueChanged<ProductRow> onPick;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 2, 12, 12),
        child: ListenableBuilder(
          listenable: search,
          builder: (context, _) => TextField(
            controller: search.text,
            focusNode: search.focus,
            onChanged: (_) => search.changed(),
            textInputAction: TextInputAction.search,
            onSubmitted: (_) {
              final p = search.bestMatch();
              if (p != null && search.canAdd(p)) onPick(p);
              // Keep the keyboard up for the next product.
              search.focus.requestFocus();
            },
            style: const TextStyle(fontSize: 16),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(color: muted),
              prefixIcon: const Icon(Icons.search_rounded, color: mavinAccent),
              suffixIcon: search.open
                  ? IconButton(tooltip: 'Clear', icon: const Icon(Icons.close_rounded), onPressed: search.clear)
                  : const Icon(Icons.qr_code_scanner_rounded, color: muted),
              contentPadding: const EdgeInsets.symmetric(vertical: 14),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Color(0xFF8FB8FF), width: 2)),
            ),
          ),
        ),
      ),
    );
  }
}

/// The matches, shown over the form while something is typed.
class ProductSearchResults extends StatelessWidget {
  const ProductSearchResults({super.key, required this.search, required this.onPick, this.inForm});

  final ProductSearch search;
  final ValueChanged<ProductRow> onPick;

  /// Quantity already on the form, shown on a match ("2 added").
  final double Function(String productId)? inForm;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: search,
      builder: (context, _) {
        final rows = search.results;
        Widget body;
        if (rows.isEmpty && search.loading) {
          body = const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));
        } else if (rows.isEmpty && search.error != null) {
          body = _Hint(icon: Icons.wifi_off_rounded, title: 'Couldn\'t search', detail: search.error!);
        } else if (rows.isEmpty) {
          body = _Hint(icon: Icons.search_off_rounded, title: 'No product matches "${search.query}"', detail: 'Check the spelling, or try the barcode.');
        } else {
          body = ListView.separated(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.only(bottom: 12),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const Divider(indent: 16),
            itemBuilder: (_, i) {
              final p = rows[i];
              final ok = search.canAdd(p);
              final added = inForm?.call(p.id) ?? 0;
              return InkWell(
                onTap: ok
                    ? () {
                        HapticFeedback.selectionClick();
                        onPick(p);
                      }
                    : null,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 11, 12, 11),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: ok ? const Color(0xFF101828) : const Color(0xFF98A2B3))),
                        const SizedBox(height: 3),
                        Wrap(children: [
                          _Stock(p.qty),
                          if (p.packing > 1) Text('  ·  Pack of ${qty(p.packing)}', style: const TextStyle(fontSize: 12.5, color: muted)),
                          if (added > 0) Text('  ·  ${qty(added)} added', style: const TextStyle(fontSize: 12.5, color: mavinBlue, fontWeight: FontWeight.w600)),
                        ]),
                      ]),
                    ),
                    const SizedBox(width: 10),
                    Text(rs(p.salePrice), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: ok ? mavinNavy : const Color(0xFF98A2B3))),
                    const SizedBox(width: 10),
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(color: ok ? mavinNavy : const Color(0xFFEEF1F6), borderRadius: BorderRadius.circular(10)),
                      child: Icon(Icons.add_rounded, color: ok ? Colors.white : const Color(0xFFB0B8C6), size: 22),
                    ),
                  ]),
                ),
              );
            },
          );
        }
        return Material(
          color: Colors.white,
          child: Column(children: [
            if (search.loading && rows.isNotEmpty) const LinearProgressIndicator(minHeight: 2),
            Expanded(child: body),
          ]),
        );
      },
    );
  }
}

class _Stock extends StatelessWidget {
  const _Stock(this.q);
  final double q;
  @override
  Widget build(BuildContext context) {
    final out = q <= 0;
    final low = !out && q <= 5;
    return Text(out ? 'Out of stock' : '${qty(q)} in stock', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: out ? noStock : low ? lowStock : mavinGreen));
  }
}

class _Hint extends StatelessWidget {
  const _Hint({required this.icon, required this.title, required this.detail});
  final IconData icon;
  final String title;
  final String detail;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 40, 24, 24),
        child: Column(children: [
          Icon(icon, size: 34, color: muted),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(detail, textAlign: TextAlign.center, style: const TextStyle(color: muted)),
        ]),
      );
}

/// Read-only access to the app's Api for widgets created in initState.
Api apiOf(BuildContext context) => AppScope.read(context).api;
