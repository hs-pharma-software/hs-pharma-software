import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api.dart';
import '../main.dart';
import 'theme.dart';

/// MAVIN support on WhatsApp (the number on mavin.pk/contact).
const _supportWhatsApp = '923160585858';

/// Sign-in: the MAVIN.pk logo, a welcome line, username and password with
/// icons, one large button, and help for a forgotten password.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _user = TextEditingController();
  final _pass = TextEditingController();
  final _passFocus = FocusNode();
  bool _busy = false;
  bool _hide = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    final last = AppScope.read(context).lastUsername;
    if (last != null && last.isNotEmpty) _user.text = last;
  }

  @override
  void dispose() {
    _user.dispose();
    _pass.dispose();
    _passFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_user.text.trim().isEmpty || _pass.text.isEmpty) {
      setState(() => _error = 'Enter your username and password.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AppScope.read(context).signIn(_user.text, _pass.text);
      TextInput.finishAutofillContext();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _help() async {
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            const Text('Forgot your password?', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            const Text('Staff: ask your business owner to reset it from Staff in MAVIN.pk.\n\nOwner: contact MAVIN support and we will help you sign in again.', style: TextStyle(color: muted, height: 1.4)),
            const SizedBox(height: 18),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: whatsappGreen, minimumSize: const Size.fromHeight(50)),
              onPressed: () {
                Navigator.pop(ctx);
                launchUrl(Uri.parse('https://wa.me/$_supportWhatsApp?text=${Uri.encodeComponent('Assalam o Alaikum, I need help signing in to MAVIN Business.')}'), mode: LaunchMode.externalApplication);
              },
              icon: const Icon(Icons.chat_rounded),
              label: const Text('Message MAVIN support'),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final notice = AppScope.of(context).notice;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(statusBarColor: Colors.transparent, systemNavigationBarColor: Colors.white),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: SafeArea(
          child: LayoutBuilder(
            builder: (context, c) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: c.maxHeight),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: AutofillGroup(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        const SizedBox(height: 40),
                        const Center(child: MavinLogo(width: 230)),
                        const SizedBox(height: 40),
                        const Text('Welcome back', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: Color(0xFF101828), letterSpacing: -.4)),
                        const SizedBox(height: 6),
                        const Text('Sign in to your business with your MAVIN.pk login.', style: TextStyle(fontSize: 14.5, color: muted)),
                        if (notice != null) ...[
                          const SizedBox(height: 16),
                          _Banner(icon: Icons.info_outline_rounded, text: notice, color: lowStock, background: const Color(0xFFFFF6E8)),
                        ],
                        const SizedBox(height: 28),
                        TextField(
                          controller: _user,
                          autofillHints: const [AutofillHints.username],
                          textInputAction: TextInputAction.next,
                          autocorrect: false,
                          enableSuggestions: false,
                          onSubmitted: (_) => _passFocus.requestFocus(),
                          onChanged: (_) => _error == null ? null : setState(() => _error = null),
                          decoration: const InputDecoration(labelText: 'Username', prefixIcon: Icon(Icons.person_outline_rounded)),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: _pass,
                          focusNode: _passFocus,
                          obscureText: _hide,
                          autofillHints: const [AutofillHints.password],
                          textInputAction: TextInputAction.done,
                          onSubmitted: (_) => _submit(),
                          onChanged: (_) => _error == null ? null : setState(() => _error = null),
                          decoration: InputDecoration(
                            labelText: 'Password',
                            prefixIcon: const Icon(Icons.lock_outline_rounded),
                            suffixIcon: IconButton(
                              tooltip: _hide ? 'Show password' : 'Hide password',
                              icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                              onPressed: () => setState(() => _hide = !_hide),
                            ),
                          ),
                        ),
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(onPressed: _help, child: const Text('Forgot password?')),
                        ),
                        if (_error != null) ...[
                          _Banner(icon: Icons.error_outline_rounded, text: _error!, color: noStock, background: const Color(0xFFFDECEC)),
                          const SizedBox(height: 14),
                        ] else
                          const SizedBox(height: 6),
                        FilledButton(
                          onPressed: _busy ? null : _submit,
                          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54), disabledBackgroundColor: mavinNavy.withValues(alpha: .75), disabledForegroundColor: Colors.white),
                          child: _busy
                              ? const Row(mainAxisSize: MainAxisSize.min, children: [
                                  SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white)),
                                  SizedBox(width: 12),
                                  Text('Signing in…'),
                                ])
                              : const Text('Sign in'),
                        ),
                        const SizedBox(height: 40),
                        const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Icon(Icons.verified_user_outlined, size: 15, color: muted),
                          SizedBox(width: 6),
                          Text('Secure sign-in · Your data stays on MAVIN.pk', style: TextStyle(fontSize: 12, color: muted)),
                        ]),
                        const SizedBox(height: 6),
                        const Center(child: Text('MAVIN Business $appVersion', style: TextStyle(fontSize: 12, color: Color(0xFF98A2B3)))),
                        const SizedBox(height: 20),
                      ]),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.text, required this.color, required this.background});
  final IconData icon;
  final String text;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: background, borderRadius: BorderRadius.circular(10)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 19, color: color),
        const SizedBox(width: 8),
        Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w500))),
      ]),
    );
  }
}
