import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../main.dart';
import 'theme.dart';

/// A WhatsApp number as wa.me wants it (digits with the country code), or why it is not one.
/// Pakistan first: 03xx-xxxxxxx, 3xx xxxxxxx, +92 3xx..., 0092...; other countries with +.
({String? intl, String? error}) normalizePhone(String input) {
  final raw = input.trim();
  if (raw.isEmpty) return (intl: null, error: 'Enter the customer\'s WhatsApp number.');
  var d = raw.replaceAll(RegExp(r'[^\d+]'), '');
  if (d.startsWith('+')) {
    d = d.substring(1);
  } else if (d.startsWith('00')) {
    d = d.substring(2);
  } else if (RegExp(r'^0\d{10}$').hasMatch(d)) {
    d = '92${d.substring(1)}';
  } else if (RegExp(r'^3\d{9}$').hasMatch(d)) {
    d = '92$d';
  }
  // Still starting with 0 here: a landline or a short number, not a WhatsApp mobile.
  if (!RegExp(r'^[1-9]\d{7,14}$').hasMatch(d)) return (intl: null, error: 'Use a mobile number: 03xx-xxxxxxx or +92 3xx xxxxxxx.');
  if (d.startsWith('92') && !RegExp(r'^923\d{9}$').hasMatch(d)) return (intl: null, error: 'A Pakistani mobile number is 03xx followed by 7 digits.');
  return (intl: d, error: null);
}

/// Whether this login may send invoices on WhatsApp (the server checks again).
bool canShareInvoices(BuildContext context) => !(AppScope.of(context).boot?.deniedActions.contains('invoice.whatsapp') ?? false);

/// Send an invoice: its PDF straight into the customer's WhatsApp chat, the
/// message alone, or the PDF to any other app. The person presses Send in
/// WhatsApp; the app never sends anything by itself.
Future<void> shareInvoice(BuildContext context, {required String invoiceId}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _ShareSheet(invoiceId: invoiceId),
  );
}

const _channel = MethodChannel('pk.mavin.business/whatsapp');

class _ShareSheet extends StatefulWidget {
  const _ShareSheet({required this.invoiceId});
  final String invoiceId;

