import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'invoice_share.dart';
import 'states.dart';
import 'theme.dart';

const _muted = Color(0xFF667085);

/// Sales: invoices newest first, search by invoice number, customer or phone,
/// pages of 50 as the list scrolls. Returns, held invoices and quotations stay
/// in the web version.
class SalesScreen extends StatefulWidget {
  const SalesScreen({super.key});

  @override
  State<SalesScreen> createState() => _SalesScreenState();
}

class _SalesScreenState extends State<SalesScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  final List<InvoiceRow> _rows = [];
  int? _next = 0;
  bool _loading = false;
  Object? _error;
  Timer? _debounce;
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final q = _search.text.trim();
      final page = InvoicePage.fromJson(await AppScope.read(context).api.get('/api/app/invoices/', {if (q.isNotEmpty) 'q': q, 'offset': '$_next'}));
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
      list = const LoadingRows(height: 62);
    } else if (_rows.isEmpty && _error != null) {
      list = StateMessage.error(_error!, onRetry: _reload);
    } else if (_rows.isEmpty) {
      list = searching
          ? StateMessage(icon: Icons.search_off_rounded, title: 'No invoices match "${_search.text.trim()}"', detail: 'Search by invoice number, customer name or mobile.', action: 'Clear search', onAction: () {
              _search.clear();
              _reload();
            })
          : const StateMessage(icon: Icons.receipt_long_outlined, title: 'No invoices yet');
    } else {
      list = RefreshIndicator(
        onRefresh: _reload,
        child: ListView.separated(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _rows.length + 1,
          separatorBuilder: (_, _) => const Divider(),
          itemBuilder: (context, i) {
            if (i == _rows.length) {
              if (_error != null) return TextButton(onPressed: _loadMore, child: const Text('Couldn\'t load more. Try again'));
              if (_next != null) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
              return Padding(
                padding: const EdgeInsets.all(14),
                child: Text('${_rows.length} invoices · Returns and quotations are in the web version.', style: const TextStyle(fontSize: 12, color: _muted)),
              );
            }
            return _InvoiceTile(row: _rows[i]);
          },
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Sales')),
      body: Column(children: [
        Material(
          color: mavinNavy,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _search,
              onChanged: (_) {
                setState(() {});
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), _reload);
              },
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Invoice #, customer or mobile',
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
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
        Expanded(child: list),
      ]),
    );
  }
}

class _InvoiceTile extends StatelessWidget {
  const _InvoiceTile({required this.row});
  final InvoiceRow row;

  @override
  Widget build(BuildContext context) {
    final due = row.balance > 0.004;
    return Material(
      color: Colors.white,
      child: InkWell(
        onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: row.id, no: row.no))),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${row.no == null ? '' : '#${row.no} · '}${row.customer}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w500)),
                const SizedBox(height: 2),
                Text([dayMonthYear(row.date), if (row.fbrNo != null) 'FBR'].join(' · '), style: const TextStyle(fontSize: 12, color: _muted)),
              ]),
            ),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(rs(row.payable), style: const TextStyle(fontWeight: FontWeight.w500, fontFeatures: [FontFeature.tabularFigures()])),
              if (due) Text('Due ${rs(row.balance)}', style: const TextStyle(fontSize: 12, color: noStock)),
            ]),
          ]),
        ),
      ),
    );
  }
}

/// One invoice: customer, items (loose sales shown as units) and the totals.
class InvoiceDetailScreen extends StatefulWidget {
  const InvoiceDetailScreen({super.key, required this.id, this.no});
  final String id;
  final int? no;

