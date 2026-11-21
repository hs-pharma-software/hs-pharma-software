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
  _SaleLine(this.p) : loose = p.packing > 1 {
    qty.text = '1';
  }
  final ProductRow p;
  final qty = TextEditingController();
  final bonus = TextEditingController();
  final disc = TextEditingController();
  final key = UniqueKey();

  /// The website starts a line in the loose unit (Tab) when the product has one.
  bool loose;

  /// The loose unit's name ("Tab"), from the product's unit; "Unit" when it has none of its own.
  String get looseName => p.unit == null || p.unit!.trim().isEmpty || p.unit!.toLowerCase() == 'pack' ? 'Unit' : p.unit!;
  double get q => numOf(qty);
  void dispose() {
    qty.dispose();
    bonus.dispose();
    disc.dispose();
  }
}

/// Create Invoice, laid out as the website's invoice form
/// (src/components/invoices/InvoiceFormModal.tsx): Inv On, Salesman and
/// Customer; Customer & Buyer Details; Barcode/Product Name; the lines (Unit,
/// Batch, Avail, Qty, Bonus, Sale Price, Tax %, Disc %, Total); Total,
/// Charges, Discount Rs, Tax, Payable, Paid, Balance, Description; Reset and
/// Save. Prices, batches (earliest expiry first), tax and discounts come from
/// MAVIN.pk exactly as the save will work them out.
class InvoiceScreen extends StatefulWidget {
  const InvoiceScreen({super.key});

  @override
  State<InvoiceScreen> createState() => InvoiceScreenState();
}

class InvoiceScreenState extends State<InvoiceScreen> with BackGuard {
  String _id = newDocId();
  final List<_SaleLine> _lines = [];
  Party? _customer;
  Party? _salesman;
  List<Party> _salesmen = const [];
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _charges = TextEditingController();
  final _discount = TextEditingController();
  final _paid = TextEditingController();
  final _note = TextEditingController();
  bool _credit = false;
  bool _buyerOpen = false;
  late final ProductSearch _search = ProductSearch(api: apiOf(context));
  final _searchKey = GlobalKey();

  DocTotals? _totals;
  String? _problem;
  bool _pending = false;
  bool _saving = false;
  Timer? _debounce;
  int _gen = 0;

