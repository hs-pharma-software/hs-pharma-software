import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mavin_business/core/api.dart';
import 'package:mavin_business/core/app_state.dart';
import 'package:mavin_business/main.dart';
import 'package:mavin_business/ui/invoice_screen.dart';
import 'package:mavin_business/ui/invoice_share.dart';
import 'package:material_ui/material_ui.dart';

MockClient fakeServer(List<http.Request> seen) => MockClient((req) async {
      seen.add(req);
      if (req.url.path == '/api/app/products/') {
        final q = req.url.queryParameters['q'] ?? '';
        final all = [
          {'id': 'p1', 'name': 'Panadol', 'barcode': '896001', 'qty': 48, 'salePrice': 350, 'packing': 10},
          {'id': 'p2', 'name': 'Pantra', 'barcode': '896002', 'qty': 0, 'salePrice': 120, 'packing': 1},
        ];
        final rows = all.where((p) => '${p['name']}'.toLowerCase().contains(q.toLowerCase()) || p['barcode'] == q).toList();
        return http.Response(jsonEncode({'rows': rows, 'offset': 0, 'nextOffset': null}), 200);
      }
      if (req.url.path == '/api/app/sale/') {
        final lines = (jsonDecode(req.body)['lines'] as List).length;
        return http.Response(jsonEncode({'subtotal': 700, 'discount': 0, 'tax': 0, 'payable': 700, 'balance': 0, 'lines': List.filled(lines, {'total': 700})}), 200);
      }
      return http.Response(jsonEncode({'error': 'not in this test'}), 404);
    });

void main() {
  test('WhatsApp numbers: Pakistani mobiles in any common form; wrong ones explained', () {
    expect(normalizePhone('0300-1234567').intl, '923001234567');
    expect(normalizePhone('+92 300 1234567').intl, '923001234567');
    expect(normalizePhone('3001234567').intl, '923001234567');
    expect(normalizePhone('00971501234567').intl, '971501234567');
    expect(normalizePhone('042-1234567').error, isNotNull);
    expect(normalizePhone('').error, isNotNull);
  });

  testWidgets('invoice: type and tap to add; Enter adds a scanned barcode; the same product twice is quantity 2; out of stock cannot be added', (t) async {
    t.view.physicalSize = const Size(1080, 2400);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final seen = <http.Request>[];
    final state = AppState(api: Api(client: fakeServer(seen))..token = 'tok');
    await t.pumpWidget(AppScope(state: state, child: const MaterialApp(home: Scaffold(body: InvoiceScreen()))));
    expect(find.text('Start a new invoice'), findsOneWidget);

    final search = find.widgetWithText(TextField, 'Search medicine or scan barcode');
    await t.enterText(search, 'pan');
    await t.pump(const Duration(milliseconds: 300));
    await t.pumpAndSettle();
    expect(find.text('Out of stock'), findsOneWidget);
    // Pantra has no stock: tapping it adds nothing.
    await t.tap(find.text('Pantra'));
    await t.pumpAndSettle();
    expect(find.text('1 product'), findsNothing, reason: 'nothing added');
    await t.tap(find.text('Panadol'));
    await t.pumpAndSettle();
    expect(find.text('Start a new invoice'), findsNothing);
    expect(find.text('1 product'), findsOneWidget);

    // A barcode scanner types the code and presses Enter.
    await t.enterText(find.byType(TextField).first, '896001');
    await t.pump(const Duration(milliseconds: 300));
    await t.pumpAndSettle();
    await t.testTextInput.receiveAction(TextInputAction.search);
    await t.pumpAndSettle();
    expect(find.text('1 product'), findsOneWidget, reason: 'the same product: one line');
    expect(find.text('2'), findsOneWidget, reason: 'quantity 2');
    // The added line's highlight fades.
    await t.pump(const Duration(seconds: 1));
  });
}
