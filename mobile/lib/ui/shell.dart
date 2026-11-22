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
import 'reports_screen.dart';
import 'sales_screen.dart';
import 'theme.dart';

/// Opens Create Invoice (the website's invoice form) as its own page.
Future<void> openNewInvoice(BuildContext context) {
  final k = GlobalKey<InvoiceScreenState>();
  return Navigator.push(context, MaterialPageRoute(builder: (_) => FormPage(title: 'Create Invoice', guard: k, child: InvoiceScreen(key: k))));
}

/// Opens Add Purchase (the website's purchase form) as its own page.
Future<void> openNewPurchase(BuildContext context) {
  final k = GlobalKey<PurchaseScreenState>();
  return Navigator.push(context, MaterialPageRoute(builder: (_) => FormPage(title: 'Add Purchase', guard: k, child: PurchaseScreen(key: k))));
}

class _Tab {
  _Tab(this.id, this.label, this.icon, this.build, {this.title});
  final String id;
  final String label;
  final IconData icon;
  final Widget Function() build;

  /// The page title in the top bar (the website's page names).
  final String? title;
}

/// The website's frame on a phone: a white top bar (MAVIN mark, page title,
/// business; branch pill and account on the right) and the bottom tabs
/// Home, Sale, Products, Reports, More with a blue bar over the active one.
class Shell extends StatefulWidget {
  const Shell({super.key});

  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _index = 0;
  final Map<String, Widget> _built = {};
  List<_Tab>? _cachedTabs;
  Bootstrap? _cachedFor;

  List<_Tab> _tabs(Bootstrap b) {
    final tabs = <_Tab>[];
    if (b.section('dashboard') != null) {
      tabs.add(_Tab('home', 'Home', Icons.home_outlined, () => HomeScreen(onNewInvoice: () => openNewInvoice(context), onNewPurchase: () => openNewPurchase(context)), title: 'Dashboard'));
    }
    if (b.section('invoices') != null) {
      tabs.add(_Tab('sale', 'Sale', Icons.receipt_long_outlined, () => const SalesScreen(embedded: true), title: 'Invoices Details'));
    }
    if (b.section('stock') != null || b.section('products') != null) {
      tabs.add(_Tab('products', 'Products', Icons.inventory_2_outlined, () => const ProductsScreen(), title: 'Product Details'));
    }
    if (b.section('reports') != null) {
      tabs.add(_Tab('reports', 'Reports', Icons.bar_chart_rounded, () => const ReportsScreen(), title: 'Reports'));
    }
    tabs.add(_Tab('more', 'More', Icons.menu_rounded, () => MoreScreen(tabbed: {for (final t in tabs) t.id}), title: 'More'));
    return tabs;
  }

  Future<void> _pickBranch(Bootstrap b) async {
    final state = AppScope.read(context);
    final id = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Branch', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
          for (final br in b.branches)
            ListTile(
              leading: const Icon(Icons.apartment_rounded),
              title: Row(children: [
                Flexible(child: Text(br.name)),
                if (br.isMain)
                  Container(
                    margin: const EdgeInsets.only(left: 8),
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                    decoration: BoxDecoration(color: mavinTint, borderRadius: BorderRadius.circular(20)),
                    child: const Text('Main', style: TextStyle(fontSize: 11, color: mavinAccent, fontWeight: FontWeight.w600)),
                  ),
              ]),
              subtitle: br.status == 'active' ? null : Text(br.status == 'inactive' ? 'Inactive: view only' : 'Archived: view only'),
              trailing: br.id == b.activeBranch ? const Icon(Icons.check_rounded, color: mavinAccent) : null,
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

  void _account(Bootstrap b) {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(child: AccountPanel(boot: b)),
    );
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

    final body = IndexedStack(
      index: _index,
      children: [for (var i = 0; i < tabs.length; i++) i == _index || _built.containsKey(tabs[i].id) ? _built.putIfAbsent(tabs[i].id, tabs[i].build) : const SizedBox.shrink()],
    );

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (_index != 0) {
          setState(() => _index = 0);
          return;
        }
        await SystemNavigator.pop();
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.white, systemNavigationBarColor: Colors.white),
        child: Scaffold(
          appBar: AppBar(
            titleSpacing: 0,
            leading: const Padding(padding: EdgeInsets.only(left: 14), child: MavinMark(size: 30)),
            leadingWidth: 52,
            title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(tab.title ?? tab.label, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: ink)),
              Text(b.businessName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: muted, fontWeight: FontWeight.w500)),
            ]),
            actions: [
              if (b.branches.isNotEmpty) _BranchPill(name: b.branchName, onTap: b.canSwitchBranch ? () => _pickBranch(b) : null),
              IconButton(tooltip: 'Account', onPressed: () => _account(b), icon: const Icon(Icons.account_circle_outlined, size: 26)),
              const SizedBox(width: 4),
            ],
          ),
          body: wide
              ? Row(children: [
                  NavigationRail(
                    selectedIndex: _index,
                    labelType: NavigationRailLabelType.all,
                    onDestinationSelected: (i) => setState(() => _index = i),
                    destinations: [for (final t in tabs) NavigationRailDestination(icon: Icon(t.icon), label: Text(t.label))],
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: body),
                ])
              : body,
          bottomNavigationBar: wide ? null : _BottomNav(tabs: tabs, index: _index, onTap: (i) => setState(() => _index = i)),
        ),
      ),
    );
  }
}

