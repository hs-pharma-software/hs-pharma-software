import 'dart:async';

import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../core/doc_id.dart';
import '../core/format.dart';
import '../main.dart';
import 'form_bits.dart';
import 'sales_screen.dart';
import 'states.dart';
import 'theme.dart';

final _m2 = NumberFormat('#,##0.00', 'en_US');
String _rs(num v) => 'Rs ${_m2.format(v)}';
double _d(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
String? _s(Object? v) => v == null || '$v'.isEmpty ? null : '$v';

/// A big figure in a card (the website's footer totals).
class _Figure extends StatelessWidget {
  const _Figure(this.label, this.value, {this.color = ink});
  final String label;
  final String value;
  final Color color;
  @override
  Widget build(BuildContext context) => WebCard(
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SmallCaps(label),
          const SizedBox(height: 4),
          FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: Text(value, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: color))),
        ]),
      );
}

// ── Customers / Suppliers ─────────────────────────────────────────────────

/// Customers (Accounts Receivable, Outstanding) or Suppliers (Accounts Payable, Outstanding):
/// each one's Current Balance = opening + unpaid bills - adjustments, as the website.
class PartiesScreen extends StatefulWidget {
  const PartiesScreen({super.key, required this.kind, this.dueOnly = true});
  final String kind;
  final bool dueOnly;

  @override
  State<PartiesScreen> createState() => _PartiesScreenState();
}

class _PartiesScreenState extends State<PartiesScreen> {
  late bool _due = widget.dueOnly;
  final _q = TextEditingController();
  List<Map<String, dynamic>>? _rows;
  double _total = 0;
  Object? _error;
  Timer? _t;
  int _gen = 0;

  bool get _customer => widget.kind == 'customer';

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
    setState(() => _error = null);
    try {
      final j = await AppScope.read(context).api.get('/api/app/books/', {'page': 'balances', 'kind': widget.kind, if (_due) 'due': '1', if (_q.text.trim().isNotEmpty) 'q': _q.text.trim()});
      if (!mounted || gen != _gen) return;
      setState(() {
        _rows = [for (final x in (j['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
        _total = _d(j['total']);
      });
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = _rows;
    final title = _customer ? 'Customers' : 'Suppliers';
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: Column(children: [
            SizedBox(
              width: double.infinity,
              child: SegmentedButton<bool>(
                showSelectedIcon: false,
                style: SegmentedButton.styleFrom(selectedBackgroundColor: mavinAccent),
                segments: [
                  ButtonSegment(value: true, label: Text(_customer ? 'Receivable' : 'Payable')),
                  ButtonSegment(value: false, label: Text(_customer ? 'All customers' : 'All suppliers')),
                ],
                selected: {_due},
                onSelectionChanged: (s) {
                  _due = s.first;
                  _load();
                },
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _q,
              onChanged: (_) {
                _t?.cancel();
                _t = Timer(const Duration(milliseconds: 300), _load);
              },
              decoration: InputDecoration(hintText: 'Search name or mobile', prefixIcon: const Icon(Icons.search_rounded, size: 20)),
            ),
          ]),
        ),
        const Divider(),
        Expanded(
          child: rows == null && _error != null
              ? StateMessage.error(_error!, onRetry: _load)
              : rows == null
                  ? const LoadingRows()
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.all(12), physics: const AlwaysScrollableScrollPhysics(), children: [
                        _Figure(_due ? (_customer ? 'Total Receivable' : 'Total Payable') : 'Total Balance', _rs(_total), color: _total > 0 ? (_customer ? saleGreen : noStock) : ink),
                        const SizedBox(height: 12),
                        if (rows.isEmpty)
                          WebCard(child: Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Center(child: Text(_due ? 'Nothing outstanding.' : 'No ${title.toLowerCase()} yet.', style: const TextStyle(color: muted))))),
                        for (final x in rows) ...[
                          WebCard(
                            onTap: () async {
                              await Navigator.push(context, MaterialPageRoute(builder: (_) => PartyLedgerScreen(kind: widget.kind, id: '${x['id']}', name: '${x['name']}')));
                              if (mounted) _load();
                            },
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            child: Row(children: [
                              CircleAvatar(radius: 18, backgroundColor: mavinTint, child: Text('${x['name']}'.isEmpty ? '?' : '${x['name']}'[0].toUpperCase(), style: const TextStyle(color: mavinAccent, fontWeight: FontWeight.w700))),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Text('${x['name']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                                  if (_s(x['phone']) != null) Text('${x['phone']}', style: const TextStyle(fontSize: 12, color: muted)),
                                ]),
                              ),
                              Text(_rs(_d(x['balance'])), style: TextStyle(fontWeight: FontWeight.w700, color: _d(x['balance']) > 0.004 ? (_customer ? saleGreen : noStock) : muted)),
                              const Icon(Icons.chevron_right_rounded, color: faint),
                            ]),
                          ),
                          const SizedBox(height: 8),
                        ],
                      ]),
                    ),
        ),
      ]),
    );
  }
}