  bool get _dirty => _lines.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
    _search.focus.addListener(() {
      if (_search.focus.hasFocus && _searchKey.currentContext != null) {
        Scrollable.ensureVisible(_searchKey.currentContext!, duration: const Duration(milliseconds: 200), alignment: .02);
      }
    });
    _loadSalesmen();
  }

  Future<void> _loadSalesmen() async {
    try {
      final r = await AppScope.read(context).api.get('/api/app/parties/', {'kind': 'salesman'});
      if (mounted) setState(() => _salesmen = [for (final x in (r['rows'] as List? ?? const [])) Party.fromJson(x as Map<String, dynamic>)]);
    } on ApiException {
      // No salesmen list: the field stays at "—".
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    for (final c in [_name, _phone, _charges, _discount, _paid, _note]) {
      c.dispose();
    }
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  Map<String, Object?> _body({double? paid}) => {
        'id': _id,
        'lines': [
          for (final l in _lines)
            {
              'productId': l.p.id,
              'unit': l.loose ? 'loose' : 'pack',
              'qty': l.q,
              'bonus': numOf(l.bonus),
              if (l.disc.text.trim().isNotEmpty) 'discountPct': numOf(l.disc).clamp(0, 100),
            },
        ],
        if (_customer != null) 'customerId': _customer!.id,
        if (_customer == null && _name.text.trim().isNotEmpty) 'customerName': _name.text.trim(),
        if (_phone.text.trim().isNotEmpty) 'customerPhone': _phone.text.trim(),
        if (_salesman != null) 'salesmanId': _salesman!.id,
        'invOn': _credit ? 'credit' : 'cash',
        'charges': numOf(_charges),
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
    if (_lines.any((l) => l.q <= 0)) {
      setState(() => _problem = 'Every line needs a quantity greater than 0.');
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), _preview);
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

  /// From the search: one more of a product already on the invoice, else a new line (as the website).
  void _add(ProductRow p) {
    final have = _lines.where((l) => l.p.id == p.id).firstOrNull;
    if (have != null) {
      have.qty.text = qty(have.q + 1);
    } else {
      _lines.add(_SaleLine(p));
    }
    _search.clear();
    _search.focus.requestFocus();
    _changed();
  }

  double _inForm(String productId) => _lines.where((l) => l.p.id == productId).fold(0.0, (t, l) => t + l.q);

  void _setUnit(_SaleLine l, bool loose) {
    if (l.loose == loose) return;
    // Switching the unit converts the quantity (as the website's Pack | Tab toggle).
    final packs = l.loose ? l.q / l.p.packing : l.q;
    final next = loose ? packs * l.p.packing : packs / l.p.packing;
    l.loose = loose;
    l.qty.text = qty(double.parse(next.toStringAsFixed(3)));
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

  void _reset() {
    for (final l in _lines) {
      l.dispose();
    }
    setState(() {
      _id = newDocId();
      _lines.clear();
      _customer = null;
      _salesman = null;
      for (final c in [_name, _phone, _charges, _discount, _paid, _note]) {
        c.clear();
      }
      _credit = false;
      _buyerOpen = false;
      _totals = null;
      _problem = null;
    });
  }

  Future<void> _confirmReset() async {
    if (!_dirty || await confirmDiscard(context, 'invoice')) _reset();
  }

  Future<void> _save() async {
    if (_saving) return;
    if (_lines.isEmpty) {
      setState(() => _problem = 'Add at least one product line.');
      return;
    }
    if (_credit && _customer == null && _name.text.trim().isEmpty) {
      setState(() => _problem = 'A credit sale needs a customer.');
      return;
    }
    final phone = _phone.text.trim();
    if (phone.isNotEmpty && !RegExp(r'^(03\d{9}|\+923\d{9})$').hasMatch(phone.replaceAll(RegExp(r'[\s-]'), ''))) {
      setState(() => _problem = 'Mobile number must be like 03XXXXXXXXX or +923XXXXXXXXX.');
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

  /// The website's "Invoice #N saved" notice, with PDF and WhatsApp.
  Future<void> _savedSheet({required String id, required int? no, required double payable, required double balance}) async {
    final share = canShareInvoices(context);
    final nav = Navigator.of(context);
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 14),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(color: Color(0xFFD1FAE5), shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded, color: saleGreen, size: 28),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(no == null ? 'Invoice saved' : 'Invoice #$no saved', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  Text(balance > 0.004 ? 'Payable ${rs(payable)} · Balance ${rs(balance)}' : 'Payable ${rs(payable)} · Paid',
                      style: TextStyle(fontSize: 13, color: balance > 0.004 ? noStock : muted, fontWeight: FontWeight.w500)),
                ]),
              ),
            ]),
            const SizedBox(height: 18),
            if (share) ...[
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      shareInvoicePdf(context, invoiceId: id);
                    },
                    icon: const Icon(Icons.picture_as_pdf_outlined, size: 19),
                    label: const Text('PDF'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: GradientButton(
                    label: 'WhatsApp',
                    icon: Icons.chat_rounded,
                    colors: const [Color(0xFF16A34A), whatsappGreen],
                    onPressed: () {
                      Navigator.pop(ctx);
                      shareInvoice(context, invoiceId: id);
                    },
                  ),
                ),
              ]),
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
                child: GradientButton(
                  label: 'New invoice',
                  icon: Icons.add_rounded,
                  onPressed: () {
                    Navigator.pop(ctx);
                    _search.focus.requestFocus();
                  },
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
    final match = t != null && t.lines.length == _lines.length;
    final paidNow = t == null ? null : (_paid.text.trim().isNotEmpty ? numOf(_paid) : (_credit ? 0.0 : t.payable));
    final buyerSummary = [
      _customer?.name ?? (_name.text.trim().isEmpty ? 'Walk-in' : _name.text.trim()),
      if (_phone.text.trim().isNotEmpty) _phone.text.trim(),
    ].join(' · ');

    return Column(children: [
      Expanded(
        child: ListView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: [
            // Header: Inv On, Salesman, Customer Name.
            WebCard(
              child: Column(children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(
                    child: LabeledField(
                      label: 'Inv On',
                      required: true,
                      child: _Select<bool>(
                        value: _credit,
                        items: const {false: 'Cash', true: 'Credit'},
                        onChanged: (v) {
                          _credit = v;
                          _changed();
                        },
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: LabeledField(
                      label: 'Salesman (Optional)',
                      child: _Select<String>(
                        value: _salesman?.id ?? '',
                        items: {'': '—', for (final s in _salesmen) s.id: s.name},
                        onChanged: (v) => setState(() => _salesman = _salesmen.where((s) => s.id == v).firstOrNull),
                      ),
                    ),
                  ),
                ]),
                const SizedBox(height: 12),
                LabeledField(
                  label: 'Customer Name',
                  child: _PickerBox(
                    text: _customer?.name ?? 'Walk-in',
                    placeholder: _customer == null,
                    icon: Icons.person_search_outlined,
                    onTap: _pickCustomer,
                    onClear: _customer == null
                        ? null
                        : () {
                            _customer = null;
                            _name.clear();
                            _phone.clear();
                            _changed();
                          },
                  ),
                ),
              ]),
            ),
            const SizedBox(height: 10),
            // Customer & Buyer Details (folded to one line on phones, as the website).
            WebCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => setState(() => _buyerOpen = !_buyerOpen),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
                    child: Row(children: [
                      const Icon(Icons.badge_outlined, size: 19, color: muted),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          const Text('Customer & Buyer Details', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                          Text(buyerSummary, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: muted)),
                        ]),
                      ),
                      AnimatedRotation(turns: _buyerOpen ? .5 : 0, duration: const Duration(milliseconds: 150), child: const Icon(Icons.expand_more_rounded, color: muted)),
                    ]),
                  ),
                ),
                if (_buyerOpen)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                    child: Column(children: [
                      LabeledField(
                        label: 'Customer Name',
                        child: TextField(
                          controller: _name,
                          readOnly: _customer != null,
                          onChanged: (_) => _changed(),
                          textInputAction: TextInputAction.next,
                          decoration: const InputDecoration(hintText: 'Walk-in Customer'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      LabeledField(
                        label: 'Mobile Number',
                        child: TextField(
                          controller: _phone,
                          keyboardType: TextInputType.phone,
                          onChanged: (_) => _changed(),
                          decoration: const InputDecoration(hintText: '03XXXXXXXXX'),
                        ),
                      ),
                    ]),
                  ),
              ]),
            ),
            const SizedBox(height: 10),
            // Barcode/Product Name, with the matches right under it.
            WebCard(
              key: _searchKey,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                LabeledField(label: 'Barcode/Product Name', child: ProductSearchField(search: _search, onPick: _add)),
                if (_search.open) ...[
                  const SizedBox(height: 6),
                  ProductSearchDropdown(search: _search, onPick: _add, inForm: _inForm),
                ],
              ]),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Row(children: [
                const Text('Items', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700)),
                const SizedBox(width: 6),
                Text('${_lines.length}', style: const TextStyle(color: muted, fontWeight: FontWeight.w600)),
                const Spacer(),
                if (_pending) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
              ]),
            ),
            const SizedBox(height: 8),
            if (_lines.isEmpty)
              const WebCard(child: Padding(padding: EdgeInsets.symmetric(vertical: 14), child: Center(child: Text('No content in table', style: TextStyle(color: faint))))),
            for (var i = 0; i < _lines.length; i++) ...[
              _LineCard(
                key: _lines[i].key,
                line: _lines[i],
                info: match && i < t.details.length ? t.details[i] : null,
                total: match ? t.lines[i] : null,
                onChanged: _changed,
                onUnit: (loose) => _setUnit(_lines[i], loose),
                onRemove: () {
                  _lines.removeAt(i).dispose();
                  _changed();
                },
              ),
              const SizedBox(height: 10),
            ],
            const SizedBox(height: 4),
            // Totals, as the website's two rows.
            WebCard(
              child: Column(children: [
                Row(children: [
                  Expanded(child: LabeledField(label: 'Total', child: ReadOnlyBox(t == null ? '0.00' : money2(t.subtotal)))),
                  const SizedBox(width: 10),
                  Expanded(child: LabeledField(label: 'Charges', child: _Num(controller: _charges, onChanged: _changed))),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: LabeledField(label: 'Discount Rs', child: _Num(controller: _discount, onChanged: _changed))),
                  const SizedBox(width: 10),
                  Expanded(child: LabeledField(label: 'Tax', child: ReadOnlyBox(t == null ? '0.00' : money2(t.tax)))),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(child: LabeledField(label: 'Payable', child: ReadOnlyBox(t == null ? '0.00' : money2(t.payable), strong: true))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: LabeledField(
                      label: 'Paid',
                      required: true,
                      child: _Num(controller: _paid, onChanged: _changed, hint: _credit ? '0.00' : (t == null ? 'In full' : money2(t.payable))),
                    ),
                  ),
                ]),
                const SizedBox(height: 10),
                Row(children: [
                  Expanded(
                    child: LabeledField(
                      label: 'Balance',
                      child: ReadOnlyBox(t == null || paidNow == null ? '0.00' : money2(t.payable - paidNow), color: t != null && paidNow != null && t.payable - paidNow > 0.004 ? noStock : null),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: LabeledField(label: 'Description', child: TextField(controller: _note, decoration: const InputDecoration()))),
                ]),
              ]),
            ),
          ],
        ),
      ),
      WebActionBar(
        payable: t?.payable,
        problem: _problem,
        busy: _saving,
        onReset: _lines.isEmpty && _customer == null ? null : _confirmReset,
        onSave: _lines.isEmpty ? null : _save,
      ),
    ]);
  }
}

