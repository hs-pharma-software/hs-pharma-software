import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'core/app_state.dart';
import 'ui/login_screen.dart';
import 'ui/shell.dart';
import 'ui/states.dart';
import 'ui/theme.dart';

/// Shown on the sign-in screen; keep in step with `version:` in pubspec.yaml.
const appVersion = '3.1.0';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState()..start();
  runApp(MavinApp(state: state));
}

/// Gives every screen the app's state.
class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);
  static AppState of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
  static AppState read(BuildContext context) => context.getInheritedWidgetOfExactType<AppScope>()!.notifier!;
}

class MavinApp extends StatefulWidget {
  const MavinApp({super.key, required this.state});
  final AppState state;

  @override
  State<MavinApp> createState() => _MavinAppState();
}

class _MavinAppState extends State<MavinApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Back in the app: keep the sign-in alive.
    if (s == AppLifecycleState.resumed) widget.state.renewIfDue();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: widget.state,
      child: MaterialApp(
        title: 'MAVIN Business',
        debugShowCheckedModeBanner: false,
        theme: mavinTheme(),
        home: const _Root(),
      ),
    );
  }
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    switch (s.status) {
      case AuthStatus.starting:
        return const StartScreen();
      case AuthStatus.signedOut:
        return const LoginScreen();
      case AuthStatus.signedIn:
        if (s.boot != null) return const Shell();
        if (s.bootError != null) {
          return Scaffold(backgroundColor: Colors.white, body: SafeArea(child: StateMessage.error(s.bootError!, onRetry: s.loadBootstrap)));
        }
        return const StartScreen(message: 'Opening your business…');
    }
  }
}

/// The first screen while the app starts: white with the MAVIN mark, exactly
/// where the system splash left it, then the wordmark and a thin progress bar.
class StartScreen extends StatelessWidget {
  const StartScreen({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent, systemNavigationBarColor: Colors.white),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: Column(children: [
            const Spacer(),
            const MavinMark(size: 112),
            const SizedBox(height: 18),
            const Text('MAVIN Business', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: mavinNavy, letterSpacing: -.3)),
            const SizedBox(height: 4),
            const Text('Aap ke business ka muawin', style: TextStyle(fontSize: 13.5, color: muted)),
            const Spacer(),
            SizedBox(width: 140, child: ClipRRect(borderRadius: BorderRadius.circular(4), child: const LinearProgressIndicator(minHeight: 3))),
            const SizedBox(height: 12),
            Text(message ?? '', style: const TextStyle(fontSize: 12.5, color: muted)),
            const SizedBox(height: 36),
          ]),
        ),
      ),
    );
  }
}
