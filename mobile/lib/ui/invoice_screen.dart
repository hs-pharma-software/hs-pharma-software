import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/doc_id.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'form_bits.dart';
import 'invoice_share.dart';
import 'pickers.dart';
import 'product_search.dart';
import 'sales_screen.dart';
import 'theme.dart';

class _SaleLine {
  _SaleLine(this.p);
  final ProductRow p;
  double qty = 1;
  double bonus = 0;
  double? discPct;
  bool loose = false;
}

/// New Invoice. The product search is always at the top: type (or scan) and
/// tap a match to add it; the keyboard stays up for the next one. The totals
/// come from MAVIN.pk (the same prices, discounts, tax and stock rules as
/// saving), so what the screen shows is what is saved.
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
  late final ProductSearch _search = ProductSearch(api: apiOf(context));

  DocTotals? _totals;
  String? _problem;
  bool _pending = false;
  bool _saving = false;
  Timer? _debounce;
  int _gen = 0;
  String? _flash;

  bool get _dirty => _lines.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
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

  /// From the search: a new line on top, or one more of a product already added.
  void _add(ProductRow p) {
    final have = _lines.where((l) => l.p.id == p.id && !l.loose).firstOrNull;
    if (have != null) {
      have.qty += 1;
    } else {
      _lines.insert(0, _SaleLine(p));
    }
    _flash = p.id;
    _search.clear();
    _search.focus.requestFocus();
    _changed();
    Future.delayed(const Duration(milliseconds: 900), () {
      if (mounted && _flash == p.id) setState(() => _flash = null);
    });
  }

  double _inForm(String productId) => _lines.where((l) => l.p.id == productId && !l.loose).fold(0.0, (t, l) => t + l.qty);

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
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, set) => Padding(
          padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + MediaQuery.viewInsetsOf(ctx).bottom),
          child: SafeArea(
            top: false,
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(l.p.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              const SizedBox(height: 2),
              Text('${rs(l.p.salePrice)} per pack · ${qty(l.p.qty)} in stock', style: const TextStyle(color: muted)),
              const SizedBox(height: 16),
              if (l.p.packing > 1) ...[
                SegmentedButton<bool>(
                  showSelectedIcon: false,
                  segments: [const ButtonSegment(value: false, label: Text('Packs')), ButtonSegment(value: true, label: Text('Loose units (of ${qty(l.p.packing)})'))],
                  selected: {loose},
                  onSelectionChanged: (s) => set(() => loose = s.first),
                ),
                const SizedBox(height: 14),
              ],
              Row(children: [
                Expanded(child: NumField(controller: q, label: loose ? 'Units' : 'Packs')),
                const SizedBox(width: 10),
                Expanded(child: NumField(controller: b, label: 'Bonus')),
                const SizedBox(width: 10),
                Expanded(child: NumField(controller: d, label: 'Disc %')),
              ]),
              const SizedBox(height: 8),
              const Text('Leave Disc % empty to use the product\'s own discount.', style: TextStyle(fontSize: 12.5, color: muted)),
              const SizedBox(height: 18),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.pop(ctx, true),
                    style: OutlinedButton.styleFrom(foregroundColor: noStock, side: const BorderSide(color: Color(0xFFF1C4C4))),
                    icon: const Icon(Icons.delete_outline_rounded),
                    label: const Text('Remove'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: FilledButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Done'))),
              ]),
            ]),
          ),
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
    FocusScope.of(context).unfocus();
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
      final id = '${r['id']}';
      final payable = ((r['payable'] as num?) ?? 0).toDouble();
      final balance = (r['balance'] as num?)?.toDouble() ?? 0;
      _reset();
      HapticFeedback.mediumImpact();
      await _savedSheet(id: id, no: no is num ? no.toInt() : null, payable: payable, balance: balance);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _savedSheet({required String id, required int? no, required double payable, required double balance}) async {
    final share = canShareInvoices(context);
    final nav = Navigator.of(context);
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Center(
              child: Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(color: mavinGreen.withValues(alpha: .12), shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded, color: mavinGreen, size: 38),
              ),
            ),
            const SizedBox(height: 14),
            Text(no == null ? 'Invoice saved' : 'Invoice #$no saved', textAlign: TextAlign.center, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(balance > 0.004 ? '${rs(payable)}  ·  Balance ${rs(balance)}' : '${rs(payable)}  ·  Paid in full',
                textAlign: TextAlign.center, style: TextStyle(fontSize: 15, color: balance > 0.004 ? noStock : muted, fontWeight: FontWeight.w500)),
            const SizedBox(height: 22),
            if (share) ...[
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: whatsappGreen, minimumSize: const Size.fromHeight(52)),
                onPressed: () {
                  Navigator.pop(ctx);
                  shareInvoice(context, invoiceId: id);
                },
                icon: const Icon(Icons.chat_rounded),
                label: const Text('Send on WhatsApp'),
              ),
              const SizedBox(height: 10),
            ],
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    nav.push(MaterialPageRoute(builder: (_) => InvoiceDetailScreen(id: id, no: no)));
                  },
                  child: const Text('View invoice'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    _search.focus.requestFocus();
                  },
                  child: const Text('New invoice'),
                ),
              ),
            ]),
          ]),
        ),
      ),
    );
  }

  @override
  Future<bool> handleBack() async {
    if (_search.open) {
      _search.clear();
      return true;
    }
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
    final paidNow = t == null ? null : (_paid.text.trim().isNotEmpty ? numOf(_paid) : (_credit ? 0.0 : t.payable));

    final form = ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 20),
      children: [
        if (_lines.isEmpty)
          const _EmptyInvoice()
        else ...[
          _CardTitle('Items', trailing: '${_lines.length} ${_lines.length == 1 ? 'product' : 'products'}'),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(children: [
              for (var i = 0; i < _lines.length; i++) ...[
                if (i > 0) const Divider(indent: 14, endIndent: 14),
                Dismissible(
                  key: ObjectKey(_lines[i]),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    color: const Color(0xFFFDECEC),
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    child: const Row(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.delete_outline_rounded, color: noStock), SizedBox(width: 6), Text('Remove', style: TextStyle(color: noStock, fontWeight: FontWeight.w600))]),
                  ),
                  onDismissed: (_) {
                    _lines.removeAt(i);
                    _changed();
                  },
                  child: _LineTile(
                    line: _lines[i],
                    total: linesMatch ? t.lines[i] : null,
                    flash: _flash == _lines[i].p.id,
                    onTap: () => _editLine(i),
                    onQty: (d) {
                      final l = _lines[i];
                      l.qty = (l.qty + d).clamp(0, 1e9).toDouble();
                      if (l.qty <= 0) _lines.removeAt(i);
                      HapticFeedback.selectionClick();
                      _changed();
                    },
                  ),
                ),
              ],
            ]),
          ),
          const SizedBox(height: 6),
          const Text('Tap an item for loose units, bonus or discount. Swipe left to remove.', style: TextStyle(fontSize: 12, color: muted)),
        ],
        const SizedBox(height: 16),
        _CardTitle('Customer'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(children: [
              Row(children: [
                Expanded(
                  child: TextField(
                    controller: _name,
                    readOnly: _customer != null,
                    onChanged: (_) => _changed(),
                    textInputAction: TextInputAction.next,
                    decoration: InputDecoration(
                      labelText: _customer != null ? 'Saved customer' : 'Name (empty = walk-in)',
                      prefixIcon: Icon(_customer != null ? Icons.verified_user_outlined : Icons.person_outline_rounded),
                      suffixIcon: _customer != null
                          ? IconButton(tooltip: 'Clear customer', icon: const Icon(Icons.close_rounded), onPressed: () {
                              _customer = null;
                              _name.clear();
                              _phone.clear();
                              _changed();
                            })
                          : null,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filledTonal(
                  tooltip: 'Choose a saved customer',
                  style: IconButton.styleFrom(backgroundColor: mavinTint, foregroundColor: mavinNavy, minimumSize: const Size(48, 48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  onPressed: _pickCustomer,
                  icon: const Icon(Icons.person_search_rounded),
                ),
              ]),
              const SizedBox(height: 12),
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                onChanged: (_) => _changed(),
                decoration: const InputDecoration(labelText: 'Mobile (for WhatsApp)', hintText: '03xx xxxxxxx', prefixIcon: Icon(Icons.phone_outlined)),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: SegmentedButton<bool>(
                  showSelectedIcon: false,
                  segments: const [
                    ButtonSegment(value: false, label: Text('Cash sale'), icon: Icon(Icons.payments_outlined)),
                    ButtonSegment(value: true, label: Text('Credit sale'), icon: Icon(Icons.schedule_rounded)),
                  ],
                  selected: {_credit},
                  onSelectionChanged: (s) {
                    _credit = s.first;
                    _changed();
                  },
                ),
              ),
            ]),
          ),
        ),
        const SizedBox(height: 16),
        _CardTitle('Payment'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(children: [
              Row(children: [
                Expanded(child: NumField(controller: _discount, label: 'Discount', suffix: 'Rs', onChanged: (_) => _changed())),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _paid,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: numberInput,
                    onChanged: (_) => _changed(),
                    decoration: InputDecoration(labelText: 'Paid', suffixText: 'Rs', hintText: _credit ? '0' : (t == null ? 'In full' : qty(t.payable))),
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              TextField(controller: _note, decoration: const InputDecoration(labelText: 'Note (optional)', prefixIcon: Icon(Icons.notes_rounded))),
              if (t != null) ...[
                const SizedBox(height: 14),
                const Divider(),
                const SizedBox(height: 10),
                _Sum('Subtotal', rs(t.subtotal)),
                if (t.discount > 0) _Sum('Discounts', '- ${rs(t.discount)}'),
                if (t.tax > 0) _Sum('Tax', rs(t.tax)),
                _Sum('Payable', rs(t.payable), strong: true),
                if (paidNow != null) _Sum('Paid', rs(paidNow)),
              ],
            ]),
          ),
        ),
      ],
    );

    return Column(children: [
      ProductSearchBar(search: _search, onPick: _add),
      Expanded(
        child: Stack(children: [
          Positioned.fill(child: form),
          if (_search.open) Positioned.fill(child: ProductSearchResults(search: _search, onPick: _add, inForm: _inForm)),
        ]),
      ),
      if (!_search.open)
        TotalsBar(
          label: _lines.isEmpty ? 'No items yet' : '${_lines.length} ${_lines.length == 1 ? 'item' : 'items'}',
          payable: t?.payable,
          balance: t == null || paidNow == null ? null : t.payable - paidNow,
          problem: _problem,
          pending: _pending,
          busy: _saving,
          action: 'Save',
          onAction: _lines.isEmpty ? null : _save,
        ),
    ]);
  }
}

