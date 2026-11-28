import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../main.dart';
import 'theme.dart';

/// Shared catalogue prices, as on the website: after a purchase that changed a
/// shared product's retail price the app asks whether the retail price itself
/// changed, and Home lists the week's price rises and the changes MAVIN.pk
/// approved. The server (src/server/catalogPrices.ts) decides everything.
const String catalogPricesPath = '/api/catalog/prices/';

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

/// A changed retail price to ask about.
class PriceQuestion {
  PriceQuestion({required this.productId, required this.name, required this.oldPrice, required this.newPrice, required this.up});
  final String productId;
  final String name;
  final double oldPrice;
  final double newPrice;
  final bool up;

  static List<PriceQuestion> list(Object? json) => [
        if (json is List)
          for (final j in json.whereType<Map>())
            PriceQuestion(productId: '${j['productId']}', name: '${j['name']}', oldPrice: _num(j['oldPrice']), newPrice: _num(j['newPrice']), up: j['direction'] != 'down'),
      ];
}

/// One entry of Home's price changes.
class PriceNotice {
  PriceNotice({required this.id, required this.kind, required this.name, required this.myPrice, required this.newPrice, this.confirmations = 0, this.oldPacking, this.newPacking});
  final String id;

  /// increase (other businesses report it), decrease or packing (approved).
  final String kind;
  final String name;
  final double myPrice;

  /// The price Yes / Apply would set; 0 when there is nothing to apply.
  final double newPrice;
  final int confirmations;
  final double? oldPacking;
  final double? newPacking;

  String get detail {
    if (kind == 'increase') {
      return confirmations > 0 ? 'Price increased? Confirmed by $confirmations other business${confirmations == 1 ? '' : 'es'}' : 'Price increased? Reported by one business';
    }
    if (kind == 'packing') return 'Pack size changed ${qty(oldPacking ?? 0)} → ${qty(newPacking ?? 0)}. Your stock was converted (same number of units).';
    return 'Retail price reduced (approved by MAVIN.pk)';
  }

  static List<PriceNotice> list(Object? json) => [
        if (json is List)
          for (final j in json.whereType<Map>())
            PriceNotice(
              id: '${j['id']}', kind: '${j['kind']}', name: '${j['name']}', myPrice: _num(j['myPrice']), newPrice: _num(j['newPrice']),
              confirmations: _num(j['confirmations']).toInt(),
              oldPacking: j['oldPacking'] == null ? null : _num(j['oldPacking']), newPacking: j['newPacking'] == null ? null : _num(j['newPacking']),
            ),
      ];
}

/// "Has the retail price changed?" The purchase is already saved either way.
Future<void> askPriceQuestions(BuildContext context, List<PriceQuestion> questions) async {
  if (questions.isEmpty) return;
  final api = AppScope.read(context).api;
  final messenger = ScaffoldMessenger.of(context);
  final chosen = await showDialog<List<PriceQuestion>>(context: context, builder: (_) => _PriceQuestionDialog(questions));
  if (chosen == null || chosen.isEmpty) return;
  try {
    await api.post(catalogPricesPath, {
      'action': 'propose',
      'items': [for (final q in chosen) {'productId': q.productId, 'price': q.newPrice, 'previousPrice': q.oldPrice}],
    });
  } on ApiException catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('The purchase is saved, but the price change was not shared: ${e.message}'), behavior: SnackBarBehavior.floating));
  }
}

class _PriceQuestionDialog extends StatefulWidget {
  const _PriceQuestionDialog(this.questions);
  final List<PriceQuestion> questions;

  @override
  State<_PriceQuestionDialog> createState() => _PriceQuestionDialogState();
}

