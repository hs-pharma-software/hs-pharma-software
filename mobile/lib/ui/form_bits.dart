import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api.dart';
import '../core/format.dart';
import 'theme.dart';

/// A tab whose screen decides what Android Back does (an unsaved form asks first).
mixin BackGuard<T extends StatefulWidget> on State<T> {
  /// True when Back was handled here (stay on this screen).
  Future<bool> handleBack();
}

/// Numbers only (and one decimal point), never negative.
final numberInput = [FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d*'))];

double numOf(TextEditingController c) => double.tryParse(c.text.trim()) ?? 0;

/// A short number field (quantity, rate, percent) for rows of 2–4 fields.
class NumField extends StatelessWidget {
  const NumField({super.key, required this.controller, required this.label, this.onChanged, this.error, this.decimal = true, this.suffix});
  final TextEditingController controller;
  final String label;
  final ValueChanged<String>? onChanged;
  final String? error;
  final bool decimal;
  final String? suffix;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      keyboardType: TextInputType.numberWithOptions(decimal: decimal),
      inputFormatters: numberInput,
      textInputAction: TextInputAction.next,
      decoration: InputDecoration(labelText: label, errorText: error, suffixText: suffix, errorMaxLines: 2),
    );
  }
}

/// A form (Create Invoice, Add Purchase) as its own page; Back asks the form first.
class FormPage extends StatelessWidget {
  const FormPage({super.key, required this.title, required this.guard, required this.child});
  final String title;
  final GlobalKey guard;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final g = guard.currentState;
        if (g is BackGuard && await g.handleBack()) return;
        if (context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(title)),
        body: child,
      ),
    );
  }
}

Future<bool> confirmDiscard(BuildContext context, String what) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Discard this $what?'),
      content: const Text('The lines you added will be lost.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep editing')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), style: TextButton.styleFrom(foregroundColor: noStock), child: const Text('Discard')),
      ],
    ),
  );
  return r == true;
}

/// After a lost connection the result of a save is unknown: sending the same
/// document again is safe (it can never be saved twice).
Future<bool> askRetryUnknown(BuildContext context, ApiException e, String what) async {
  final r = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text('Not sure the $what was saved'),
      content: Text('${e.message}\n\nTry again sends the same $what. It can never be saved twice.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Later')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Try again')),
      ],
    ),
  );
  return r == true;
}

/// Totals and the main action, kept above the keyboard.
class TotalsBar extends StatelessWidget {
  const TotalsBar({super.key, required this.label, required this.payable, this.balance, this.problem, this.onProblem, required this.action, required this.onAction, this.busy = false, this.pending = false});
  final String label;
  final double? payable;
  final double? balance;
  final String? problem;
  final VoidCallback? onProblem;
  final String action;
  final VoidCallback? onAction;
  final bool busy;

  /// The server is working the totals out again.
  final bool pending;

  @override
  Widget build(BuildContext context) {
    final due = balance != null && balance!.abs() > 0.004;
    return Material(
      color: Colors.white,
      elevation: 10,
      shadowColor: const Color(0x33000000),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 12, 10),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (problem != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: InkWell(
                  onTap: onProblem,
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(color: const Color(0xFFFDECEC), borderRadius: BorderRadius.circular(10)),
                    child: Row(children: [
                      const Icon(Icons.error_outline_rounded, size: 18, color: noStock),
                      const SizedBox(width: 8),
                      Expanded(child: Text(problem!, style: const TextStyle(color: noStock, fontSize: 13, fontWeight: FontWeight.w500))),
                    ]),
                  ),
                ),
              ),
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Row(children: [
                    Flexible(child: Text('Total · $label', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, color: muted, fontWeight: FontWeight.w500))),
                    if (pending) const Padding(padding: EdgeInsets.only(left: 8), child: SizedBox(width: 11, height: 11, child: CircularProgressIndicator(strokeWidth: 1.8))),
                  ]),
                  const SizedBox(height: 2),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(payable == null ? 'Rs 0' : rs(payable!), style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w800, color: Color(0xFF101828), letterSpacing: -.4)),
                  ),
                  if (due) Text('Balance ${rs(balance!)}', style: const TextStyle(fontSize: 12.5, color: noStock, fontWeight: FontWeight.w600)),
                ]),
              ),
              const SizedBox(width: 12),
              FilledButton.icon(
                onPressed: busy ? null : onAction,
                style: FilledButton.styleFrom(minimumSize: const Size(132, 52), padding: const EdgeInsets.symmetric(horizontal: 22)),
                icon: busy ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white)) : const Icon(Icons.check_rounded),
                label: Text(busy ? 'Saving…' : action),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

class SectionLabel extends StatelessWidget {
  const SectionLabel(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
        child: Text(text.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: .6, color: Color(0xFF667085))),
      );
}
