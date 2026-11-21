import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mavin_business/core/api.dart';
import 'package:mavin_business/core/format.dart';
import 'package:mavin_business/core/models.dart';

void main() {
  test('money, quantity and expiry formats', () {
    expect(rs(1250), 'Rs 1,250');
    expect(rs(1250.5), 'Rs 1,250.5');
    expect(qty(48), '48');
    expect(monthYear('2028-05-31'), 'May 2028');
    expect(monthYear('2027-03'), 'Mar 2027');
    expect(dayMonthYear('2026-11-21T09:30:00Z'), '21 Nov 2026');
    expect(soldQty(3, 10), '3');
    expect(soldQty(0.2, 10), '2 units (of 10)');
    expect(soldQty(2 / 21, 21), '2 units (of 21)');
  });

  test('invoice list and one invoice', () {
    final page = InvoicePage.fromJson({
      'rows': [
        {'id': 'i2', 'invoiceNo': 2, 'date': '2026-11-21', 'customer': 'Bilal Medical', 'payable': 500, 'paid': 200, 'balance': 300, 'fbrNo': null},
      ],
      'nextOffset': null,
    });
    expect(page.rows.single.no, 2);
    expect(page.rows.single.balance, 300);
    expect(page.nextOffset, isNull);
    final d = InvoiceDetail.fromJson({
      'id': 'i2', 'invoiceNo': 2, 'date': '2026-11-21', 'customer': 'Bilal Medical', 'payable': 500, 'paid': 200, 'balance': 300,
      'phone': '03001234567', 'salesman': null, 'total': 500, 'discount': 0, 'charges': 0,
      'items': [
        {'product': 'Panadol', 'batchNo': 'PN-A', 'qty': 0.2, 'packing': 10, 'bonus': 0, 'price': 350, 'discount': 0, 'tax': 0, 'total': 70},
      ],
    });
    expect(d.head.customer, 'Bilal Medical');
    expect(d.phone, '03001234567');
    expect(soldQty(d.items.single.qty, d.items.single.packing), '2 units (of 10)');
  });

  test('bootstrap: sections, branch name, settings', () {
    final b = Bootstrap.fromJson({
      'user': {'id': 'u1', 'name': 'Ahmed', 'role': 'owner'},
      'business': {'id': 't1', 'name': 'Al-Shifa Pharmacy', 'type': 'retail_pharmacy', 'typeLabel': 'Retail Pharmacy', 'logo': null},
      'sections': [
        {'key': 'dashboard', 'label': 'Dashboard', 'path': '/dashboard', 'native': true, 'children': []},
        {'key': 'invoices', 'label': 'Invoices', 'path': '/invoices', 'native': true, 'children': [{'key': null, 'label': 'Invoices Details', 'path': '/invoices'}]},
      ],
      'deniedActions': ['invoice.delete'],
      'costHidden': false,
      'branches': {'list': [{'id': 'b1', 'name': 'Main Branch', 'isMain': true, 'status': 'active'}], 'active': 'b1', 'canSwitch': false},
      'settings': {'billoriEnabled': false, 'currency': 'PKR'},
    });
    expect(b.section('invoices')!.children.single.label, 'Invoices Details');
    expect(b.section('purchase'), isNull);
    expect(b.branchName, 'Main Branch');
    expect(b.billoriEnabled, isFalse);
  });

  test('products page and detail; a hidden purchase price stays hidden', () {
    final page = ProductPage.fromJson({
      'rows': [{'id': 'p1', 'name': 'Panadol', 'qty': 48, 'salePrice': 350, 'unit': null}],
      'offset': 0,
      'nextOffset': null,
    });
    expect(page.rows.single.qty, 48);
    expect(page.nextOffset, isNull);
    final d = ProductDetail.fromJson({
      'id': 'p1', 'name': 'Panadol', 'qty': 48, 'salePrice': 350, 'mrp': 0, 'packing': 10,
      'batches': [{'batchNo': 'A', 'expiry': '2028-05-31', 'qty': 30, 'purchasePrice': null}],
    });
    expect(d.batches.single.purchasePrice, isNull);
  });

  test('api: sends the token and branch; reads the server error; 401 signs out; no connection is "offline"', () async {
    late http.Request seen;
    var signedOut = false;
    final api = Api(client: MockClient((req) async {
      seen = req;
      if (req.url.path == '/api/app/bootstrap/') return http.Response(jsonEncode({'error': 'Your session has ended. Log in again.'}), 401);
      if (req.url.path == '/api/app/products/') return http.Response(jsonEncode({'error': 'Product not found.'}), 404);
      throw const SocketException('down');
    }))
      ..token = 'tok'
      ..branchId = 'b2'
      ..onSignedOut = () => signedOut = true;

    await expectLater(api.get('/api/app/products/', {'id': 'x'}), throwsA(isA<ApiException>().having((e) => e.message, 'message', 'Product not found.')));
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.headers['X-Branch'], 'b2');
    expect(seen.url.queryParameters['id'], 'x');

    await expectLater(api.get('/api/app/bootstrap/'), throwsA(isA<ApiException>().having((e) => e.signedOut, 'signedOut', true)));
    expect(signedOut, isTrue);

    await expectLater(api.get('/api/app/dashboard/'), throwsA(isA<ApiException>().having((e) => e.offline, 'offline', true)));
  });
}
