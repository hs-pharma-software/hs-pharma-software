import 'dart:async';

import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../main.dart';
import 'sales_screen.dart';
import 'states.dart';
import 'theme.dart';

final _m2 = NumberFormat('#,##0.00', 'en_US');
String _rs(num v) => 'Rs ${_m2.format(v)}';
double _d(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

class _Col {
  _Col(Map j)
      : key = '${j['key']}',
        label = '${j['label']}',
        kind = '${j['kind']}';
  final String key;
  final String label;
  final String kind;
}

/// One of the website's list pages (Invoice Return Details, Memorized Invoice
/// Detail, Quotation, Order, Purchase Details and Returns, Price List, UOM,
/// Categories, Companies, Narcotics, Staff, Banks, Salesman, Other Revenue,
/// categories, Tasks): search, a period where the web has dates, the totals,
/// and the rows as the website's phone cards. Invoices and purchases open.
class ListPageScreen extends StatefulWidget {
  const ListPageScreen({super.key, required this.listKey, required this.title});
  final String listKey;
  final String title;

  @override
  State<ListPageScreen> createState() => _ListPageScreenState();
}

class _ListPageScreenState extends State<ListPageScreen> {
  static final _iso = DateFormat('yyyy-MM-dd');
  final _q = TextEditingController();
  final List<Map<String, dynamic>> _rows = [];
  List<_Col> _cols = const [];
  Map<String, dynamic>? _totals;
  bool _dated = false;
  String? _opens;
  int? _next = 0;
  bool _loading = false;
  bool _loaded = false;
  Object? _error;
  Timer? _t;
  int _gen = 0;

  /// null = all time; else 0 today, 1 this month, 2 last month, 3 this year.
  int? _range;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _t?.cancel();
    _q.dispose();
    super.dispose();
  }

  (DateTime, DateTime)? get _period {
    final n = DateTime.now();
    final today = DateTime(n.year, n.month, n.day);
    return switch (_range) {
      null => null,
      0 => (today, today),
      2 => (DateTime(n.year, n.month - 1, 1), DateTime(n.year, n.month, 0)),
      3 => (DateTime(n.year, 1, 1), today),
      _ => (DateTime(n.year, n.month, 1), today),
    };
  }

  Future<void> _reload() async {
    _gen++;
    _rows.clear();
    _next = 0;
    _loading = false;
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _next == null) return;
    final gen = _gen;
    final per = _period;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await AppScope.read(context).api.get('/api/app/lists/', {
        'key': widget.listKey,
        if (_q.text.trim().isNotEmpty) 'q': _q.text.trim(),
        if (per != null) 'from': _iso.format(per.$1),
        if (per != null) 'to': _iso.format(per.$2),
        'offset': '$_next',
      });
      if (!mounted || gen != _gen) return;
      setState(() {
        _cols = [for (final c in (j['columns'] as List? ?? const [])) _Col(c as Map)];
        _rows.addAll([for (final x in (j['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]);
        _next = (j['nextOffset'] as num?)?.toInt();
        _totals = j['totals'] == null ? null : Map<String, dynamic>.from(j['totals'] as Map);
        _dated = j['dated'] == true;
        _opens = j['opens'] as String?;
        _loaded = true;
      });
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    } finally {
      if (mounted && gen == _gen) setState(() => _loading = false);
    }
  }

  String _fmt(_Col c, Map<String, dynamic> row) {
    final v = row[c.key];
    if (v == null) return '—';
    return switch (c.kind) {
      'money' => _rs(_d(v)),
      'qty' => soldQty(_d(v), row['packing'] is num ? (row['packing'] as num).toDouble() : 1),
      'pct' => '${qty(_d(v))}%',
      'date' => dayMonthYear('$v'),
      _ => '$v',
    };
  }

  void _open(Map<String, dynamic> row) {
    final id = row['id'] as String?;
    if (id == null) return;
    if (_opens == 'invoice') Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: id, no: int.tryParse('${row['no']}'))));
    if (_opens == 'purchase') Navigator.push(context, MaterialPageRoute(builder: (_) => PurchaseDetailScreen(id: id, no: int.tryParse('${row['no']}'))));
  }

  @override
  Widget build(BuildContext context) {
    final textCols = _cols.where((c) => c.kind == 'text').toList();
    final title = textCols.isEmpty ? null : textCols.first;
    final rest = _cols.where((c) => c != title).toList();
    final amountCol = _cols.where((c) => c.kind == 'money').lastOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(children: [
            TextField(
              controller: _q,
              onChanged: (_) {
                setState(() {});
                _t?.cancel();
                _t = Timer(const Duration(milliseconds: 300), _reload);
              },
              decoration: InputDecoration(
                hintText: 'Search...',
                prefixIcon: const Icon(Icons.search_rounded, size: 20),
                suffixIcon: _q.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close_rounded, size: 18),
                        onPressed: () {
                          _q.clear();
                          _reload();
                        }),
              ),
            ),
            if (_dated) ...[
              const SizedBox(height: 8),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(children: [
                  for (final (i, label) in const [(null, 'All'), (0, 'Today'), (1, 'This Month'), (2, 'Last Month'), (3, 'This Year')])
                    Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(label),
                        selected: _range == i,
                        showCheckmark: false,
                        selectedColor: mavinAccent,
                        labelStyle: TextStyle(color: _range == i ? Colors.white : ink, fontWeight: FontWeight.w600, fontSize: 12.5),
                        shape: const StadiumBorder(side: BorderSide(color: hairline)),
                        onSelected: (_) {
                          setState(() => _range = i);
                          _reload();
                        },
                      ),
                    ),
                ]),
              ),
            ],
          ]),
        ),
        const Divider(),
        Expanded(
          child: !_loaded && _error != null
              ? StateMessage.error(_error!, onRetry: _reload)
              : !_loaded
                  ? const LoadingRows()
                  : RefreshIndicator(
                      onRefresh: _reload,
                      child: NotificationListener<ScrollNotification>(
                        onNotification: (n) {
                          if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _more();
                          return false;
                        },
                        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), physics: const AlwaysScrollableScrollPhysics(), children: [
                          if (_totals != null && _totals!.isNotEmpty) ...[
                            Wrap(spacing: 10, runSpacing: 10, children: [
                              for (final e in _totals!.entries)
                                SizedBox(
                                  width: (MediaQuery.sizeOf(context).width - 34) / 2,
                                  child: WebCard(
                                    padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                      SmallCaps('Total ${_cols.where((c) => c.key == e.key).firstOrNull?.label ?? e.key}'),
                                      const SizedBox(height: 4),
                                      FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(_rs(_d(e.value)), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
                                    ]),
                                  ),
                                ),
                            ]),
                            const SizedBox(height: 12),
                          ],
                          if (_rows.isEmpty) const WebCard(child: Padding(padding: EdgeInsets.symmetric(vertical: 14), child: Center(child: Text('No content in table', style: TextStyle(color: faint))))),
                          for (final row in _rows) ...[
                            WebCard(
                              onTap: _opens == null ? null : () => _open(row),
                              padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Expanded(
                                    child: Text(
                                      [
                                        if (row['no'] != null) '#${row['no']}',
                                        if (title != null && title.key != 'no') _fmt(title, row),
                                      ].join(' · '),
                                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5),
                                    ),
                                  ),
                                  if (amountCol != null) Text(_fmt(amountCol, row), style: const TextStyle(fontWeight: FontWeight.w700)),
                                  if (_opens != null) const Icon(Icons.chevron_right_rounded, color: faint, size: 20),
                                ]),
                                const SizedBox(height: 6),
                                Wrap(spacing: 16, runSpacing: 6, children: [
                                  for (final c in rest.where((c) => c != amountCol && c.key != 'no' && row[c.key] != null))
                                    Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                                      SmallCaps(c.label),
                                      const SizedBox(height: 2),
                                      Text(_fmt(c, row), style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: c.key == 'balance' && _d(row[c.key]) > 0.004 ? noStock : ink)),
                                    ]),
                                ]),
                              ]),
                            ),
                            const SizedBox(height: 8),
                          ],
                          if (_next != null) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
                        ]),
                      ),
                    ),
        ),
      ]),
    );
  }
}