/// One customer's (or supplier's) account: Current Balance, the unpaid bills and the adjustments; Receive / Pay.
class PartyLedgerScreen extends StatefulWidget {
  const PartyLedgerScreen({super.key, required this.kind, required this.id, required this.name});
  final String kind;
  final String id;
  final String name;

  @override
  State<PartyLedgerScreen> createState() => _PartyLedgerScreenState();
}

class _PartyLedgerScreenState extends State<PartyLedgerScreen> {
  Map<String, dynamic>? _j;
  Object? _error;

  bool get _customer => widget.kind == 'customer';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final j = await AppScope.read(context).api.get('/api/app/books/', {'page': 'ledger', 'kind': widget.kind, 'id': widget.id});
      if (mounted) setState(() => _j = j);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _adjust(double balance) async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _EntrySheet(
        title: _customer ? 'Receive Payment' : 'Pay Supplier',
        subtitle: '${widget.name} · Current Balance ${_rs(balance)}',
        kind: _EntryKind.adjustment,
        extra: {'page': 'adjustment', 'kind': widget.kind, 'partyId': widget.id},
      ),
    );
    if (ok == true) {
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved. The balance is updated.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final j = _j;
    Widget body;
    if (j == null && _error != null) {
      body = StateMessage.error(_error!, onRetry: _load);
    } else if (j == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final p = Map<String, dynamic>.from(j['party'] as Map);
      final bills = [for (final x in (j['bills'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
      final adj = [for (final x in (j['adjustments'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
      final balance = _d(p['balance']);
      final phone = _s(p['phone']);
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 100), physics: const AlwaysScrollableScrollPhysics(), children: [
          WebCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const SmallCaps('Current Balance'),
              const SizedBox(height: 4),
              Text(_rs(balance), style: TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: balance > 0.004 ? (_customer ? saleGreen : noStock) : ink)),
              Text(balance > 0.004 ? (_customer ? 'The customer owes you' : 'You owe the supplier') : balance < -0.004 ? 'In credit' : 'Nothing outstanding', style: const TextStyle(color: muted, fontSize: 12.5)),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: _kv('Opening Balance', _rs(_d(p['opening'])))),
                Expanded(child: _kv('Total Adjusted', _rs(_d(p['adjusted'])))),
              ]),
              if (phone != null) ...[
                const SizedBox(height: 10),
                Row(children: [
                  const Icon(Icons.phone_outlined, size: 16, color: muted),
                  const SizedBox(width: 6),
                  Text(phone, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const Spacer(),
                  TextButton.icon(onPressed: () => launchUrl(Uri.parse('tel:$phone')), icon: const Icon(Icons.call_outlined, size: 18), label: const Text('Call')),
                ]),
              ],
            ]),
          ),
          const SizedBox(height: 14),
          Padding(padding: const EdgeInsets.fromLTRB(4, 0, 4, 8), child: Text('Unpaid ${_customer ? 'invoices' : 'purchases'} (${bills.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5))),
          if (bills.isEmpty) const WebCard(child: Text('None.', style: TextStyle(color: muted))),
          for (final b in bills) ...[
            WebCard(
              onTap: _customer ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: '${b['id']}', no: (b['no'] as num?)?.toInt()))) : null,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${b['isReturn'] == true ? 'Return ' : ''}#${b['no'] ?? '—'}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text('${dayMonthYear('${b['date']}')} · Bill ${_rs(_d(b['payable']))} · Paid ${_rs(_d(b['paid']))}', style: const TextStyle(fontSize: 12, color: muted)),
                  ]),
                ),
                Text(_rs(_d(b['balance'])), style: const TextStyle(fontWeight: FontWeight.w700, color: noStock)),
              ]),
            ),
            const SizedBox(height: 8),
          ],
          const SizedBox(height: 8),
          Padding(padding: const EdgeInsets.fromLTRB(4, 0, 4, 8), child: Text('Adjustments (${adj.length})', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5))),
          if (adj.isEmpty) const WebCard(child: Text('None yet.', style: TextStyle(color: muted))),
          for (final a in adj) ...[
            WebCard(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(dayMonthYear('${a['date']}'), style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text([_s(a['method']) ?? 'Cash', if (_s(a['comment']) != null) '${a['comment']}'].join(' · '), style: const TextStyle(fontSize: 12, color: muted)),
                  ]),
                ),
                Text(_rs(_d(a['amount'])), style: const TextStyle(fontWeight: FontWeight.w700)),
              ]),
            ),
            const SizedBox(height: 8),
          ],
        ]),
      );
    }
    final balance = j == null ? 0.0 : _d((j['party'] as Map)['balance']);
    return Scaffold(
      appBar: AppBar(title: Text(widget.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: body,
      floatingActionButton: j == null
          ? null
          : FloatingActionButton.extended(
              onPressed: () => _adjust(balance),
              icon: const Icon(Icons.payments_outlined),
              label: Text(_customer ? 'Receive Payment' : 'Pay Supplier'),
            ),
    );
  }

  Widget _kv(String k, String v) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SmallCaps(k),
        const SizedBox(height: 2),
        Text(v, style: const TextStyle(fontWeight: FontWeight.w600)),
      ]);
}