class _EmptyInvoice extends StatelessWidget {
  const _EmptyInvoice();
  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 28, 20, 28),
          child: Column(children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(color: mavinTint, borderRadius: BorderRadius.circular(20)),
              child: const Icon(Icons.receipt_long_rounded, color: mavinNavy, size: 32),
            ),
            const SizedBox(height: 14),
            const Text('Start a new invoice', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            const Text('Type a medicine name in the search above, or scan its barcode. Tap it to add.', textAlign: TextAlign.center, style: TextStyle(color: muted)),
          ]),
        ),
      );
}

class _CardTitle extends StatelessWidget {
  const _CardTitle(this.text, {this.trailing});
  final String text;
  final String? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
        child: Row(children: [
          Expanded(child: Text(text, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF101828)))),
          if (trailing != null) Text(trailing!, style: const TextStyle(fontSize: 12.5, color: muted, fontWeight: FontWeight.w500)),
        ]),
      );
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, required this.total, required this.onTap, required this.onQty, this.flash = false});
  final _SaleLine line;
  final double? total;
  final VoidCallback onTap;
  final ValueChanged<double> onQty;
  final bool flash;

  @override
  Widget build(BuildContext context) {
    final l = line;
    final stockPacks = l.p.qty;
    final wantPacks = l.loose ? l.qty / l.p.packing : l.qty;
    final short = wantPacks > stockPacks + 1e-9;
    final detail = [
      '${rs(l.p.salePrice)} / pack',
      if (l.loose) 'loose units',
      if (l.bonus > 0) '+${qty(l.bonus)} bonus',
      if (l.discPct != null) '${qty(l.discPct!)}% off',
    ].join(' · ');
    return AnimatedContainer(
      duration: const Duration(milliseconds: 400),
      color: flash ? const Color(0xFFEAF2FF) : Colors.white,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 12, 10),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(l.p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(detail, style: const TextStyle(fontSize: 12.5, color: muted)),
                if (short) Text('Only ${qty(stockPacks)} in stock', style: const TextStyle(fontSize: 12.5, color: noStock, fontWeight: FontWeight.w500)),
                const SizedBox(height: 6),
                Text(total == null ? '…' : rs(total!), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: mavinNavy)),
              ]),
            ),
            const SizedBox(width: 8),
            _Stepper(value: l.qty, unit: l.loose ? 'units' : null, onChange: onQty),
          ]),
        ),
      ),
    );
  }
}

