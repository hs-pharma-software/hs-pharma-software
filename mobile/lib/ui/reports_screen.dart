import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../main.dart';
import 'states.dart';
import 'theme.dart';

/// The website's Reports (Sidebar > Reports), as the app's own screens.
/// Each report is worked out on MAVIN.pk with the website's own SQL
/// (src/server/appReports.ts), so the figures match the web.
class ReportsScreen extends StatelessWidget {
  const ReportsScreen({super.key});

  static const groups = <(String, IconData, Color, List<(String, String)>)>[
    ('Profit & Loss', Icons.trending_up_rounded, Color(0xFF10B981), [
      ('business-profit-loss', 'Business Wise Profit/Loss'),
      ('product-profit-loss', 'Product Wise Profit/Loss'),
      ('company-profit-loss', 'Company Wise Profit/Loss'),
      ('category-profit-loss', 'Category Wise Profit/Loss'),
      ('sub-category-profit-loss', 'Sub Category Wise Profit/Loss'),
      ('customer-profit-loss', 'Customer Wise Profit/Loss'),
    ]),
    ('Sales', Icons.point_of_sale_rounded, Color(0xFF3B82F6), [
      ('product-sales', 'Product Wise Sales Report'),
      ('category-sales', 'Category Wise Sales'),
      ('bonus-discount', 'Bonus Claim And Discount Report'),
    ]),
    ('Tax & Accounts', Icons.account_balance_outlined, Color(0xFF8B5CF6), [
      ('tax', 'Tax Reports'),
      ('trial-balance', 'Trial Balance Report'),
      ('balance-sheet', 'Balance Sheet'),
    ]),
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), children: [
      for (final (title, icon, color, items) in groups) ...[
        Padding(padding: const EdgeInsets.fromLTRB(4, 8, 4, 8), child: SmallCaps(title, color: muted)),
        WebCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const Divider(indent: 56),
              InkWell(
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ReportPage(reportKey: items[i].$1, title: items[i].$2))),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                  child: Row(children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(9)),
                      child: Icon(icon, size: 17, color: color),
                    ),
                    const SizedBox(width: 12),
                    Expanded(child: Text(items[i].$2, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600))),
                    const Icon(Icons.chevron_right_rounded, color: faint),
                  ]),
                ),
              ),
            ],
          ]),
        ),
      ],
    ]);
  }
}

class _Col {
  _Col(this.key, this.label, this.kind);
  final String key;
  final String label;

  /// text, money or qty.
  final String kind;
}

class _Report {
  _Report.fromJson(Map<String, dynamic> j)
      : dates = '${j['dates'] ?? 'range'}',
        columns = [for (final c in (j['columns'] as List? ?? const [])) _Col('${(c as Map)['key']}', '${c['label']}', '${c['kind']}')],
        rows = [for (final r in (j['rows'] as List? ?? const [])) Map<String, dynamic>.from(r as Map)],
        totals = j['totals'] == null ? null : Map<String, dynamic>.from(j['totals'] as Map),
        strong = {for (final i in (j['strongRows'] as List? ?? const [])) (i as num).toInt()};
  final String dates;
  final List<_Col> columns;
  final List<Map<String, dynamic>> rows;
  final Map<String, dynamic>? totals;
  final Set<int> strong;
}

enum _Range { today, thisMonth, lastMonth, thisYear, custom }

/// One report: the period (or "as of" date), the totals, then the rows.
class ReportPage extends StatefulWidget {
  const ReportPage({super.key, required this.reportKey, required this.title});
  final String reportKey;
  final String title;

  @override
  State<ReportPage> createState() => _ReportPageState();
}

