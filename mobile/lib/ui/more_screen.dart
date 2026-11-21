import 'package:material_ui/material_ui.dart';

import '../main.dart';
import 'theme.dart';
import 'web_section.dart';

/// Every other section this login has (any business type), the account and
/// signing out. Sections without a native screen open the web screen in the app.
class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key, required this.tabbed});

  /// Tab ids already on the bottom bar.
  final Set<String> tabbed;

  static const _tabKeys = {'home': 'dashboard', 'sell': 'invoices', 'purchase': 'purchase'};

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final b = state.boot!;
    final onTabs = {for (final t in tabbed) _tabKeys[t]};
    if (tabbed.contains('products')) onTabs.addAll({'stock'});
    final sections = b.sections.where((s) => !onTabs.contains(s.key)).toList();

    void open(String title, String path) => Navigator.push(context, MaterialPageRoute(builder: (_) => WebSectionPage(title: title, path: path)));

    return ListView(padding: const EdgeInsets.only(bottom: 24), children: [
      ListTile(
        leading: CircleAvatar(backgroundColor: mavinTint, foregroundColor: mavinNavy, child: Text(b.userName.isEmpty ? '?' : b.userName[0].toUpperCase())),
        title: Text(b.userName.isEmpty ? 'Signed in' : b.userName),
        subtitle: Text('${b.businessName} · ${b.businessTypeLabel}'),
      ),
      const Divider(),
      if (sections.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No other sections for this login.')),
      for (final s in sections)
        if (s.children.length > 1)
          ExpansionTile(
            title: Text(s.label),
            children: [for (final c in s.children) ListTile(contentPadding: const EdgeInsets.only(left: 32, right: 16), title: Text(c.label), onTap: () => open(c.label, c.path))],
          )
        else
          ListTile(title: Text(s.label), trailing: const Icon(Icons.chevron_right_rounded), onTap: () => open(s.label, s.children.length == 1 ? s.children.first.path : s.path)),
      const Divider(),
      ListTile(
        leading: const Icon(Icons.logout_rounded),
        title: const Text('Sign out'),
        onTap: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (ctx) => AlertDialog(
              title: const Text('Sign out of MAVIN Business?'),
              content: const Text('You will need your username and password to sign in again.'),
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out')),
              ],
            ),
          );
          if (ok == true) await state.signOut();
        },
      ),
    ]);
  }
}