/// [ − 2 + ] in one rounded pill.
class _Stepper extends StatelessWidget {
  const _Stepper({required this.value, required this.onChange, this.unit});
  final double value;
  final ValueChanged<double> onChange;
  final String? unit;

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData i, String tip, double d) => SizedBox(
          width: 40,
          height: 40,
          child: IconButton(tooltip: tip, padding: EdgeInsets.zero, onPressed: () => onChange(d), icon: Icon(i, size: 20, color: mavinNavy)),
        );
    return Container(
      decoration: BoxDecoration(color: const Color(0xFFF2F5FA), borderRadius: BorderRadius.circular(12), border: Border.all(color: hairline)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        btn(value <= 1 ? Icons.delete_outline_rounded : Icons.remove_rounded, value <= 1 ? 'Remove' : 'One less', -1),
        ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 30),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(qty(value), textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            if (unit != null) Text(unit!, style: const TextStyle(fontSize: 10, color: muted)),
          ]),
        ),
        btn(Icons.add_rounded, 'One more', 1),
      ]),
    );
  }
}

class _Sum extends StatelessWidget {
  const _Sum(this.k, this.v, {this.strong = false});
  final String k;
  final String v;
  final bool strong;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(k, style: TextStyle(color: strong ? const Color(0xFF101828) : muted, fontWeight: strong ? FontWeight.w600 : null))),
          Text(v, style: TextStyle(fontWeight: strong ? FontWeight.w700 : FontWeight.w500, fontSize: strong ? 15.5 : 14)),
        ]),
      );
}