class _ReportPageState extends State<ReportPage> {
  static final _iso = DateFormat('yyyy-MM-dd');
  _Range _range = _Range.thisMonth;
  late DateTime _from;
  late DateTime _to;
  _Report? _r;
  Object? _error;
  bool _loading = false;
  final _filter = TextEditingController();
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _setRange(_Range.thisMonth, load: false);
    _load();
  }

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  void _setRange(_Range r, {bool load = true}) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    switch (r) {
      case _Range.today:
        _from = today;
        _to = today;
      case _Range.thisMonth:
        _from = DateTime(now.year, now.month, 1);
        _to = today;
      case _Range.lastMonth:
        _from = DateTime(now.year, now.month - 1, 1);
        _to = DateTime(now.year, now.month, 0);
      case _Range.thisYear:
        _from = DateTime(now.year, 1, 1);
        _to = today;
      case _Range.custom:
        break;
    }
    _range = r;
    if (load) _load();
  }

  Future<void> _pickCustom() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2015),
      lastDate: DateTime(now.year, now.month, now.day),
      initialDateRange: DateTimeRange(start: _from, end: _to),
      helpText: 'Report period',
    );
    if (picked == null) return;
    _from = picked.start;
    _to = picked.end;
    _setRange(_Range.custom);
  }

  Future<void> _pickAsOf() async {
    final now = DateTime.now();
    final d = await showDatePicker(context: context, firstDate: DateTime(2015), lastDate: DateTime(now.year, now.month, now.day), initialDate: _to, helpText: 'As of');
    if (d == null) return;
    _to = d;
    _range = _Range.custom;
    _load();
  }

  Future<void> _load() async {
    final gen = ++_gen;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await AppScope.read(context).api.get('/api/app/reports/', {'key': widget.reportKey, 'from': _iso.format(_from), 'to': _iso.format(_to)});
      if (mounted && gen == _gen) setState(() => _r = _Report.fromJson(j));
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    } finally {
      if (mounted && gen == _gen) setState(() => _loading = false);
    }
  }

  String _fmt(_Col c, Map<String, dynamic> row) {
    final v = row[c.key];
    if (c.kind == 'money') return 'Rs ${_money(v is num ? v.toDouble() : double.tryParse('$v') ?? 0)}';
    if (c.kind == 'qty') {
      final q = v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
      final packing = (row['packing'] is num) ? (row['packing'] as num).toDouble() : 1.0;
      return soldQty(q, packing);
    }
    return '${v ?? ''}';
  }

  static String _money(double v) => NumberFormat('#,##0.00', 'en_US').format(v);

  @override
  Widget build(BuildContext context) {
    final r = _r;
    final dates = r?.dates ?? (widget.reportKey == 'trial-balance' ? 'none' : widget.reportKey == 'balance-sheet' ? 'asOf' : 'range');
    Widget body;
    if (r == null && _error != null) {
      body = StateMessage.error(_error!, onRetry: _load);
    } else if (r == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      body = RefreshIndicator(onRefresh: _load, child: _content(r));
    }
    return Scaffold(
      appBar: AppBar(title: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: Column(children: [
        if (dates != 'none')
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
            child: dates == 'asOf'
                ? Row(children: [
                    const Icon(Icons.event_outlined, size: 18, color: muted),
                    const SizedBox(width: 8),
                    Text('As of ${dayMonthYear(_iso.format(_to))}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    const Spacer(),
                    TextButton(onPressed: _pickAsOf, child: const Text('Change')),
                  ])
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(children: [
                        for (final (rg, label) in const [(_Range.today, 'Today'), (_Range.thisMonth, 'This Month'), (_Range.lastMonth, 'Last Month'), (_Range.thisYear, 'This Year')])
                          Padding(
                            padding: const EdgeInsets.only(right: 6),
                            child: ChoiceChip(
                              label: Text(label),
                              selected: _range == rg,
                              onSelected: (_) => _setRange(rg),
                              showCheckmark: false,
                              selectedColor: mavinAccent,
                              labelStyle: TextStyle(color: _range == rg ? Colors.white : ink, fontWeight: FontWeight.w600, fontSize: 12.5),
                              shape: const StadiumBorder(side: BorderSide(color: hairline)),
                            ),
                          ),
                        ChoiceChip(
                          avatar: Icon(Icons.date_range_rounded, size: 16, color: _range == _Range.custom ? Colors.white : muted),
                          label: const Text('Custom'),
                          selected: _range == _Range.custom,
                          onSelected: (_) => _pickCustom(),
                          showCheckmark: false,
                          selectedColor: mavinAccent,
                          labelStyle: TextStyle(color: _range == _Range.custom ? Colors.white : ink, fontWeight: FontWeight.w600, fontSize: 12.5),
                          shape: const StadiumBorder(side: BorderSide(color: hairline)),
                        ),
                      ]),
                    ),
                    const SizedBox(height: 6),
                    Text('${dayMonthYear(_iso.format(_from))}  –  ${dayMonthYear(_iso.format(_to))}', style: const TextStyle(fontSize: 12.5, color: muted, fontWeight: FontWeight.w500)),
                  ]),
          ),
        const Divider(),
        if (_loading && r != null) const LinearProgressIndicator(minHeight: 2),
        Expanded(child: body),
      ]),
    );
  }

  Widget _content(_Report r) {
    final textCols = r.columns.where((c) => c.kind == 'text').toList();
    final numCols = r.columns.where((c) => c.kind != 'text').toList();
    final q = _filter.text.trim().toLowerCase();
    final indexed = [for (var i = 0; i < r.rows.length; i++) (i, r.rows[i])]
        .where((e) => q.isEmpty || textCols.any((c) => '${e.$2[c.key] ?? ''}'.toLowerCase().contains(q)))
        .toList();
    final metric = r.columns.length == 2 && numCols.length == 1 || widget.reportKey == 'balance-sheet';

    return ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), physics: const AlwaysScrollableScrollPhysics(), children: [
      // Totals, as the website's footer row.
      if (r.totals != null && r.totals!.isNotEmpty) ...[
        Wrap(spacing: 10, runSpacing: 10, children: [
          for (final c in numCols.where((c) => c.kind == 'money' && r.totals!.containsKey(c.key)))
            SizedBox(
              width: (MediaQuery.sizeOf(context).width - 34) / 2,
              child: WebCard(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SmallCaps('Total ${c.label}'),
                  const SizedBox(height: 4),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text('Rs ${_money((r.totals![c.key] as num).toDouble())}',
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: c.key == 'profit' ? ((r.totals![c.key] as num) < 0 ? noStock : saleGreen) : ink)),
                  ),
                ]),
              ),
            ),
        ]),
        const SizedBox(height: 12),
      ],
      if (r.rows.length > 8 && !metric) ...[
        TextField(
          controller: _filter,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: 'Search ${textCols.isEmpty ? '' : textCols.first.label.toLowerCase()}...',
            prefixIcon: const Icon(Icons.search_rounded, size: 20),
            suffixIcon: q.isEmpty ? null : IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(_filter.clear)),
          ),
        ),
        const SizedBox(height: 10),
      ],
      if (r.rows.isEmpty)
        const WebCard(child: Padding(padding: EdgeInsets.symmetric(vertical: 18), child: Center(child: Text('No data for this period.', style: TextStyle(color: muted)))))
      else if (metric)
        WebCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
          child: Column(children: [
            for (var k = 0; k < indexed.length; k++) ...[
              if (k > 0) const Divider(),
              _metricRow(r, indexed[k].$1, indexed[k].$2, textCols, numCols.first),
            ],
          ]),
        )
      else
        for (final (i, row) in indexed) ...[
          WebCard(
            padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                SizedBox(width: 28, child: Text('${i + 1}', style: const TextStyle(color: faint, fontWeight: FontWeight.w700, fontSize: 12))),
                Expanded(child: Text(textCols.map((c) => '${row[c.key] ?? ''}').join(' · '), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14))),
              ]),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.only(left: 28),
                child: Wrap(spacing: 18, runSpacing: 6, children: [
                  for (final c in numCols)
                    Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      SmallCaps(c.label),
                      const SizedBox(height: 2),
                      Text(_fmt(c, row),
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 13.5,
                            color: c.key == 'profit' ? (((row[c.key] as num?) ?? 0) < 0 ? noStock : saleGreen) : ink,
                          )),
                    ]),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 8),
        ],
    ]);
  }

  Widget _metricRow(_Report r, int i, Map<String, dynamic> row, List<_Col> textCols, _Col value) {
    final strong = r.strong.contains(i);
    final label = textCols.where((c) => c.key != 'section').map((c) => '${row[c.key] ?? ''}').join(' · ');
    final section = row['section'];
    final v = (row[value.key] as num?)?.toDouble() ?? 0;
    final profitLine = label.startsWith('Net Profit') || label.startsWith('Gross Profit');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 11),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (section != null) Text('$section', style: const TextStyle(fontSize: 11, color: faint, fontWeight: FontWeight.w600)),
            Text(label, style: TextStyle(fontWeight: strong ? FontWeight.w800 : FontWeight.w500, fontSize: strong ? 14.5 : 13.5)),
          ]),
        ),
        const SizedBox(width: 10),
        Text('Rs ${_money(v)}',
            style: TextStyle(fontWeight: strong ? FontWeight.w800 : FontWeight.w600, fontSize: strong ? 15 : 13.5, color: profitLine ? (v < 0 ? noStock : saleGreen) : ink)),
      ]),
    );
  }
}
