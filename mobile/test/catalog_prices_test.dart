import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mavin_business/core/api.dart';
import 'package:mavin_business/core/app_state.dart';
import 'package:mavin_business/main.dart';
import 'package:mavin_business/ui/catalog_prices.dart';
import 'package:material_ui/material_ui.dart';

/// A fake MAVIN.pk with one price rise and one approved pack size to answer.
MockClient fakeServer(List<Map<String, dynamic>> sent) => MockClient((req) async {
      final body = jsonDecode(req.body) as Map<String, dynamic>;
      sent.add(body);
      if (body['action'] == 'notices') {
        return http.Response.bytes(utf8.encode(jsonEncode({
          'result': [
            {'id': 'n1', 'kind': 'increase', 'name': 'Panadol', 'myPrice': 100, 'newPrice': 110, 'confirmations': 1},
            {'id': 'n2', 'kind': 'packing', 'name': 'Risek', 'myPrice': 640, 'newPrice': 0, 'oldPacking': 10, 'newPacking': 14},
          ],
        })), 200);
      }
      return http.Response(jsonEncode({'result': {'ok': true}}), 200);
    });

void main() {
  testWidgets('Home shows the price changes; Yes and OK are sent to MAVIN.pk', (t) async {
    final sent = <Map<String, dynamic>>[];
    final state = AppState(api: Api(client: fakeServer(sent))..token = 'tok');
    await t.pumpWidget(AppScope(state: state, child: const MaterialApp(home: Scaffold(body: PriceChangesCard(reload: 0)))));
    await t.pumpAndSettle();
    expect(find.text('Price changes (2)'), findsOneWidget);

    await t.tap(find.text('Price changes (2)'));
    await t.pumpAndSettle();
    expect(find.textContaining('Confirmed by 1 other business'), findsOneWidget);
    await t.tap(find.text('Yes'));
    await t.pumpAndSettle();
    expect(sent.last, {'action': 'answer', 'id': 'n1', 'answer': 'yes'});
    expect(find.text('Panadol'), findsNothing);
    await t.tap(find.text('OK'));
    await t.pump();
    expect(sent.any((b) => b['id'] == 'n2' && b['answer'] == 'no'), isTrue);
  });

  testWidgets('after a purchase only the ticked prices are shared; No shares nothing', (t) async {
    final sent = <Map<String, dynamic>>[];
    final state = AppState(api: Api(client: fakeServer(sent))..token = 'tok');
    final questions = PriceQuestion.list([
      {'productId': 'p1', 'name': 'Panadol', 'oldPrice': 100, 'newPrice': 110, 'direction': 'up'},
      {'productId': 'p2', 'name': 'Risek', 'oldPrice': 640, 'newPrice': 600, 'direction': 'down'},
    ]);
    await t.pumpWidget(AppScope(
      state: state,
      child: MaterialApp(home: Scaffold(body: Builder(builder: (c) => TextButton(onPressed: () => askPriceQuestions(c, questions), child: const Text('ask'))))),
    ));
    await t.tap(find.text('ask'));
    await t.pumpAndSettle();
    await t.tap(find.text('No, only my price'));
    await t.pumpAndSettle();
    expect(sent, isEmpty);

    await t.tap(find.text('ask'));
    await t.pumpAndSettle();
    await t.tap(find.text('Risek'));
    await t.pumpAndSettle();
    await t.tap(find.text('Yes, it changed'));
    await t.pumpAndSettle();
    expect(sent.single['action'], 'propose');
    expect(sent.single['items'], [
      {'productId': 'p1', 'price': 110.0, 'previousPrice': 100.0}
    ]);
  });
}
