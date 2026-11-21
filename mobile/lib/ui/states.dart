import 'package:material_ui/material_ui.dart';

import '../core/api.dart';

/// A message in the middle of a screen: nothing found, an error, no connection.
class StateMessage extends StatelessWidget {
  const StateMessage({super.key, required this.icon, required this.title, this.detail, this.action, this.onAction});

  factory StateMessage.error(Object error, {required VoidCallback onRetry}) {
    final offline = error is ApiException && error.offline;
    return StateMessage(
      icon: offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: offline ? 'No internet connection' : 'Couldn\'t load this',
      detail: error is ApiException ? error.message : 'Something went wrong. Your data is safe.',
      action: 'Try again',
      onAction: onRetry,
    );
  }

  final IconData icon;
  final String title;
  final String? detail;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 36, color: muted),
          const SizedBox(height: 10),
          Text(title, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500)),
          if (detail != null) ...[const SizedBox(height: 6), Text(detail!, textAlign: TextAlign.center, style: TextStyle(color: muted))],
          if (action != null) ...[const SizedBox(height: 14), FilledButton(onPressed: onAction, child: Text(action!))],
        ]),
      ),
    );
  }
}

/// Grey placeholder rows while a list loads (no spinner jumping around).
class LoadingRows extends StatelessWidget {
  const LoadingRows({super.key, this.count = 8, this.height = 56});
  final int count;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, _) => const Divider(),
      itemBuilder: (_, i) => Container(
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
        color: Colors.white,
        child: Row(children: [
          Expanded(flex: 5, child: _bar()),
          const SizedBox(width: 24),
          Expanded(flex: 1, child: _bar()),
          const SizedBox(width: 16),
          Expanded(flex: 2, child: _bar()),
        ]),
      ),
    );
  }

  Widget _bar() => Container(decoration: BoxDecoration(color: const Color(0xFFEEF1F6), borderRadius: BorderRadius.circular(4)));
}