/// One purchase: supplier, invoice #, items (batch, expiry, quantity, rate) and the totals.
class PurchaseDetailScreen extends StatefulWidget {
  const PurchaseDetailScreen({super.key, required this.id, this.no});
  final String id;
  final int? no;

  @override
  State<PurchaseDetailScreen> createState() => _PurchaseDetailScreenState();
}

class _PurchaseDetailScreenState extends State<PurchaseDetailScreen> {
  Map<String, dynamic>? _j;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final j = await AppScope.read(context).api.get('/api/app/lists/', {'purchase': widget.id});
      if (mounted) setState(() => _j = j);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Widget _pair(String k, String v, {bool strong = false, Color? color}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(children: [
          Text(k, style: const TextStyle(color: muted)),
          const SizedBox(width: 16),
          Expanded(child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontWeight: strong ? FontWeight.w800 : FontWeight.w600, color: color))),
        ]),
      );

  @override
  Widget build(BuildContext context) {
    final j = _j;
    final no = (j?['no'] as num?)?.toInt() ?? widget.no;
    Widget body;
    if (j == null && _error != null) {
      body = StateMessage.error(_error!, onRetry: _load);
    } else if (j == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final items = [for (final x in (j['items'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), children: [
          WebCard(
            child: Column(children: [
              _pair('Date', dayMonthYear('${j['date']}')),
              _pair('Supplier', '${j['supplier']}'),
              if (j['supplierInvoiceNo'] != null) _pair('Invoice #', '${j['supplierInvoiceNo']}'),
              if (j['method'] != null) _pair('Payment Method', '${j['method']}'),
              if (j['isReturn'] == true) _pair('Type', 'Purchase return', color: noStock),
            ]),
          ),
          Padding(padding: const EdgeInsets.fromLTRB(4, 16, 4, 8), child: Text('Products (${items.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5))),
          for (final it in items) ...[
            WebCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${it['product']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text(
                      [
                        soldQty(_d(it['qty']), _d(it['packing']) > 0 ? _d(it['packing']) : 1),
                        if (it['price'] != null) '× ${_rs(_d(it['price']))}',
                        if (it['batchNo'] != null) 'Batch ${it['batchNo']}',
                        if (it['expiry'] != null) 'Exp ${monthYear('${it['expiry']}')}',
                      ].join(' · '),
                      style: const TextStyle(fontSize: 12, color: muted),
                    ),
                  ]),
                ),
                Text(_rs(_d(it['total'])), style: const TextStyle(fontWeight: FontWeight.w700)),
              ]),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 4),
          WebCard(
            child: Column(children: [
              if (_d(j['discount']) > 0.004) _pair('Discount', '- ${_rs(_d(j['discount']))}'),
              if (_d(j['tax']) > 0.004) _pair('Tax', _rs(_d(j['tax']))),
              _pair('Payable', _rs(_d(j['payable'])), strong: true),
              _pair('Paid', _rs(_d(j['paid']))),
              if (_d(j['balance']).abs() > 0.004) _pair('Balance', _rs(_d(j['balance'])), strong: true, color: noStock),
            ]),
          ),
          if (j['description'] != null) Padding(padding: const EdgeInsets.fromLTRB(4, 12, 4, 0), child: Text('${j['description']}', style: const TextStyle(color: muted))),
        ]),
      );
    }
    return Scaffold(appBar: AppBar(title: Text(no == null ? 'Purchase' : 'Purchase #$no')), body: body);
  }
}
