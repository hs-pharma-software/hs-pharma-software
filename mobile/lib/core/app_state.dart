import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'models.dart';

enum AuthStatus { starting, signedOut, signedIn }

/// The signed-in session, the business's start-up details and the chosen
/// branch. The token is kept in Android's Keystore-backed storage, never in
/// plain files; nothing about the business is kept on disk.
class AppState extends ChangeNotifier {
  AppState({Api? api, FlutterSecureStorage? storage})
      : api = api ?? Api(),
        _storage = storage ?? const FlutterSecureStorage() {
    this.api.onSignedOut = () {
      if (status == AuthStatus.signedIn) signOut(message: 'Your session has ended. Sign in again.');
    };
  }

  final Api api;
  final FlutterSecureStorage _storage;

  AuthStatus status = AuthStatus.starting;
  Bootstrap? boot;

  /// Shown on the sign-in screen after a forced sign-out.
  String? notice;

  /// The start-up details could not be read (no connection): the app shows a retry screen.
  ApiException? bootError;

  DateTime? _renewedAt;
  Dashboard? _dashboard;
  DateTime? _dashboardAt;

  static const _kToken = 'session_token';
  static const _kBranch = 'branch_id';

  /// On launch: a saved session is renewed and the business loaded, else the sign-in screen.
  Future<void> start() async {
    final token = await _storage.read(key: _kToken);
    if (token == null) {
      status = AuthStatus.signedOut;
      notifyListeners();
      return;
    }
    api.token = token;
    api.branchId = await _storage.read(key: _kBranch);
    status = AuthStatus.signedIn;
    await loadBootstrap();
    await renewIfDue();
  }

  Future<void> signIn(String username, String password) async {
    final r = await api.post('/api/auth/login/', {'username': username.trim(), 'password': password, 'client': 'android'});
    final token = r['token'] as String?;
    if (token == null) throw ApiException('MAVIN.pk did not start a session. Update the app and try again.');
    api.token = token;
    api.branchId = null;
    await _storage.write(key: _kToken, value: token);
    await _storage.delete(key: _kBranch);
    notice = null;
    _renewedAt = DateTime.now();
    status = AuthStatus.signedIn;
    await loadBootstrap();
  }

  Future<void> loadBootstrap() async {
    bootError = null;
    try {
      boot = Bootstrap.fromJson(await api.get('/api/app/bootstrap/'));
      // The server's choice when ours is no longer allowed.
      if (boot!.activeBranch != null && boot!.activeBranch != api.branchId) api.branchId = boot!.activeBranch;
    } on ApiException catch (e) {
      if (e.signedOut) return;
      bootError = e;
    }
    notifyListeners();
  }

  /// Keeps the sign-in alive: MAVIN.pk gives a fresh token for a session in use (at most hourly).
  Future<void> renewIfDue() async {
    if (status != AuthStatus.signedIn) return;
    if (_renewedAt != null && DateTime.now().difference(_renewedAt!) < const Duration(hours: 1)) return;
    try {
      final r = await api.post('/api/app/session/', const {});
      final fresh = r['token'] as String?;
      if (fresh != null) {
        api.token = fresh;
        await _storage.write(key: _kToken, value: fresh);
      }
      _renewedAt = DateTime.now();
    } on ApiException {
      // Offline: tried again next time the app is opened.
    }
  }

  Future<void> switchBranch(String id) async {
    api.branchId = id;
    await _storage.write(key: _kBranch, value: id);
    _dashboard = null;
    await loadBootstrap();
  }

  /// Home figures, read again after a minute or on pull-down.
  Future<Dashboard> dashboard({bool force = false}) async {
    if (!force && _dashboard != null && _dashboardAt != null && DateTime.now().difference(_dashboardAt!) < const Duration(seconds: 60)) {
      return _dashboard!;
    }
    _dashboard = Dashboard.fromJson(await api.get('/api/app/dashboard/'));
    _dashboardAt = DateTime.now();
    return _dashboard!;
  }

  Future<void> signOut({String? message}) async {
    final hadToken = api.token != null;
    if (hadToken && message == null) {
      try {
        await api.post('/api/auth/logout/', const {});
      } on ApiException {
        // Signed out on this phone anyway.
      }
    }
    api.token = null;
    api.branchId = null;
    boot = null;
    _dashboard = null;
    _renewedAt = null;
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kBranch);
    notice = message;
    status = AuthStatus.signedOut;
    notifyListeners();
  }
}
