import 'package:material_ui/material_ui.dart';

import 'core/app_state.dart';
import 'ui/login_screen.dart';
import 'ui/shell.dart';
import 'ui/states.dart';
import 'ui/theme.dart';

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
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case AuthStatus.signedOut:
        return const LoginScreen();
      case AuthStatus.signedIn:
        if (s.boot != null) return const Shell();
        if (s.bootError != null) {
          return Scaffold(body: SafeArea(child: StateMessage.error(s.bootError!, onRetry: s.loadBootstrap)));
        }
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
  }
}
