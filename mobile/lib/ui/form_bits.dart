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
    return Material(
      color: Colors.white,
      elevation: 6,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            if (problem != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: InkWell(
                  onTap: onProblem,
                  child: Row(children: [
                    const Icon(Icons.error_outline_rounded, size: 18, color: noStock),
                    const SizedBox(width: 6),
                    Expanded(child: Text(problem!, style: const TextStyle(color: noStock, fontSize: 13))),
                  ]),
                ),
              ),
            Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
              Expanded(child: Text(label, style: const TextStyle(color: Color(0xFF667085)))),
              if (pending) const Padding(padding: EdgeInsets.only(right: 8), child: SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))),
              Text(payable == null ? '—' : rs(payable!), style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
            ]),
            if (balance != null && balance!.abs() > 0.004)
              Row(children: [
                const Expanded(child: Text('Balance', style: TextStyle(fontSize: 12.5, color: Color(0xFF667085)))),
                Text(rs(balance!), style: const TextStyle(fontSize: 12.5, color: noStock, fontWeight: FontWeight.w500)),
              ]),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: busy ? null : onAction,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: Text(busy ? 'Saving…' : action),
            ),
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
