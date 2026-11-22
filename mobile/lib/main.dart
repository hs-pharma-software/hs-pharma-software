import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'core/app_state.dart';
import 'ui/login_screen.dart';
import 'ui/shell.dart';
import 'ui/states.dart';
import 'ui/theme.dart';

/// Shown on the sign-in screen; keep in step with `version:` in pubspec.yaml.
const appVersion = '3.5.0';

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

/// The first screen while the app starts: the logo's blue with the white M
/// exactly where the system splash left it (no jump, no flash), the name
/// under it and a thin progress bar at the bottom.
class StartScreen extends StatelessWidget {
  const StartScreen({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent, systemNavigationBarColor: brandDark),
      child: Scaffold(
        body: DecoratedBox(
          decoration: const BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [brandLight, brandDark])),
          child: Stack(children: [
            Center(child: Image.asset('assets/mavin-glyph.png', width: 110, height: 110, filterQuality: FilterQuality.medium, semanticLabel: 'MAVIN')),
            Align(
              alignment: const Alignment(0, .3),
              child: Column(mainAxisSize: MainAxisSize.min, children: const [
                Text('MAVIN Business', style: TextStyle(fontSize: 23, fontWeight: FontWeight.w700, color: Colors.white, letterSpacing: -.2)),
                SizedBox(height: 4),
                Text('Aap ke business ka muawin', style: TextStyle(fontSize: 13.5, color: Color(0xCCFFFFFF))),
              ]),
            ),
            Align(
              alignment: Alignment.bottomCenter,
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 36),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    SizedBox(
                      width: 140,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: const LinearProgressIndicator(minHeight: 3, color: Colors.white, backgroundColor: Color(0x33FFFFFF)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(message ?? '', style: const TextStyle(fontSize: 12.5, color: Color(0xCCFFFFFF))),
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
