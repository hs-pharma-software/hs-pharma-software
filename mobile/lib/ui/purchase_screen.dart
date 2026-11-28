import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/doc_id.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../main.dart';
import 'catalog_prices.dart';
import 'form_bits.dart';
import 'invoice_screen.dart' show WebActionBar, money2;
import 'pickers.dart';
import 'product_search.dart';
import 'theme.dart';

class _PurLine {
  _PurLine(this.p, {double? rate, double? sale}) {
    this.rate.text = rate == null || rate == 0 ? '' : qty(rate);
    this.sale.text = sale == null || sale == 0 ? '' : qty(sale);
  }
  final ProductRow p;
  final qtyC = TextEditingController();
  final bonus = TextEditingController();
  final rate = TextEditingController();
  final sale = TextEditingController();
  final batch = TextEditingController();
  final expiry = TextEditingController();
  final st = TextEditingController();
  final wt = TextEditingController();
  final disc = TextEditingController();

  List<TextEditingController> get all => [qtyC, bonus, rate, sale, batch, expiry, st, wt, disc];
  void dispose() {
    for (final c in all) {
      c.dispose();
    }
  }

  /// What stops this line from being saved (field -> message), the web form's rules.
  Map<String, String> problems() {
    final e = <String, String>{};
    if (numOf(qtyC) <= 0 && numOf(bonus) <= 0) e['qty'] = 'Enter the quantity';
    if (numOf(disc) > 100) e['disc'] = 'At most 100%';
    final x = expiry.text.trim();
    if (x.isNotEmpty && (DateTime.tryParse(x) == null || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(x))) e['expiry'] = 'Use YYYY-MM-DD';
    return e;
  }
}

/// New Purchase: supplier, then products. Each product is a row that opens
/// to its fields (quantity, bonus, rates, batch, expiry, S.T, W.T); choosing
/// the next product closes the previous row and keeps its values. Totals come
/// from MAVIN.pk, worked out as the save will.
class PurchaseScreen extends StatefulWidget {
  const PurchaseScreen({super.key});

  @override
  State<PurchaseScreen> createState() => PurchaseScreenState();
}

class PurchaseScreenState extends State<PurchaseScreen> with BackGuard {
  String _id = newDocId();
  Party? _supplier;
  final _supplierInv = TextEditingController();
  final _discount = TextEditingController();
  final _paid = TextEditingController();
  final _note = TextEditingController();
  bool _bank = false;
  final List<_PurLine> _lines = [];
  int _open = -1;
  bool _showErrors = false;