  @override
  State<InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

class _InvoiceDetailScreenState extends State<InvoiceDetailScreen> {
  InvoiceDetail? _d;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final d = InvoiceDetail.fromJson(await AppScope.read(context).api.get('/api/app/invoices/', {'id': widget.id}));
      if (mounted) setState(() => _d = d);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    final no = d?.head.no ?? widget.no;
    Widget body;
    if (d == null && _error != null) {
      body = StateMessage.error(_error!, onRetry: _load);
    } else if (d == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final h = d.head;
      final facts = <(String, String)>[
        ('Date', dayMonthYear(h.date)),
        ('Customer', h.customer),
        if (d.phone != null) ('Mobile', d.phone!),
        if (d.salesman != null) ('Salesman', d.salesman!),
        if (h.fbrNo != null) ('FBR invoice', h.fbrNo!),
      ];
      final totals = <(String, String, bool)>[
        ('Total', rs(d.total), false),
        if (d.discount > 0.004) ('Discount', '- ${rs(d.discount)}', false),
        if (d.charges > 0.004) ('Tax and charges', rs(d.charges), false),
        ('Payable', rs(h.payable), true),
        ('Paid', rs(h.paid), false),
        if (h.balance.abs() > 0.004) ('Balance', rs(h.balance), true),
      ];
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(16, 12, 16, 24), children: [
          _card([for (final (k, v) in facts) _pair(k, v)]),
          _heading('ITEMS (${d.items.length})'),
          Card(
            clipBehavior: Clip.antiAlias,
            child: d.items.isEmpty
                ? const Padding(padding: EdgeInsets.all(16), child: Text('No items.', style: TextStyle(color: _muted)))
                : Column(
                    children: ListTile.divideTiles(context: context, tiles: [
                      for (final it in d.items)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Expanded(
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(it.product, style: const TextStyle(fontWeight: FontWeight.w500)),
                                const SizedBox(height: 2),
                                Text(
                                  [
                                    '${soldQty(it.qty, it.packing)} × ${rs(it.price)}${it.packing > 1 ? '/pack' : ''}',
                                    if (it.bonus > 0) '+${qty(it.bonus)} bonus',
                                    if (it.discount > 0.004) 'disc ${rs(it.discount)}',
                                    if (it.batchNo != null) 'Batch ${it.batchNo}',
                                  ].join(' · '),
                                  style: const TextStyle(fontSize: 12, color: _muted),
                                ),
                              ]),
                            ),
                            const SizedBox(width: 12),
                            Text(rs(it.total), style: const TextStyle(fontWeight: FontWeight.w500, fontFeatures: [FontFeature.tabularFigures()])),
                          ]),
                        ),
                    ]).toList(),
                  ),
          ),
          const SizedBox(height: 12),
          _card([for (final (k, v, strong) in totals) _pair(k, v, strong: strong, warn: k == 'Balance')]),
          const Padding(
            padding: EdgeInsets.fromLTRB(4, 12, 4, 0),
            child: Text('Print, return, edit and FBR submission are in the web version.', style: TextStyle(fontSize: 12, color: _muted)),
          ),
        ]),
      );
    }
    final share = d != null && canShareInvoices(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(no == null ? 'Invoice' : 'Invoice #$no'),
        actions: [if (share) IconButton(tooltip: 'Send on WhatsApp', onPressed: () => shareInvoice(context, invoiceId: widget.id), icon: const Icon(Icons.share_rounded))],
      ),
      body: body,
      bottomNavigationBar: !share
          ? null
          : Material(
              color: Colors.white,
              elevation: 8,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: whatsappGreen, minimumSize: const Size.fromHeight(50)),
                    onPressed: () => shareInvoice(context, invoiceId: widget.id),
                    icon: const Icon(Icons.chat_rounded),
                    label: const Text('Send on WhatsApp'),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _heading(String t) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 6),
        child: Text(t, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: .6, color: _muted)),
      );

  Widget _card(List<Widget> rows) => Card(child: Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Column(children: rows)));

  Widget _pair(String k, String v, {bool strong = false, bool warn = false}) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(k, style: const TextStyle(color: _muted)),
          const SizedBox(width: 16),
          Expanded(child: Text(v, textAlign: TextAlign.right, style: TextStyle(fontWeight: strong ? FontWeight.w700 : FontWeight.w500, color: warn ? noStock : null))),
        ]),
      );
}