/// "1,234.50" (the website's totals show 2 decimals).
String money2(double v) => v.toStringAsFixed(2).replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))(?=.*\.)'), (_) => ',');

/// A line as the website's phone card: the product with Remove, the
/// Pack | Tab toggle, then LABEL: value cells.
class _LineCard extends StatelessWidget {
  const _LineCard({super.key, required this.line, required this.info, required this.total, required this.onChanged, required this.onUnit, required this.onRemove});
  final _SaleLine line;
  final LineInfo? info;
  final double? total;
  final VoidCallback onChanged;
  final ValueChanged<bool> onUnit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l = line;
    final i = info;
    final over = i?.avail != null && l.q > i!.avail! + 1e-9;
    return WebCard(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Expanded(child: Text(l.p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14.5))),
          TextButton(onPressed: onRemove, style: TextButton.styleFrom(foregroundColor: noStock, visualDensity: VisualDensity.compact), child: const Text('Remove')),
        ]),
        if (l.p.packing > 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 8, right: 6),
            child: Row(children: [
              const SizedBox(width: 52, child: SmallCaps('Unit')),
              _UnitToggle(pack: 'Pack', loose: l.looseName, isLoose: l.loose, onChanged: onUnit),
              const SizedBox(width: 8),
              Flexible(child: Text('${qty(l.p.packing)} per pack', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: faint))),
            ]),
          ),
        Padding(
          padding: const EdgeInsets.only(right: 6),
          child: Column(children: [
            Row(children: [
              Expanded(child: _Cell('Batch', Text(i?.batch ?? '—', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)))),
              Expanded(child: _Cell('Avail', Text(i?.avail == null ? '—' : qty(i!.avail!), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: over ? noStock : ink)))),
              Expanded(child: _Cell('Sale Price', Text(i?.price == null ? '—' : money2(i!.price!), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)))),
            ]),
            const SizedBox(height: 8),
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(child: _Cell('Qty', _MiniNum(controller: l.qty, onChanged: onChanged, error: over))),
              const SizedBox(width: 8),
              Expanded(child: _Cell('Bonus', _MiniNum(controller: l.bonus, onChanged: onChanged))),
              const SizedBox(width: 8),
              Expanded(child: _Cell('Disc %', _MiniNum(controller: l.disc, onChanged: onChanged, hint: i?.discountPct == null ? '' : qty(i!.discountPct!)))),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(child: _Cell('Tax %', Text(i?.taxPct == null ? '—' : qty(i!.taxPct!), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)))),
              const Spacer(),
              const SmallCaps('Total', color: muted),
              const SizedBox(width: 8),
              Text(total == null ? '…' : money2(total!), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            ]),
            if (over) const Padding(padding: EdgeInsets.only(top: 6), child: Text('More than the stock available.', style: TextStyle(fontSize: 12, color: noStock, fontWeight: FontWeight.w500))),
          ]),
        ),
      ]),
    );
  }
}