// ── Cash Register ─────────────────────────────────────────────────────────

/// Cash Details (the website's Cash Register): entries newest first, Cash In, Cash Out and Closing Cash; In/Out.
class CashRegisterScreen extends StatefulWidget {
  const CashRegisterScreen({super.key});

  @override
  State<CashRegisterScreen> createState() => _CashRegisterScreenState();
}

class _CashRegisterScreenState extends State<CashRegisterScreen> {
  final List<Map<String, dynamic>> _rows = [];
  Map<String, dynamic>? _totals;
  int? _next = 0;
  bool _loading = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    _rows.clear();
    _next = 0;
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _next == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await AppScope.read(context).api.get('/api/app/books/', {'page': 'cash', 'offset': '$_next'});
      if (!mounted) return;
      setState(() {
        _rows.addAll([for (final x in (j['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]);
        _next = (j['nextOffset'] as num?)?.toInt();
        _totals = j;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _totals;
    return Scaffold(
      appBar: AppBar(title: const Text('Cash Details')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => const _EntrySheet(title: 'Add Cash', kind: _EntryKind.cash, extra: {'page': 'cash'}));
          if (ok == true) _reload();
        },
        icon: const Icon(Icons.swap_vert_rounded),
        label: const Text('In/Out'),
      ),
      body: t == null && _error != null
          ? StateMessage.error(_error!, onRetry: _reload)
          : t == null
              ? const LoadingRows()
              : RefreshIndicator(
                  onRefresh: _reload,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (n) {
                      if (n.metrics.pixels > n.metrics.maxScrollExtent - 300) _more();
                      return false;
                    },
                    child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 100), physics: const AlwaysScrollableScrollPhysics(), children: [
                      Row(children: [
                        Expanded(child: _Figure('Cash In', _rs(_d(t['cashIn'])), color: saleGreen)),
                        const SizedBox(width: 10),
                        Expanded(child: _Figure('Cash Out', _rs(_d(t['cashOut'])), color: noStock)),
                      ]),
                      const SizedBox(height: 10),
                      _Figure('Closing Cash', _rs(_d(t['closing']))),
                      const SizedBox(height: 12),
                      if (_rows.isEmpty) const WebCard(child: Text('No cash entries yet.', style: TextStyle(color: muted))),
                      for (final x in _rows) ...[
                        WebCard(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                          child: Row(children: [
                            Icon(x['type'] == 'in' ? Icons.south_west_rounded : Icons.north_east_rounded, color: x['type'] == 'in' ? saleGreen : noStock),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(_s(x['description']) ?? (x['type'] == 'in' ? 'Payment In' : 'Payment Out'), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
                                Text(dayMonthYear('${x['date']}'), style: const TextStyle(fontSize: 12, color: muted)),
                              ]),
                            ),
                            Text('${x['type'] == 'in' ? '+' : '−'} ${_rs(_d(x['amount']))}', style: TextStyle(fontWeight: FontWeight.w700, color: x['type'] == 'in' ? saleGreen : noStock)),
                          ]),
                        ),
                        const SizedBox(height: 8),
                      ],
                      if (_next != null) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
                    ]),
                  ),
                ),
    );
  }
}

