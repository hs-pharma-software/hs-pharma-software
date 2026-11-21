import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mavin_business/core/api.dart';
import 'package:mavin_business/core/app_state.dart';
import 'package:mavin_business/main.dart';
import 'package:mavin_business/ui/purchase_screen.dart';
import 'package:material_ui/material_ui.dart';

/// A fake MAVIN.pk: two products, one with a visible purchase price, and the preview totals.
MockClient fakeServer(List<http.Request> seen) => MockClient((req) async {
      seen.add(req);
      final p = req.url.path;
      if (p == '/api/app/products/' && req.url.queryParameters.containsKey('id')) {
        return http.Response(jsonEncode({
          'id': req.url.queryParameters['id'], 'name': 'x', 'qty': 5, 'salePrice': 350, 'mrp': 0, 'packing': 1,
          'batches': [{'batchNo': 'A', 'expiry': '2028-01-31', 'qty': 5, 'purchasePrice': 300}],
        }), 200);
      }
      if (p == '/api/app/products/') {
        return http.Response(jsonEncode({
          'rows': [
            {'id': 'p1', 'name': 'Panadol', 'qty': 48, 'salePrice': 350, 'packing': 10},
            {'id': 'p2', 'name': 'Risek', 'qty': 30, 'salePrice': 640, 'packing': 14},
          ],
          'offset': 0, 'nextOffset': null,
        }), 200);
      }
      if (p == '/api/app/purchase/') {
        return http.Response(jsonEncode({'subtotal': 3000, 'discount': 0, 'tax': 0, 'payable': 3000, 'balance': 3000, 'lines': [{'total': 3000}]}), 200);
      }
      return http.Response(jsonEncode({'error': 'not in this test'}), 404);
    });

/// Types in the search at the top of the form and taps the match.
Future<void> addProduct(WidgetTester t, String name) async {
  await t.enterText(find.widgetWithText(TextField, 'Search product to add, or scan barcode'), name.substring(0, 3));
  await t.pump(const Duration(milliseconds: 300));
  await t.pumpAndSettle();
  await t.tap(find.text(name).last);
  await t.pumpAndSettle();
}

void main() {
  testWidgets('the next product closes the previous row and keeps its values; missing details are flagged', (t) async {
    t.view.physicalSize = const Size(1080, 2400);
    t.view.devicePixelRatio = 3;
    addTearDown(t.view.reset);
    final seen = <http.Request>[];
    final state = AppState(api: Api(client: fakeServer(seen))..token = 'tok');
    await t.pumpWidget(AppScope(state: state, child: const MaterialApp(home: Scaffold(body: PurchaseScreen()))));

    await addProduct(t, 'Panadol');
    // The new row is open with the latest purchase price and the sale price filled in.
    expect(find.widgetWithText(TextField, 'Qty'), findsOneWidget);
    expect(find.widgetWithText(TextField, '300'), findsOneWidget);
    await t.enterText(find.widgetWithText(TextField, 'Qty'), '10');
    await t.pumpAndSettle();

    await addProduct(t, 'Risek');
    // One row open at a time: Risek now.
    expect(find.widgetWithText(TextField, 'Qty'), findsOneWidget);
    expect(find.widgetWithText(TextField, '10'), findsNothing);

    // Close Risek (no quantity yet): it shows what is missing.
    await t.tap(find.text('Risek'));
    await t.pumpAndSettle();
    expect(find.text('1 to fix'), findsOneWidget);

    // Panadol opens again with its quantity kept.
    await t.tap(find.text('Panadol'));
    await t.pumpAndSettle();
    expect(find.widgetWithText(TextField, '10'), findsOneWidget);

    // Saving without a supplier is refused before anything is sent.
    final posts = seen.where((r) => r.method == 'POST').length;
    await t.tap(find.text('Save'));
    await t.pumpAndSettle();
    expect(find.text('Choose the supplier.'), findsOneWidget);
    expect(seen.where((r) => r.method == 'POST' && !r.url.query.contains('preview')).length, 0);
    expect(seen.where((r) => r.method == 'POST').length, posts, reason: 'no save and no preview without a supplier');
  });
}
