import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/doc_id.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'form_bits.dart';
import 'pickers.dart';
import 'theme.dart';

class _SaleLine {
  _SaleLine(this.p);
  final ProductRow p;
  double qty = 1;
  double bonus = 0;
  double? discPct;
  bool loose = false;
}

/// New Invoice: products, customer, cash or credit, discount and paid. The
/// totals come from MAVIN.pk (the same prices, discounts, tax and stock rules
/// as saving), so what the screen shows is what is saved.
class InvoiceScreen extends StatefulWidget {
  const InvoiceScreen({super.key});

  @override
  State<InvoiceScreen> createState() => InvoiceScreenState();
}

class InvoiceScreenState extends State<InvoiceScreen> with BackGuard {
  String _id = newDocId();
  final List<_SaleLine> _lines = [];
  Party? _customer;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _discount = TextEditingController();
  final _paid = TextEditingController();
  final _note = TextEditingController();
  bool _credit = false;

  DocTotals? _totals;
  String? _problem;
  bool _pending = false;
  bool _saving = false;
  Timer? _debounce;
  int _gen = 0;

  bool get _dirty => _lines.isNotEmpty;

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_name, _phone, _discount, _paid, _note]) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, Object?> _body({double? paid}) => {
        'id': _id,
        'lines': [
          for (final l in _lines) {'productId': l.p.id, 'unit': l.loose ? 'loose' : 'pack', 'qty': l.qty, 'bonus': l.bonus, if (l.discPct != null) 'discountPct': l.discPct},
        ],
        if (_customer != null) 'customerId': _customer!.id,
        if (_customer == null && _name.text.trim().isNotEmpty) 'customerName': _name.text.trim(),
        if (_phone.text.trim().isNotEmpty) 'customerPhone': _phone.text.trim(),
        'invOn': _credit ? 'credit' : 'cash',
        'discountRs': numOf(_discount),
        'paid': paid ?? numOf(_paid),
        if (_note.text.trim().isNotEmpty) 'description': _note.text.trim(),
      };

  void _changed() {
    setState(() {});
    _debounce?.cancel();
    if (_lines.isEmpty) {
      setState(() {
        _totals = null;
        _problem = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 450), _preview);
  }

  /// The server's totals for what is on screen now; null and a problem when it can't be sold.
  Future<DocTotals?> _preview() async {
    if (_lines.isEmpty) return null;
    final gen = ++_gen;
    setState(() => _pending = true);
    try {
      final t = DocTotals.fromJson(await AppScope.read(context).api.post('/api/app/sale/?preview=1', _body()));
      if (mounted && gen == _gen) {
        setState(() {
          _totals = t;
          _problem = null;
        });
      }
      return t;
    } on ApiException catch (e) {
      if (mounted && gen == _gen) setState(() => _problem = e.message);
      return null;
    } finally {
      if (mounted && gen == _gen) setState(() => _pending = false);
    }
  }

  Future<void> _addProduct() async {
    final p = await Navigator.push<ProductRow>(context, MaterialPageRoute(builder: (_) => const ProductPicker(title: 'Add to invoice', hideOutOfStock: true)));
    if (p == null) return;
    final have = _lines.where((l) => l.p.id == p.id && !l.loose).firstOrNull;
    if (have != null) {
      have.qty += 1;
    } else {
      _lines.add(_SaleLine(p));
    }
    _changed();
  }

  Future<void> _pickCustomer() async {
    final c = await Navigator.push<Party>(context, MaterialPageRoute(builder: (_) => const PartyPicker(kind: 'customer')));
    if (c == null) return;
    _customer = c;
    _name.text = c.name;
    if (c.phone != null) _phone.text = c.phone!;
    _changed();
  }

  Future<void> _editLine(int i) async {
    final l = _lines[i];
    final q = TextEditingController(text: qty(l.qty));
    final b = TextEditingController(text: l.bonus == 0 ? '' : qty(l.bonus));
    final d = TextEditingController(text: l.discPct == null ? '' : qty(l.discPct!));
    var loose = l.loose;
    final remove = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + MediaQuery.viewInsetsOf(ctx).bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(l.p.name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w500)),
            const SizedBox(height: 12),
            if (l.p.packing > 1) ...[
              SegmentedButton<bool>(
                segments: [const ButtonSegment(value: false, label: Text('Packs')), ButtonSegment(value: true, label: Text('Loose (of ${qty(l.p.packing)})'))],
                selected: {loose},
                onSelectionChanged: (s) => set(() => loose = s.first),
              ),
              const SizedBox(height: 12),
            ],
            Row(children: [
              Expanded(child: NumField(controller: q, label: 'Quantity')),
              const SizedBox(width: 8),
              Expanded(child: NumField(controller: b, label: 'Bonus')),
              const SizedBox(width: 8),
              Expanded(child: NumField(controller: d, label: 'Disc %')),
            ]),
            const SizedBox(height: 6),
            const Text('Leave Disc % empty to use the product\'s own discount.', style: TextStyle(fontSize: 12, color: Color(0xFF667085))),
            const SizedBox(height: 12),
            Row(children: [
              TextButton.icon(onPressed: () => Navigator.pop(ctx, true), style: TextButton.styleFrom(foregroundColor: noStock), icon: const Icon(Icons.delete_outline_rounded), label: const Text('Remove')),
              const Spacer(),
              FilledButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Done')),
            ]),
          ]),
        ),
      ),
    );
    if (remove == null) return;
    if (remove) {
      _lines.removeAt(i);
    } else {
      l.qty = numOf(q) > 0 ? numOf(q) : l.qty;
      l.bonus = numOf(b);
      l.discPct = d.text.trim().isEmpty ? null : numOf(d).clamp(0, 100).toDouble();
      l.loose = loose;
    }
    _changed();
  }

  void _reset() {
    setState(() {
      _id = newDocId();
      _lines.clear();
      _customer = null;
      for (final c in [_name, _phone, _discount, _paid, _note]) {
        c.clear();
      }
      _credit = false;
      _totals = null;
      _problem = null;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    if (_lines.isEmpty) {
      setState(() => _problem = 'Add at least one product.');
      return;
    }
    if (_credit && _customer == null && _name.text.trim().isEmpty) {
      setState(() => _problem = 'A credit sale needs a customer.');
      return;
    }
    setState(() => _saving = true);
    try {
      // The latest totals first: a cash sale is paid in full unless Paid says otherwise.
      final t = await _preview();
      if (t == null) return;
      final paid = _paid.text.trim().isNotEmpty ? numOf(_paid) : (_credit ? 0.0 : t.payable);
      Map<String, dynamic>? r;
      while (r == null) {
        try {
          if (!mounted) return;
          r = await AppScope.read(context).api.post('/api/app/sale/', _body(paid: paid));
        } on ApiException catch (e) {
          if (!e.offline || !mounted || !await askRetryUnknown(context, e, 'invoice')) {
            if (!e.offline && mounted) setState(() => _problem = e.message);
            return;
          }
        }
      }
      if (!mounted) return;
      final no = r['invoiceNo'];
      final balance = (r['balance'] as num?)?.toDouble() ?? 0;
      _reset();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Invoice #$no saved · ${rs((r['payable'] as num?) ?? 0)}${balance > 0.004 ? ' · Balance ${rs(balance)}' : ''}'),
        behavior: SnackBarBehavior.floating,
      ));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Future<bool> handleBack() async {
    if (!_dirty) return false;
    if (await confirmDiscard(context, 'invoice')) {
      _reset();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final t = _totals;
    final linesMatch = t != null && t.lines.length == _lines.length;
    return Column(children: [
      Expanded(
        child: ListView(padding: const EdgeInsets.only(bottom: 16), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: OutlinedButton.icon(
              onPressed: _addProduct,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Add product'),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), backgroundColor: Colors.white),
            ),
          ),
          SectionLabel('Items · ${_lines.length}'),
          if (_lines.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: Text('Add the first product to start the invoice.', style: TextStyle(color: Color(0xFF667085))))
          else
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Card(
                clipBehavior: Clip.antiAlias,
                child: Column(children: [
                  for (var i = 0; i < _lines.length; i++) ...[
                    if (i > 0) const Divider(),
                    _LineTile(
                      line: _lines[i],
                      total: linesMatch ? t.lines[i] : null,
                      onTap: () => _editLine(i),
                      onQty: (d) {
                        final l = _lines[i];
                        l.qty = (l.qty + d).clamp(0, 1e9).toDouble();
                        if (l.qty <= 0) _lines.removeAt(i);
                        _changed();
                      },
                    ),
                  ],
                ]),
              ),
            ),
          const SectionLabel('Customer'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Column(children: [
              TextField(
                controller: _name,
                readOnly: _customer != null,
                onChanged: (_) => _changed(),
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  labelText: 'Customer (blank = walk-in)',
                  suffixIcon: _customer != null
                      ? IconButton(tooltip: 'Clear customer', icon: const Icon(Icons.close_rounded), onPressed: () {
                          _customer = null;
                          _name.clear();
                          _changed();
                        })
                      : IconButton(tooltip: 'Choose a saved customer', icon: const Icon(Icons.person_search_outlined), onPressed: _pickCustomer),
                ),
              ),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(
                  child: TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    onChanged: (_) => _changed(),
                    decoration: const InputDecoration(labelText: 'Mobile', hintText: '03xx xxxxxxx'),
                  ),
                ),
                const SizedBox(width: 8),
                SegmentedButton<bool>(
                  showSelectedIcon: false,
                  segments: const [ButtonSegment(value: false, label: Text('Cash')), ButtonSegment(value: true, label: Text('Credit'))],
                  selected: {_credit},
                  onSelectionChanged: (s) {
                    _credit = s.first;
                    _changed();
                  },
                ),
              ]),
            ]),
          ),
          const SectionLabel('Payment'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Column(children: [
              Row(children: [
                Expanded(child: NumField(controller: _discount, label: 'Discount Rs', onChanged: (_) => _changed())),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _paid,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: numberInput,
                    onChanged: (_) => _changed(),
                    decoration: InputDecoration(labelText: 'Paid Rs', hintText: _credit ? '0' : (t == null ? 'In full' : qty(t.payable))),
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              TextField(controller: _note, decoration: const InputDecoration(labelText: 'Description (optional)')),
            ]),
          ),
          if (t != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: DefaultTextStyle(
                style: const TextStyle(fontSize: 13, color: Color(0xFF667085)),
                child: Column(children: [
                  _Sum('Subtotal', rs(t.subtotal)),
                  if (t.discount > 0) _Sum('Discounts', '- ${rs(t.discount)}'),
                  if (t.tax > 0) _Sum('Tax', rs(t.tax)),
                ]),
              ),
            ),
        ]),
      ),
      TotalsBar(
        label: 'Payable · ${_lines.length} items',
        payable: t?.payable,
        balance: t == null ? null : t.payable - (_paid.text.trim().isNotEmpty ? numOf(_paid) : (_credit ? 0 : t.payable)),
        problem: _problem,
        pending: _pending,
        busy: _saving,
        action: 'Save invoice',
        onAction: _lines.isEmpty ? null : _save,
      ),
    ]);
  }
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, required this.total, required this.onTap, required this.onQty});
  final _SaleLine line;
  final double? total;
  final VoidCallback onTap;
  final ValueChanged<double> onQty;

  @override
  Widget build(BuildContext context) {
    final l = line;
    final stockPacks = l.p.qty;
    final wantPacks = l.loose ? l.qty / l.p.packing : l.qty;
    final short = wantPacks > stockPacks + 1e-9;
    final detail = [
      '${rs(l.p.salePrice)}${l.loose ? ' / pack' : ''}',
      if (l.loose) 'loose',
      if (l.bonus > 0) '+${qty(l.bonus)} bonus',
      if (l.discPct != null) '${qty(l.discPct!)}% off',
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(l.p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w500)),
              Text(detail, style: const TextStyle(fontSize: 12, color: Color(0xFF667085))),
              if (short) Text('Only ${qty(stockPacks)} in stock', style: const TextStyle(fontSize: 12, color: noStock)),
            ]),
          ),
          IconButton(tooltip: 'Less', onPressed: () => onQty(-1), icon: const Icon(Icons.remove_rounded)),
          Text(qty(l.qty), style: const TextStyle(fontWeight: FontWeight.w600)),
          IconButton(tooltip: 'More', onPressed: () => onQty(1), icon: const Icon(Icons.add_rounded)),
          SizedBox(width: 82, child: Text(total == null ? '…' : rs(total!), textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w500))),
        ]),
      ),
    );
  }
}

class _Sum extends StatelessWidget {
  const _Sum(this.k, this.v);
  final String k;
  final String v;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 2), child: Row(children: [Expanded(child: Text(k)), Text(v)]));
}