  DocTotals? _totals;
  String? _problem;
  bool _pending = false;
  bool _saving = false;
  Timer? _debounce;
  int _gen = 0;
  final _scroll = ScrollController();
  late final ProductSearch _search = ProductSearch(api: apiOf(context), sale: false);

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    for (final c in [_supplierInv, _discount, _paid, _note]) {
      c.dispose();
    }
    for (final l in _lines) {
      l.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  bool get _dirty => _lines.isNotEmpty || _supplier != null;
  bool get _linesValid => _lines.every((l) => l.problems().isEmpty);

  Map<String, Object?> _body({double? paid}) => {
        'id': _id,
        'supplierId': _supplier?.id ?? '',
        if (_supplierInv.text.trim().isNotEmpty) 'supplierInvoiceNo': _supplierInv.text.trim(),
        'paymentMethod': _bank ? 'Bank' : 'Cash',
        'discountRs': numOf(_discount),
        'paid': paid ?? numOf(_paid),
        if (_note.text.trim().isNotEmpty) 'description': _note.text.trim(),
        'lines': [
          for (final l in _lines)
            {
              'productId': l.p.id,
              'qty': numOf(l.qtyC),
              'bonus': numOf(l.bonus),
              'purchasePrice': numOf(l.rate),
              if (l.sale.text.trim().isNotEmpty) 'salePrice': numOf(l.sale),
              if (l.batch.text.trim().isNotEmpty) 'batchNo': l.batch.text.trim(),
              if (l.expiry.text.trim().isNotEmpty) 'expiryDate': l.expiry.text.trim(),
              'stPct': numOf(l.st),
              'whtPct': numOf(l.wt),
              'discPct': numOf(l.disc),
            },
        ],
      };

  void _changed() {
    setState(() {});
    _debounce?.cancel();
    if (_lines.isEmpty || _supplier == null || !_linesValid) return;
    _debounce = Timer(const Duration(milliseconds: 450), _preview);
  }

  Future<DocTotals?> _preview() async {
    if (_lines.isEmpty || _supplier == null || !_linesValid) return null;
    final gen = ++_gen;
    setState(() => _pending = true);
    try {
      final t = DocTotals.fromJson(await AppScope.read(context).api.post('/api/app/purchase/?preview=1', _body()));
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

  Future<void> _pickSupplier() async {
    final s = await Navigator.push<Party>(context, MaterialPageRoute(builder: (_) => const PartyPicker(kind: 'supplier')));
    if (s == null) return;
    _supplier = s;
    _changed();
  }

  /// From the search: a new row, opened for its quantity and rates (the previous row closes).
  Future<void> _addProduct(ProductRow p) async {
    _search.clear();
    FocusScope.of(context).unfocus();
    // Rates to start from: the latest batch's purchase price (when this login may see it) and the sale price.
    double? rate;
    try {
      final d = ProductDetail.fromJson(await AppScope.read(context).api.get('/api/app/products/', {'id': p.id}));
      final withPrice = d.batches.where((b) => b.purchasePrice != null).toList();
      if (withPrice.isNotEmpty) rate = withPrice.last.purchasePrice;
    } on ApiException {
      // Typed by hand.
    }
    setState(() {
      _lines.add(_PurLine(p, rate: rate, sale: p.salePrice));
      // The new row opens; the previous one closes and keeps its values.
      _open = _lines.length - 1;
    });
    _changed();
  }

  Future<void> _pickExpiry(_PurLine l) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(l.expiry.text) ?? DateTime(now.year + 2, now.month),
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 15),
      helpText: 'Expiry date',
    );
    if (d == null) return;
    l.expiry.text = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    _changed();
  }

  void _reset() {
    for (final l in _lines) {
      l.dispose();
    }
    setState(() {
      _id = newDocId();
      _supplier = null;
      for (final c in [_supplierInv, _discount, _paid, _note]) {
        c.clear();
      }
      _bank = false;
      _lines.clear();
      _open = -1;
      _showErrors = false;
      _totals = null;
      _problem = null;
    });
  }