  @override
  State<_ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<_ShareSheet> {
  final _phone = TextEditingController();
  final _message = TextEditingController();
  int? _no;
  String _fileName = 'Invoice.pdf';
  List<String> _apps = const [];
  bool _loading = true;
  String? _busy;
  String? _error;
  String? _phoneError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _phone.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await AppScope.read(context).api.post('/api/invoices/share/', {'action': 'whatsapp', 'invoiceId': widget.invoiceId});
      final info = (r['result'] as Map?) ?? const {};
      List<String> apps = const [];
      try {
        apps = [for (final a in (await _channel.invokeListMethod<String>('apps')) ?? const <String>[]) a];
      } on PlatformException {
        // Treated as not installed.
      } on MissingPluginException {
        // Not Android.
      }
      if (!mounted) return;
      setState(() {
        _message.text = '${info['message'] ?? ''}';
        _phone.text = '${info['phone'] ?? ''}';
        _no = info['invoiceNo'] is num ? (info['invoiceNo'] as num).toInt() : null;
        _fileName = '${info['fileName'] ?? 'Invoice.pdf'}';
        _apps = apps;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  /// The number for WhatsApp; empty is allowed for the PDF (WhatsApp then asks for the chat).
  String? _intl({required bool required}) {
    if (_phone.text.trim().isEmpty && !required) return '';
    final p = normalizePhone(_phone.text);
    setState(() => _phoneError = p.error);
    return p.intl;
  }

  Future<File> _pdf() async {
    final bytes = await AppScope.read(context).api.postBytes('/api/invoices/share/', {'action': 'pdf', 'invoiceId': widget.invoiceId, 'purpose': 'share'});
    final dir = Directory('${(await getTemporaryDirectory()).path}/share_plus');
    await dir.create(recursive: true);
    final f = File('${dir.path}/$_fileName');
    await f.writeAsBytes(bytes, flush: true);
    return f;
  }

  void _log(String channel) {
    // Written to the business's audit log (who and which invoice; no customer details).
    AppScope.read(context).api.post('/api/invoices/share/', {'action': 'whatsapp', 'invoiceId': widget.invoiceId, 'log': 'open', 'channel': channel}).catchError((_) => <String, dynamic>{});
  }

  Future<void> _run(String what, Future<void> Function() job) async {
    if (_busy != null) return;
    setState(() {
      _busy = what;
      _error = null;
    });
    try {
      await job();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = e.message ?? 'WhatsApp could not be opened.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _sendPdf(String pkg) => _run(pkg, () async {
        final phone = _intl(required: false);
        if (phone == null) return;
        final f = await _pdf();
        if (!mounted) return;
        _log('share-sheet');
        await _channel.invokeMethod('sendFile', {'path': f.path, 'package': pkg, 'phone': phone, 'text': _message.text.trim()});
        if (mounted) Navigator.pop(context);
      });

  Future<void> _sendText() => _run('text', () async {
        final phone = _intl(required: true);
        if (phone == null) return;
        _log('link');
        final ok = await launchUrl(Uri.parse('https://wa.me/$phone?text=${Uri.encodeComponent(_message.text.trim())}'), mode: LaunchMode.externalApplication);
        if (!ok && mounted) setState(() => _error = 'WhatsApp could not be opened.');
        if (ok && mounted) Navigator.pop(context);
      });

  Future<void> _shareOther() => _run('other', () async {
        final f = await _pdf();
        if (!mounted) return;
        _log('share-sheet');
        await SharePlus.instance.share(ShareParams(files: [XFile(f.path, mimeType: 'application/pdf')], text: _message.text.trim(), subject: _fileName));
      });

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 16 + bottom),
      child: SafeArea(
        top: false,
        child: _loading
            ? const SizedBox(height: 180, child: Center(child: CircularProgressIndicator()))
            : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: whatsappGreen.withValues(alpha: .12), borderRadius: BorderRadius.circular(12)),
                    child: const Icon(Icons.chat_rounded, color: whatsappGreen),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_no == null ? 'Send invoice' : 'Send invoice #$_no', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
                      const Text('The PDF opens in the customer\'s WhatsApp chat. You press Send.', style: TextStyle(fontSize: 12.5, color: muted)),
                    ]),
                  ),
                ]),
                const SizedBox(height: 18),
                if (_error != null && _message.text.isEmpty) ...[
                  _ErrorLine(_error!),
                  const SizedBox(height: 8),
                ] else ...[
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    onChanged: (_) => _phoneError == null ? null : setState(() => _phoneError = null),
                    decoration: InputDecoration(labelText: 'Customer\'s WhatsApp number', hintText: '03xx xxxxxxx', prefixIcon: const Icon(Icons.phone_outlined), errorText: _phoneError),
                  ),
                  const SizedBox(height: 12),
                  TextField(controller: _message, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Message', alignLabelWithHint: true)),
                  const SizedBox(height: 16),
                  if (_error != null) ...[_ErrorLine(_error!), const SizedBox(height: 10)],
                  if (_apps.isEmpty)
                    const Padding(padding: EdgeInsets.only(bottom: 10), child: Text('WhatsApp is not installed on this phone. Share the PDF with another app, or send the message.', style: TextStyle(color: muted))),
                  for (final pkg in _apps) ...[
                    FilledButton.icon(
                      style: FilledButton.styleFrom(backgroundColor: whatsappGreen, minimumSize: const Size.fromHeight(52)),
                      onPressed: _busy != null ? null : () => _sendPdf(pkg),
                      icon: _busy == pkg ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white)) : const Icon(Icons.picture_as_pdf_rounded),
                      label: Text(_busy == pkg ? 'Preparing PDF…' : (pkg == 'com.whatsapp.w4b' ? 'Send PDF on WhatsApp Business' : 'Send PDF on WhatsApp')),
                    ),
                    const SizedBox(height: 10),
                  ],
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy != null ? null : _sendText,
                        icon: const Icon(Icons.sms_outlined, size: 20),
                        label: const Text('Message only'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _busy != null ? null : _shareOther,
                        icon: _busy == 'other' ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.ios_share_rounded, size: 20),
                        label: const Text('Other apps'),
                      ),
                    ),
                  ]),
                ],
              ]),
      ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  const _ErrorLine(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFFFDECEC), borderRadius: BorderRadius.circular(10)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.error_outline_rounded, color: noStock, size: 19),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: noStock, fontWeight: FontWeight.w500))),
        ]),
      );
}