class _Cell extends StatelessWidget {
  const _Cell(this.label, this.child);
  final String label;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        SmallCaps(label),
        const SizedBox(height: 3),
        child,
      ]);
}

class _MiniNum extends StatelessWidget {
  const _MiniNum({required this.controller, required this.onChanged, this.hint, this.error = false});
  final TextEditingController controller;
  final VoidCallback onChanged;
  final String? hint;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final b = OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: error ? noStock : hairline));
    return SizedBox(
      height: 38,
      child: TextField(
        controller: controller,
        onChanged: (_) => onChanged(),
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: numberInput,
        textInputAction: TextInputAction.next,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        decoration: InputDecoration(hintText: hint, contentPadding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8), enabledBorder: b, border: b),
      ),
    );
  }
}

/// The website's Pack | Tab pill: the chosen side amber with white text.
class _UnitToggle extends StatelessWidget {
  const _UnitToggle({required this.pack, required this.loose, required this.isLoose, required this.onChanged});
  final String pack;
  final String loose;
  final bool isLoose;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget side(String t, bool v) => GestureDetector(
          onTap: () => onChanged(v),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(color: isLoose == v ? const Color(0xFFF59E0B) : Colors.transparent, borderRadius: BorderRadius.circular(20)),
            child: Text(t, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: isLoose == v ? Colors.white : muted)),
          ),
        );
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(color: const Color(0xFFF5F5F5), borderRadius: BorderRadius.circular(20), border: Border.all(color: hairline)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [side(pack, false), side(loose, true)]),
    );
  }
}

