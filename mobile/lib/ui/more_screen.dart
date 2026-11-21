import 'package:material_ui/material_ui.dart';

import '../core/models.dart';
import '../main.dart';
import 'shell.dart' show openNewInvoice, openNewPurchase, AccountPanel;
import 'theme.dart';
import 'web_section.dart';

/// More: the website's navigation menu (the navy sidebar it opens on phones),
/// with this login's sections in the website's order. Sections the app shows
/// itself are on the bottom tabs; the rest open the web screen in the app.
class MoreScreen extends StatefulWidget {
  const MoreScreen({super.key, required this.tabbed});

  /// Tab ids already on the bottom bar.
  final Set<String> tabbed;

  @override
  State<MoreScreen> createState() => _MoreScreenState();
}

class _MoreScreenState extends State<MoreScreen> {
  String? _open;

  static const _tabKeys = {'home': 'dashboard', 'sale': null, 'reports': 'reports'};

  static const _icons = <String, IconData>{
    'dashboard': Icons.space_dashboard_outlined,
    'invoices': Icons.description_outlined,
    'quotation': Icons.request_quote_outlined,
    'order': Icons.assignment_outlined,
    'purchase': Icons.shopping_cart_outlined,
    'products': Icons.inventory_2_outlined,
    'stock': Icons.warehouse_outlined,
    'customers': Icons.groups_outlined,
    'suppliers': Icons.local_shipping_outlined,
    'staff': Icons.badge_outlined,
    'cash_register': Icons.point_of_sale_outlined,
    'banks': Icons.account_balance_outlined,
    'expenses': Icons.payments_outlined,
    'other_revenue': Icons.savings_outlined,
    'tasks': Icons.task_alt_outlined,
    'salesman': Icons.person_pin_outlined,
    'reports': Icons.bar_chart_rounded,
    'utilities': Icons.build_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final b = AppScope.of(context).boot!;
    final hidden = {for (final t in widget.tabbed) _tabKeys[t]}..remove(null);
    final sections = b.sections.where((s) => !hidden.contains(s.key)).toList();
    void open(String title, String path) => Navigator.push(context, MaterialPageRoute(builder: (_) => WebSectionPage(title: title, path: path)));

    return Container(
      decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [mavinNavyDeep, mavinNavy])),
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        // The login (the website's profile panel opens from here too).
        InkWell(
          onTap: () => showModalBottomSheet<void>(context: context, builder: (_) => SafeArea(child: AccountPanel(boot: b))),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
            child: Row(children: [
              CircleAvatar(radius: 20, backgroundColor: mavinAccent, child: Text(b.userName.isEmpty ? '?' : b.userName.trim()[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(b.userName.isEmpty ? 'Signed in' : b.userName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 15)),
                  Text('${b.businessName} · ${b.businessTypeLabel}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Color(0xB3FFFFFF), fontSize: 12)),
                ]),
              ),
              const Icon(Icons.chevron_right_rounded, color: Color(0x99FFFFFF)),
            ]),
          ),
        ),
        if (b.section('invoices') != null || b.section('purchase') != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Row(children: [
              if (b.section('invoices') != null)
                Expanded(child: GradientButton(label: 'Invoice', icon: Icons.add_rounded, colors: const [saleGreen, mavinGreen], onPressed: () => openNewInvoice(context))),
              if (b.section('invoices') != null && b.section('purchase') != null) const SizedBox(width: 10),
              if (b.section('purchase') != null)
                Expanded(child: GradientButton(label: 'Purchase', icon: Icons.add_rounded, colors: const [purchaseBlue, Color(0xFF3B82F6)], onPressed: () => openNewPurchase(context))),
            ]),
          ),
        const Padding(padding: EdgeInsets.fromLTRB(16, 6, 16, 6), child: SmallCaps('Navigation', color: Color(0x80FFFFFF))),
        for (final s in sections) ..._section(s, open),
        if (sections.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No other sections for this login.', style: TextStyle(color: Colors.white70))),
      ]),
    );
  }

  List<Widget> _section(Section s, void Function(String, String) open) {
    final hasChildren = s.children.length > 1;
    final isOpen = _open == s.key;
    return [
      Material(
        color: isOpen ? const Color(0x1AFFFFFF) : Colors.transparent,
        child: InkWell(
          onTap: () => hasChildren ? setState(() => _open = isOpen ? null : s.key) : open(s.label, s.children.length == 1 ? s.children.first.path : s.path),
          child: Container(
            decoration: BoxDecoration(
              border: Border(
                left: BorderSide(color: isOpen ? mavinAccent : Colors.transparent, width: 3),
                bottom: const BorderSide(color: Color(0x0DFFFFFF)),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(13, 13, 14, 13),
            child: Row(children: [
              Icon(_icons[s.key] ?? Icons.folder_outlined, size: 19, color: isOpen ? const Color(0xFF64B5F6) : const Color(0xFFE5E5E5)),
              const SizedBox(width: 14),
              Expanded(child: Text(s.label, style: TextStyle(color: isOpen ? const Color(0xFF64B5F6) : const Color(0xFFE5E5E5), fontSize: 14.5, fontWeight: FontWeight.w500))),
              AnimatedRotation(
                turns: isOpen ? .25 : 0,
                duration: const Duration(milliseconds: 150),
                child: const Icon(Icons.chevron_right_rounded, size: 18, color: Color(0x80FFFFFF)),
              ),
            ]),
          ),
        ),
      ),
      if (hasChildren && isOpen)
        Container(
          color: const Color(0x4D000000),
          child: Column(children: [
            for (final c in s.children)
              InkWell(
                onTap: () => open(c.label, c.path),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(46, 12, 16, 12),
                  child: Text(c.label, style: const TextStyle(color: Color(0xFFD4D4D4), fontSize: 13.5)),
                ),
              ),
          ]),
        ),
    ];
  }
}
