import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// MAVIN.pk, where the app's data lives. Override for testing with
/// `--dart-define=MAVIN_API=https://...`.
const String apiBase = String.fromEnvironment('MAVIN_API', defaultValue: 'https://app.mavin.pk');

/// What went wrong with a call, in words for the person using the app.
class ApiException implements Exception {
  ApiException(this.message, {this.status, this.offline = false});
  final String message;
  final int? status;

  /// No connection (or MAVIN.pk did not answer): the request may be repeated.
  final bool offline;

  bool get signedOut => status == 401;

  @override
  String toString() => message;
}

/// Calls MAVIN.pk with the signed-in session (a Bearer token) and the chosen
/// branch. Every answer is checked by the server again; the app never
/// decides access on its own.
class Api {
  Api({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;
  String? token;
  String? branchId;

  /// Called when MAVIN.pk says the session has ended (signed out elsewhere, password changed).
  void Function()? onSignedOut;

  static const _timeout = Duration(seconds: 25);

  Map<String, String> _headers({bool json = false}) => {
        'Accept': 'application/json',
        if (json) 'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        if (branchId != null && branchId!.isNotEmpty) 'X-Branch': branchId!,
      };

  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) async {
    final uri = Uri.parse('$apiBase$path').replace(queryParameters: (query == null || query.isEmpty) ? null : query);
    return _send(() => _client.get(uri, headers: _headers()));
  }

  Future<Map<String, dynamic>> post(String path, Object body) async {
    final uri = Uri.parse('$apiBase$path');
    return _send(() => _client.post(uri, headers: _headers(json: true), body: jsonEncode(body)));
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() call) async {
    http.Response res;
    try {
      res = await call().timeout(_timeout);
    } on SocketException {
      throw ApiException('No internet connection. Check the connection and try again.', offline: true);
    } on TimeoutException {
      throw ApiException('MAVIN.pk did not answer in time. Try again.', offline: true);
    } on http.ClientException {
      throw ApiException('Could not reach MAVIN.pk. Check the connection and try again.', offline: true);
    }
    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {
      // Not JSON: handled below by the status.
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final message = (body['error'] as String?) ?? 'MAVIN.pk answered ${res.statusCode}. Try again.';
    if (res.statusCode == 401) onSignedOut?.call();
    throw ApiException(message, status: res.statusCode);
  }
}
