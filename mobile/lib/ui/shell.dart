import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../core/models.dart';
import '../main.dart';
import 'form_bits.dart';
import 'home_screen.dart';
import 'invoice_screen.dart';
import 'more_screen.dart';
import 'products_screen.dart';
import 'purchase_screen.dart';

/// One bottom tab (a side rail on tablets), shown only when the login has its section.
class _Tab {
  _Tab(this.id, this.label, this.icon, this.selectedIcon, this.build, {this.guard, String? short}) : short = short ?? label;
  final String id;
  final String label;

  /// On the bottom bar / rail (one line on a narrow phone).
  final String short;
  final IconData icon;
  final IconData selectedIcon;
  final Widget Function() build;
  /// The screen that may keep Back (an unsaved form).
  final GlobalKey<State>? guard;
}

/// Option A: navy top bar with the business and branch under the title,
/// bottom navigation on phones and a navigation rail from 600 dp.
class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;
  final Map<String, Widget> _built = {};

  List<_Tab> _tabs(Bootstrap b) {
    final tabs = <_Tab>[];
    if (b.section('dashboard') != null) {
      tabs.add(_Tab('home', 'Home', Icons.home_outlined, Icons.home_rounded, () => HomeScreen(onNewInvoice: () => _go('sell'))));
    }
    if (b.section('invoices') != null) {
      final k = GlobalKey<InvoiceScreenState>();
      tabs.add(_Tab('sell', 'New invoice', Icons.point_of_sale_outlined, Icons.point_of_sale_rounded, () => InvoiceScreen(key: k), guard: k, short: 'Invoice'));
    }
    if (b.section('stock') != null || b.section('products') != null) {
      tabs.add(_Tab('products', 'Products', Icons.inventory_2_outlined, Icons.inventory_2_rounded, () => const ProductsScreen()));
    }
    if (b.section('purchase') != null) {
      final k = GlobalKey<PurchaseScreenState>();
      tabs.add(_Tab('purchase', 'New purchase', Icons.local_shipping_outlined, Icons.local_shipping_rounded, () => PurchaseScreen(key: k), guard: k, short: 'Purchase'));
    }
    tabs.add(_Tab('more', 'More', Icons.menu_rounded, Icons.menu_open_rounded, () => MoreScreen(tabbed: {for (final t in tabs) t.id})));
    return tabs;
  }

  List<_Tab>? _cachedTabs;
  Bootstrap? _cachedFor;

  void _go(String id) {
    final i = _cachedTabs?.indexWhere((t) => t.id == id) ?? -1;
    if (i >= 0) setState(() => _index = i);
  }

  Future<void> _pickBranch(Bootstrap b) async {
    final state = AppScope.read(context);
    final id = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('Branch', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500))),
          for (final br in b.branches)
            ListTile(
              title: Text(br.name),
              subtitle: br.status == 'active' ? null : Text(br.status == 'inactive' ? 'Inactive: view only' : 'Archived: view only'),
              trailing: br.id == b.activeBranch ? const Icon(Icons.check_rounded) : null,
              onTap: () => Navigator.pop(ctx, br.id),
            ),
        ]),
      ),
    );
    if (id != null && id != b.activeBranch) {
      _built.clear();
      await state.switchBranch(id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final b = state.boot!;
    if (!identical(b, _cachedFor)) {
      _cachedFor = b;
      _cachedTabs = _tabs(b);
      _built.clear();
      if (_index >= _cachedTabs!.length) _index = 0;
    }
    final tabs = _cachedTabs!;
    final tab = tabs[_index];
    final wide = MediaQuery.sizeOf(context).width >= 600;
    final subtitle = [b.businessName, if (b.branchName.isNotEmpty) b.branchName].join(' · ');

    final body = IndexedStack(
      index: _index,
      // Built on first visit and kept, so switching tabs keeps their place.
      children: [for (var i = 0; i < tabs.length; i++) i == _index || _built.containsKey(tabs[i].id) ? _built.putIfAbsent(tabs[i].id, tabs[i].build) : const SizedBox.shrink()],
    );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final guard = tab.guard?.currentState;
        if (guard is BackGuard && await guard.handleBack()) return;
        if (_index != 0) {
          setState(() => _index = 0);
          return;
        }
        await SystemNavigator.pop();
      },
      child: Scaffold(
        appBar: AppBar(
          titleSpacing: wide ? 16 : NavigationToolbar.kMiddleSpacing,
          title: InkWell(
            onTap: b.canSwitchBranch ? () => _pickBranch(b) : null,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(tab.label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w500)),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Flexible(child: Text(subtitle, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xCCFFFFFF)))),
                  if (b.canSwitchBranch) const Icon(Icons.arrow_drop_down_rounded, size: 18, color: Color(0xCCFFFFFF)),
                ]),
              ]),
            ),
          ),
        ),
        body: wide
            ? Row(children: [
                NavigationRail(
                  selectedIndex: _index,
                  labelType: NavigationRailLabelType.all,
                  onDestinationSelected: (i) => setState(() => _index = i),
                  destinations: [for (final t in tabs) NavigationRailDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: Text(t.short))],
                ),
                const VerticalDivider(width: 1),
                Expanded(child: body),
              ])
            : body,
        bottomNavigationBar: wide
            ? null
            : NavigationBar(
                selectedIndex: _index,
                onDestinationSelected: (i) => setState(() => _index = i),
                destinations: [for (final t in tabs) NavigationDestination(icon: Icon(t.icon), selectedIcon: Icon(t.selectedIcon), label: t.short)],
              ),
      ),
    );
  }
}
