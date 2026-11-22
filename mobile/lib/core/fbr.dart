import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api.dart';

/// What FBR said about an invoice.
class FbrResult {
  FbrResult({required this.success, this.fbrInvoiceNo, this.error, required this.outcome});
  final bool success;
  final String? fbrInvoiceNo;
  final String? error;

  /// accepted, rejected, uncertain or not_received.
  final String outcome;

  factory FbrResult.fromJson(Map<String, dynamic> j) =>
      FbrResult(success: j['success'] == true, fbrInvoiceNo: j['fbrInvoiceNo'] as String?, error: j['error'] as String?, outcome: '${j['outcome'] ?? ''}');
}

/// Whether this login may submit invoices to FBR (asked once per session).
bool? _available;
Future<bool> fbrAvailable(Api api) async {
  if (_available != null) return _available!;
  try {
    _available = (await api.get('/api/app/fbr/'))['available'] == true;
  } on ApiException {
    return false;
  }
  return _available!;
}

void forgetFbrAvailability() => _available = null;

/// Submit to FBR, the website's way: MAVIN.pk builds the FBR invoice from the
/// saved invoice and records the attempt (one at a time per invoice). With
/// MAVIN's gateway the server sends it; otherwise ("direct") this phone sends
/// it to FBR, as the website's browser does, and reports FBR's answer.
Future<FbrResult> submitInvoiceToFbr(Api api, String invoiceId, {http.Client? client}) async {
  final r = await api.post('/api/app/fbr/', {'action': 'submit', 'invoiceId': invoiceId});
  final direct = r['direct'] as Map<String, dynamic>?;
  if (direct == null) return FbrResult.fromJson(r);

  Map<String, Object?> report;
  final c = client ?? http.Client();
  try {
    final res = await c
        .post(Uri.parse('${direct['url']}'), headers: {'Authorization': 'Bearer ${direct['token']}', 'Content-Type': 'application/json'}, body: jsonEncode(direct['payload']))
        .timeout(const Duration(seconds: 45));
    report = {'kind': 'response', 'status': res.statusCode, 'text': utf8.decode(res.bodyBytes, allowMalformed: true)};
  } on TimeoutException {
    report = {'kind': 'uncertain', 'error': 'FBR did not answer within 45 seconds.'};
  } catch (e) {
    // The phone cannot tell "never sent" from "sent, answer lost": both are unclear.
    report = {'kind': 'uncertain', 'error': 'The connection to FBR failed ($e).'};
  } finally {
    if (client == null) c.close();
  }
  return FbrResult.fromJson(await api.post('/api/app/fbr/', {'action': 'finish', 'submissionId': r['submissionId'], 'report': report}));
}