class _Num extends StatelessWidget {
  const _Num({required this.controller, required this.onChanged, this.hint});
  final TextEditingController controller;
  final VoidCallback onChanged;
  final String? hint;
  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        onChanged: (_) => onChanged(),
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: numberInput,
        textInputAction: TextInputAction.next,
        decoration: InputDecoration(hintText: hint ?? '0.00'),
      );
}

/// A select box like the website's.
class _Select<T> extends StatelessWidget {
  const _Select({required this.value, required this.items, required this.onChanged});
  final T value;
  final Map<T, String> items;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<T>(
      initialValue: items.containsKey(value) ? value : items.keys.first,
      isExpanded: true,
      icon: const Icon(Icons.expand_more_rounded, size: 20),
      borderRadius: BorderRadius.circular(12),
      dropdownColor: Colors.white,
      style: const TextStyle(fontSize: 14, color: ink),
      items: [for (final e in items.entries) DropdownMenuItem(value: e.key, child: Text(e.value, overflow: TextOverflow.ellipsis))],
      onChanged: (v) => v == null ? null : onChanged(v),
    );
  }
}

/// A box that opens a picker (Customer Name).
class _PickerBox extends StatelessWidget {
  const _PickerBox({required this.text, required this.placeholder, required this.icon, required this.onTap, this.onClear});
  final String text;
  final bool placeholder;
  final IconData icon;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        height: 44,
        padding: const EdgeInsets.only(left: 12, right: 4),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8), border: Border.all(color: hairline)),
        child: Row(children: [
          Expanded(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: placeholder ? muted : ink, fontWeight: placeholder ? null : FontWeight.w600))),
          if (onClear != null) IconButton(tooltip: 'Walk-in', visualDensity: VisualDensity.compact, onPressed: onClear, icon: const Icon(Icons.close_rounded, size: 18)),
          Padding(padding: const EdgeInsets.only(right: 8), child: Icon(icon, size: 20, color: mavinAccent)),
        ]),
      ),
    );
  }
}

/// The website's phone action bar: "Payable · Rs X", Reset and Save.
class WebActionBar extends StatelessWidget {
  const WebActionBar({super.key, required this.payable, required this.problem, required this.busy, required this.onReset, required this.onSave, this.onProblem});
  final double? payable;
  final String? problem;
  final VoidCallback? onProblem;
  final bool busy;
  final VoidCallback? onReset;
  final VoidCallback? onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: Colors.white, boxShadow: [BoxShadow(color: Color(0x14000000), blurRadius: 10, offset: Offset(0, -2))]),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 12, 10),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (problem != null)
              InkWell(
                onTap: onProblem,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(problem!, style: const TextStyle(color: noStock, fontSize: 13, fontWeight: FontWeight.w500)),
                ),
              ),
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  const Text('Payable', style: TextStyle(fontSize: 11.5, color: muted, fontWeight: FontWeight.w500)),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text('Rs ${money2(payable ?? 0)}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: -.3)),
                  ),
                ]),
              ),
              OutlinedButton(onPressed: onReset, child: const Text('Reset')),
              const SizedBox(width: 8),
              GradientButton(label: busy ? 'Saving...' : 'Save', icon: Icons.check_rounded, busy: busy, onPressed: onSave),
            ]),
          ]),
        ),
      ),
    );
  }
}
