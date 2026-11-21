import 'package:material_ui/material_ui.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../core/api.dart';
import '../main.dart';

/// A section that has no native screen yet: the MAVIN.pk web screen, inside
/// the app and already signed in (the app's session is given to the page;
/// the web resumes it without asking for the password). Only MAVIN.pk pages
/// open here.
class WebSection extends StatefulWidget {
  const WebSection({super.key, required this.path});
  final String path;

  @override
  State<WebSection> createState() => WebSectionState();
}

class WebSectionState extends State<WebSection> {
  WebViewController? _c;
  int _progress = 0;
  String? _error;

  Uri get _base => Uri.parse(apiBase);

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    final token = AppScope.read(context).api.token;
    final c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) => mounted ? setState(() => _progress = p) : null,
        onPageStarted: (_) => mounted ? setState(() => _error = null) : null,
        onWebResourceError: (e) {
          if (e.isForMainFrame == true && mounted) setState(() => _error = 'This screen could not be opened. Check the connection and try again.');
        },
        // MAVIN.pk only; anything else stays out of the app.
        onNavigationRequest: (r) => Uri.tryParse(r.url)?.host == _base.host ? NavigationDecision.navigate : NavigationDecision.prevent,
      ));
    final ua = await c.getUserAgent();
    await c.setUserAgent('${ua ?? ''} MavinBusinessApp/3.0.0');
    if (token != null) {
      await WebViewCookieManager().setCookie(WebViewCookie(name: 'hs_session', value: token, domain: _base.host, path: '/'));
    }
    await c.loadRequest(_base.replace(path: widget.path.endsWith('/') ? widget.path : '${widget.path}/'));
    if (mounted) setState(() => _c = c);
  }

  /// Android Back inside the page first; false when the page has nothing to go back to.
  Future<bool> handleBack() async {
    final c = _c;
    if (c != null && await c.canGoBack()) {
      await c.goBack();
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off_rounded, size: 36),
            const SizedBox(height: 10),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton(onPressed: () => _c?.reload(), child: const Text('Try again')),
          ]),
        ),
      );
    }
    return Stack(children: [
      if (_c != null) WebViewWidget(controller: _c!),
      if (_progress < 100) LinearProgressIndicator(value: _progress == 0 ? null : _progress / 100, minHeight: 2),
    ]);
  }
}

/// A web section opened from More, with its own top bar and Back.
class WebSectionPage extends StatefulWidget {
  const WebSectionPage({super.key, required this.title, required this.path});
  final String title;
  final String path;

  @override
  State<WebSectionPage> createState() => _WebSectionPageState();
}

class _WebSectionPageState extends State<WebSectionPage> {
  final _key = GlobalKey<WebSectionState>();

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final handled = await _key.currentState?.handleBack() ?? false;
        if (!handled && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(widget.title)),
        body: WebSection(key: _key, path: widget.path),
      ),
    );
  }
}