// ── Expenses ──────────────────────────────────────────────────────────────

/// Expenses Details: this month by default (or another period), the total, and Add Expense.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key});

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  static final _iso = DateFormat('yyyy-MM-dd');
  int _range = 1; // 0 today, 1 this month, 2 last month, 3 this year
  final List<Map<String, dynamic>> _rows = [];
  List<Map<String, dynamic>> _categories = const [];
  double _total = 0;
  int? _next = 0;
  bool _loading = false;
  bool _loaded = false;
  Object? _error;

  (DateTime, DateTime) get _period {
    final n = DateTime.now();
    final today = DateTime(n.year, n.month, n.day);
    return switch (_range) {
      0 => (today, today),
      2 => (DateTime(n.year, n.month - 1, 1), DateTime(n.year, n.month, 0)),
      3 => (DateTime(n.year, 1, 1), today),
      _ => (DateTime(n.year, n.month, 1), today),
    };
  }

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    _rows.clear();
    _next = 0;
    await _more();
  }

  Future<void> _more() async {
    if (_loading || _next == null) return;
    final (f, t) = _period;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final j = await AppScope.read(context).api.get('/api/app/books/', {'page': 'expenses', 'from': _iso.format(f), 'to': _iso.format(t), 'offset': '$_next'});
      if (!mounted) return;
      setState(() {
        _rows.addAll([for (final x in (j['rows'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)]);
        _next = (j['nextOffset'] as num?)?.toInt();
        _total = _d(j['total']);
        _categories = [for (final x in (j['categories'] as List? ?? const [])) Map<String, dynamic>.from(x as Map)];
        _loaded = true;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Expenses Details')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          if (_categories.isEmpty) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add an expense category first (Expenses > Expense Category Details).')));
            return;
          }
          final ok = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            builder: (_) => _EntrySheet(title: 'Add Expense', kind: _EntryKind.expense, extra: const {'page': 'expense'}, categories: _categories),
          );
          if (ok == true) _reload();
        },
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add Expense'),
      ),
      body: Column(children: [
        Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final (i, label) in const [(0, 'Today'), (1, 'This Month'), (2, 'Last Month'), (3, 'This Year')])
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
                        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 100), physics: const AlwaysScrollableScrollPhysics(), children: [
                          _Figure('Total Expenses', _rs(_total), color: noStock),
                          const SizedBox(height: 12),
                          if (_rows.isEmpty) const WebCard(child: Text('No expenses in this period.', style: TextStyle(color: muted))),
                          for (final x in _rows) ...[
                            WebCard(
                              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                              child: Row(children: [
                                Expanded(
                                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Text(_s(x['category']) ?? '—', style: const TextStyle(fontWeight: FontWeight.w600)),
                                    Text([dayMonthYear('${x['date']}'), _s(x['method']) ?? 'Cash', ?_s(x['by']), ?_s(x['description'])].join(' · '),
                                        maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: muted)),
                                  ]),
                                ),
                                Text(_rs(_d(x['amount'])), style: const TextStyle(fontWeight: FontWeight.w700)),
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

// ── Entry forms ───────────────────────────────────────────────────────────

enum _EntryKind { adjustment, cash, expense }

/// The website's small forms: Add Adjustments (Payment Method, Paid Amount, Comment),
/// Add Cash (Payment In/Out, Amount, Description), Add Expense (Category, Amount,
/// Payment Method, Expense By, Description). Each entry has its own id: sent twice, saved once.
class _EntrySheet extends StatefulWidget {
  const _EntrySheet({required this.title, required this.kind, required this.extra, this.subtitle, this.categories = const []});
  final String title;
  final String? subtitle;
  final _EntryKind kind;
  final Map<String, Object?> extra;
  final List<Map<String, dynamic>> categories;

  @override
  State<_EntrySheet> createState() => _EntrySheetState();
}

class _EntrySheetState extends State<_EntrySheet> {
  final _id = newDocId();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  final _by = TextEditingController();
  bool _bank = false;
  bool _out = false;
  String? _category;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    _by.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    if (!(numOf(_amount) > 0)) {
      setState(() => _error = 'Enter the amount.');
      return;
    }
    if (widget.kind == _EntryKind.expense && _category == null) {
      setState(() => _error = 'Choose the category.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = {
      ...widget.extra,
      'id': _id,
      'amount': numOf(_amount),
      if (widget.kind == _EntryKind.adjustment) ...{'method': _bank ? 'Bank' : 'Cash', 'comment': _note.text.trim()},
      if (widget.kind == _EntryKind.cash) ...{'type': _out ? 'out' : 'in', 'description': _note.text.trim()},
      if (widget.kind == _EntryKind.expense) ...{'categoryId': _category, 'method': _bank ? 'Bank' : 'Cash', 'by': _by.text.trim(), 'description': _note.text.trim()},
    };
    try {
      await AppScope.read(context).api.post('/api/app/books/', body);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.offline ? '${e.message} Try again: it is saved only once.' : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget select<T>(T value, Map<T, String> items, ValueChanged<T> onChanged) => DropdownButtonFormField<T>(
          initialValue: value,
          isExpanded: true,
          borderRadius: BorderRadius.circular(12),
          dropdownColor: Colors.white,
          icon: const Icon(Icons.expand_more_rounded, size: 20),
          items: [for (final e in items.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) => v == null ? null : setState(() => onChanged(v)),
        );
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        top: false,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(widget.title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          if (widget.subtitle != null) Text(widget.subtitle!, style: const TextStyle(color: muted, fontSize: 13)),
          const SizedBox(height: 14),
          if (widget.kind == _EntryKind.cash) ...[
            LabeledField(label: 'Transaction', required: true, child: select<bool>(_out, const {false: 'Payment In', true: 'Payment Out'}, (v) => _out = v)),
            const SizedBox(height: 10),
          ],
          if (widget.kind == _EntryKind.expense) ...[
            LabeledField(
              label: 'Category',
              required: true,
              child: DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                hint: const Text('Select...'),
                borderRadius: BorderRadius.circular(12),
                dropdownColor: Colors.white,
                icon: const Icon(Icons.expand_more_rounded, size: 20),
                items: [for (final c in widget.categories) DropdownMenuItem(value: '${c['id']}', child: Text('${c['name']}'))],
                onChanged: (v) => setState(() => _category = v),
              ),
            ),
            const SizedBox(height: 10),
          ],
          LabeledField(
            label: widget.kind == _EntryKind.adjustment ? 'Paid Amount' : 'Amount',
            required: true,
            child: TextField(controller: _amount, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: numberInput, decoration: const InputDecoration(prefixText: 'Rs ')),
          ),
          const SizedBox(height: 10),
          if (widget.kind != _EntryKind.cash) ...[
            LabeledField(label: 'Payment Method', required: true, child: select<bool>(_bank, const {false: 'Cash', true: 'Bank'}, (v) => _bank = v)),
            const SizedBox(height: 10),
          ],
          if (widget.kind == _EntryKind.expense) ...[
            LabeledField(label: 'Expense By', child: TextField(controller: _by, textCapitalization: TextCapitalization.words)),
            const SizedBox(height: 10),
          ],
          LabeledField(label: widget.kind == _EntryKind.adjustment ? 'Comment' : 'Description', child: TextField(controller: _note)),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_error!, style: const TextStyle(color: noStock, fontWeight: FontWeight.w500))),
          const SizedBox(height: 16),
          GradientButton(label: _busy ? 'Saving...' : 'Save', busy: _busy, expand: true, onPressed: _save),
        ]),
      ),
    );
  }
}