  void _showFirstProblem() {
    final i = _lines.indexWhere((l) => l.problems().isNotEmpty);
    if (i >= 0) setState(() => _open = i);
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _showErrors = true);
    if (_supplier == null) {
      setState(() => _problem = 'Choose the supplier.');
      return;
    }
    if (_lines.isEmpty) {
      setState(() => _problem = 'Add at least one product.');
      return;
    }
    final bad = _lines.where((l) => l.problems().isNotEmpty).length;
    if (bad > 0) {
      setState(() => _problem = '$bad product${bad > 1 ? 's need' : ' needs'} details. Tap to show.');
      _showFirstProblem();
      return;
    }
    setState(() => _saving = true);
    try {
      final t = await _preview();
      if (t == null) return;
      final paid = _paid.text.trim().isNotEmpty ? numOf(_paid) : 0.0;
      Map<String, dynamic>? r;
      while (r == null) {
        try {
          if (!mounted) return;
          r = await AppScope.read(context).api.post('/api/app/purchase/', _body(paid: paid));
        } on ApiException catch (e) {
          if (!e.offline || !mounted || !await askRetryUnknown(context, e, 'purchase')) {
            if (!e.offline && mounted) setState(() => _problem = e.message);
            return;
          }
        }
      }
      if (!mounted) return;
      final no = r['purchaseNo'];
      final questions = PriceQuestion.list(r['priceQuestions']);
      _reset();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Purchase #$no saved · ${rs((r['payable'] as num?) ?? 0)}'), behavior: SnackBarBehavior.floating));
      await askPriceQuestions(context, questions);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Future<bool> handleBack() async {
    if (_search.open) {
      _search.clear();
      return true;
    }
    if (_open >= 0) {
      setState(() => _open = -1);
      return true;
    }
    if (!_dirty) return false;
    if (await confirmDiscard(context, 'purchase')) {
      _reset();
      return false;
    }
    return true;
  }

  Widget _row(int i) {
    final l = _lines[i];
    final open = i == _open;
    final probs = l.problems();
    final t = _totals;
    final total = t != null && t.lines.length == _lines.length ? t.lines[i] : null;
    String? err(String k) => (_showErrors || k != 'qty') ? probs[k] : null;
    final header = InkWell(
      onTap: () => setState(() => _open = open ? -1 : i),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
          child: Row(children: [
            Expanded(child: Text(l.p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w500))),
            if (!open && probs.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: const Color(0xFFFDECEC), borderRadius: BorderRadius.circular(10)),
                child: Text('${probs.length} to fix', style: const TextStyle(fontSize: 11.5, color: noStock, fontWeight: FontWeight.w500)),
              ),
            const SizedBox(width: 8),
            Text(total == null ? '…' : rs(total), style: const TextStyle(fontWeight: FontWeight.w500)),
            AnimatedRotation(turns: open ? .5 : 0, duration: const Duration(milliseconds: 150), child: const Icon(Icons.expand_more_rounded)),
          ]),
        ),
      ),
    );
    Widget numF(String label, TextEditingController c, {String? error}) => LabeledField(
          label: label,
          child: TextField(
            controller: c,
            onChanged: (_) => _changed(),
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: numberInput,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(errorText: error, errorMaxLines: 2),
          ),
        );
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: open ? mavinAccent : const Color(0x0A000000), width: open ? 1.5 : 1),
          boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 4, offset: Offset(0, 1))],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(children: [
          header,
          if (open)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 2, 14, 10),
              child: Column(children: [
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: LabeledField(label: 'Batch', child: TextField(controller: l.batch, textInputAction: TextInputAction.next, onChanged: (_) => _changed()))),
                  const SizedBox(width: 10),
                  Expanded(
                    child: LabeledField(
                      label: 'Expiry',
                      child: TextField(
                        controller: l.expiry,
                        keyboardType: TextInputType.datetime,
                        onChanged: (_) => _changed(),
                        decoration: InputDecoration(
                          hintText: 'YYYY-MM-DD',
                          errorText: err('expiry'),
                          suffixIcon: IconButton(tooltip: 'Choose a date', icon: const Icon(Icons.calendar_month_outlined, size: 19), onPressed: () => _pickExpiry(l)),
                        ),
                      ),
                    ),
                  ),
                ]),
                const SizedBox(height: 10),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: numF('Purchase Rate', l.rate)),
                  const SizedBox(width: 10),
                  Expanded(child: numF('Sale Rate', l.sale)),
                ]),
                const SizedBox(height: 10),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: numF('Quantity', l.qtyC, error: err('qty'))),
                  const SizedBox(width: 10),
                  Expanded(child: numF('Bonus', l.bonus)),
                ]),
                const SizedBox(height: 10),
                Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Expanded(child: numF('S.T %', l.st)),
                  const SizedBox(width: 10),
                  Expanded(child: numF('W.T %', l.wt)),
                  const SizedBox(width: 10),
                  Expanded(child: numF('Extra Disc %', l.disc, error: err('disc'))),
                ]),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () {
                      setState(() {
                        _lines.removeAt(i).dispose();
                        _open = -1;
                      });
                      _changed();
                    },
                    style: TextButton.styleFrom(foregroundColor: noStock),
                    child: const Text('Remove'),
                  ),
                ),
              ]),
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = _totals;
    final paid = _paid.text.trim().isNotEmpty ? numOf(_paid) : 0.0;
    final form = ListView(
        controller: _scroll,
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
        children: [
          WebCard(
            child: Column(children: [
              LabeledField(
                label: 'Supplier Name',
                required: true,
                child: InkWell(
                  onTap: _pickSupplier,
                  borderRadius: BorderRadius.circular(8),
                  child: Container(
                    height: 44,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: _showErrors && _supplier == null ? noStock : hairline),
                    ),
                    child: Row(children: [
                      Expanded(
                        child: Text(_supplier?.name ?? 'Select...',
                            maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: _supplier == null ? muted : ink, fontWeight: _supplier == null ? null : FontWeight.w600)),
                      ),
                      const Icon(Icons.expand_more_rounded, color: muted),
                    ]),
                  ),
                ),
              ),
              if (_showErrors && _supplier == null) const Align(alignment: Alignment.centerLeft, child: Padding(padding: EdgeInsets.only(top: 4, left: 2), child: Text('Choose the supplier', style: TextStyle(color: noStock, fontSize: 12)))),
              const SizedBox(height: 10),
              LabeledField(label: 'Invoice #', child: TextField(controller: _supplierInv)),
            ]),
          ),
          const SizedBox(height: 10),
          WebCard(
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              LabeledField(label: 'Barcode/Product Name', child: ProductSearchField(search: _search, onPick: _addProduct)),
              if (_search.open) ...[
                const SizedBox(height: 6),
                ProductSearchDropdown(search: _search, onPick: _addProduct),
              ],
            ]),
          ),
          const SizedBox(height: 14),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
            child: Row(children: [
              const Text('Products', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700)),
              const SizedBox(width: 6),
              Text('${_lines.length}', style: const TextStyle(color: muted, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (_pending) const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
            ]),
          ),
          for (var i = 0; i < _lines.length; i++) _row(i),
          if (_lines.isEmpty) const WebCard(child: Padding(padding: EdgeInsets.symmetric(vertical: 14), child: Center(child: Text('No content in table', style: TextStyle(color: faint))))),
          const SizedBox(height: 4),
          WebCard(
            child: Column(children: [
              Row(children: [
                Expanded(child: LabeledField(label: 'Discount Rs', child: TextField(controller: _discount, onChanged: (_) => _changed(), keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: numberInput, decoration: const InputDecoration(hintText: '0.00')))),
                const SizedBox(width: 10),
                Expanded(child: LabeledField(label: 'Tax', child: ReadOnlyBox(t == null ? '0.00' : money2(t.tax)))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: LabeledField(label: 'Payable', child: ReadOnlyBox(t == null ? '0.00' : money2(t.payable), strong: true))),
                const SizedBox(width: 10),
                Expanded(child: LabeledField(label: 'Paid', required: true, child: TextField(controller: _paid, onChanged: (_) => setState(() {}), keyboardType: const TextInputType.numberWithOptions(decimal: true), inputFormatters: numberInput, decoration: const InputDecoration(hintText: '0.00')))),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: LabeledField(label: 'Balance', child: ReadOnlyBox(t == null ? '0.00' : money2(t.payable - paid), color: t != null && t.payable - paid > 0.004 ? noStock : null))),
                const SizedBox(width: 10),
                Expanded(
                  child: LabeledField(
                    label: 'Payment Method',
                    required: true,
                    child: DropdownButtonFormField<bool>(
                      initialValue: _bank,
                      isExpanded: true,
                      icon: const Icon(Icons.expand_more_rounded, size: 20),
                      borderRadius: BorderRadius.circular(12),
                      dropdownColor: Colors.white,
                      items: const [DropdownMenuItem(value: false, child: Text('Cash')), DropdownMenuItem(value: true, child: Text('Bank'))],
                      onChanged: (v) => setState(() => _bank = v ?? false),
                    ),
                  ),
                ),
              ]),
              const SizedBox(height: 10),
              LabeledField(label: 'Description', child: TextField(controller: _note)),
            ]),
          ),
        ]);
    return Column(children: [
      Expanded(child: form),
      WebActionBar(
        payable: t?.payable,
        problem: _problem,
        onProblem: _showFirstProblem,
        busy: _saving,
        onReset: _dirty
            ? () async {
                if (await confirmDiscard(context, 'purchase')) _reset();
              }
            : null,
        onSave: _save,
      ),
    ]);
  }
}