/// The website's phone bottom bar: white, five columns, the active one blue with a 3px bar on top.
class _BottomNav extends StatelessWidget {
  const _BottomNav({required this.tabs, required this.index, required this.onTap});
  final List<_Tab> tabs;
  final int index;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Color(0x0F000000)))),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 62,
          child: Row(children: [
            for (var i = 0; i < tabs.length; i++)
              Expanded(
                child: InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    onTap(i);
                  },
                  child: Semantics(
                    selected: i == index,
                    button: true,
                    label: tabs[i].label,
                    child: Stack(children: [
                      if (i == index)
                        Align(
                          alignment: Alignment.topCenter,
                          child: Container(width: 34, height: 3, decoration: const BoxDecoration(color: mavinAccent, borderRadius: BorderRadius.vertical(bottom: Radius.circular(3)))),
                        ),
                      Center(
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          Icon(tabs[i].icon, size: 22, color: i == index ? mavinAccent : muted),
                          const SizedBox(height: 3),
                          Text(tabs[i].label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: i == index ? mavinAccent : muted)),
                        ]),
                      ),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

class _BranchPill extends StatelessWidget {
  const _BranchPill({required this.name, this.onTap});
  final String name;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Material(
        color: Colors.white,
        shape: const StadiumBorder(side: BorderSide(color: Color(0x14000000))),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.apartment_rounded, size: 15, color: muted),
              const SizedBox(width: 5),
              ConstrainedBox(constraints: const BoxConstraints(maxWidth: 96), child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600))),
              if (onTap != null) const Icon(Icons.expand_more_rounded, size: 16, color: muted),
            ]),
          ),
        ),
      ),
    );
  }
}

/// The website's profile panel: the login, the BUSINESS rows and Logout.
class AccountPanel extends StatelessWidget {
  const AccountPanel({super.key, required this.boot});
  final Bootstrap boot;

  @override
  Widget build(BuildContext context) {
    final b = boot;
    final role = switch (b.role) { 'owner' => 'Owner', 'staff' => 'Staff', 'super_admin' => 'Super Admin', _ => b.role };
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          CircleAvatar(radius: 24, backgroundColor: mavinAccent, child: Text(b.userName.isEmpty ? '?' : b.userName.trim()[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w700))),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(b.userName.isEmpty ? 'Signed in' : b.userName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              Text(role, style: const TextStyle(color: muted, fontSize: 13)),
            ]),
          ),
        ]),
        const SizedBox(height: 18),
        const SmallCaps('Business'),
        const SizedBox(height: 8),
        WebCard(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          child: Column(children: [
            _row('Name', b.businessName),
            _row('Type', b.businessTypeLabel),
            if (b.branchName.isNotEmpty) _row('Branch', b.branchName),
          ]),
        ),
        const SizedBox(height: 18),
        GradientButton(
          label: 'Logout',
          icon: Icons.logout_rounded,
          expand: true,
          colors: const [Color(0xFFF43F5E), Color(0xFFE11D48)],
          onPressed: () async {
            final ok = await showDialog<bool>(
              context: context,
              builder: (ctx) => AlertDialog(
                title: const Text('Logout of MAVIN Business?'),
                content: const Text('You will need your username and password to sign in again.'),
                actions: [
                  TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                  TextButton(onPressed: () => Navigator.pop(ctx, true), style: TextButton.styleFrom(foregroundColor: noStock), child: const Text('Logout')),
                ],
              ),
            );
            if (ok == true && context.mounted) {
              final state = AppScope.read(context);
              Navigator.pop(context);
              await state.signOut();
            }
          },
        ),
      ]),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(children: [
          SizedBox(width: 80, child: Text(k, style: const TextStyle(color: muted, fontSize: 13))),
          Expanded(child: Text(v, textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5))),
        ]),
      );
}