class _PriceQuestionDialogState extends State<_PriceQuestionDialog> {
  late final Set<String> _on = {for (final q in widget.questions) q.productId};

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Has the retail price changed?'),
      scrollable: true,
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('If the company changed the retail price, tick the products and choose Yes. If it is only your own selling price, choose No.'),
        const SizedBox(height: 8),
        for (final q in widget.questions)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
            value: _on.contains(q.productId),
            onChanged: (v) => setState(() => v == true ? _on.add(q.productId) : _on.remove(q.productId)),
            title: Text(q.name),
            subtitle: Text('${rs(q.oldPrice)} → ${rs(q.newPrice)}', style: TextStyle(color: q.up ? noStock : mavinGreen, fontWeight: FontWeight.w600)),
          ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('No, only my price')),
        FilledButton(
          onPressed: _on.isEmpty ? null : () => Navigator.pop(context, [for (final q in widget.questions) if (_on.contains(q.productId)) q]),
          child: const Text('Yes, it changed'),
        ),
      ],
    );
  }
}

/// Home's "Price changes" card: shown only while there is something to answer.
/// [reload] changes when Home is refreshed.
class PriceChangesCard extends StatefulWidget {
  const PriceChangesCard({super.key, required this.reload});
  final int reload;

  @override
  State<PriceChangesCard> createState() => _PriceChangesCardState();
}

class _PriceChangesCardState extends State<PriceChangesCard> {
  List<PriceNotice> _list = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(PriceChangesCard old) {
    super.didUpdateWidget(old);
    if (old.reload != widget.reload) _load();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.post(catalogPricesPath, {'action': 'notices'});
      if (mounted) setState(() => _list = PriceNotice.list(r['result']));
    } on ApiException {
      // Home carries on without it.
    }
  }

  Future<void> _open() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => PriceChangesPage(notices: _list)));
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: const Icon(Icons.trending_up_rounded, color: noStock),
          title: Text('Price changes (${_list.length})', style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: const Text('Retail price and pack size changes to look at'),
          trailing: const Icon(Icons.chevron_right_rounded),
          onTap: _open,
        ),
      ),
    );
  }
}

/// The list: Yes / Apply changes this business's own retail price; No keeps it.
class PriceChangesPage extends StatefulWidget {
  const PriceChangesPage({super.key, required this.notices});
  final List<PriceNotice> notices;

  @override
  State<PriceChangesPage> createState() => _PriceChangesPageState();
}

class _PriceChangesPageState extends State<PriceChangesPage> {
  late final List<PriceNotice> _list = [...widget.notices];
  String? _busy;

  Future<void> _answer(PriceNotice n, bool yes) async {
    setState(() => _busy = n.id);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AppScope.read(context).api.post(catalogPricesPath, {'action': 'answer', 'id': n.id, 'answer': yes ? 'yes' : 'no'});
      if (!mounted) return;
      setState(() => _list.remove(n));
      if (yes && n.newPrice > 0) messenger.showSnackBar(SnackBar(content: Text('${n.name}: your retail price is now ${rs(n.newPrice)}.'), behavior: SnackBarBehavior.floating));
      if (_list.isEmpty) Navigator.pop(context);
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message), behavior: SnackBarBehavior.floating));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Price changes')),
      body: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: _list.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (_, i) {
          final n = _list[i];
          final busy = _busy != null;
          return Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(n.name, style: const TextStyle(fontWeight: FontWeight.w600, color: ink)),
                const SizedBox(height: 4),
                Text(n.detail),
                if (n.newPrice > 0) ...[
                  const SizedBox(height: 6),
                  Text(n.myPrice > 0 ? '${rs(n.myPrice)} → ${rs(n.newPrice)}' : rs(n.newPrice),
                      style: TextStyle(fontWeight: FontWeight.w700, color: n.newPrice > n.myPrice ? noStock : mavinGreen)),
                ],
                const SizedBox(height: 8),
                Wrap(spacing: 8, children: [
                  if (n.newPrice > 0) ...[
                    FilledButton(onPressed: busy ? null : () => _answer(n, true), child: Text(n.kind == 'increase' ? 'Yes' : 'Apply')),
                    OutlinedButton(onPressed: busy ? null : () => _answer(n, false), child: Text(n.kind == 'increase' ? 'No' : 'Keep mine')),
                  ] else
                    OutlinedButton(onPressed: busy ? null : () => _answer(n, false), child: const Text('OK')),
                ]),
              ]),
            ),
          );
        },
      ),
    );
  }
}
