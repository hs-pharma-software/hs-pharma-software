/// What the app reads from MAVIN.pk (src/server/appReads.ts on the server).
library;

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
String? _str(Object? v) => v == null || v == '' ? null : '$v';

class Section {
  Section({required this.key, required this.label, required this.path, required this.native, required this.children});
  factory Section.fromJson(Map<String, dynamic> j) => Section(
        key: '${j['key']}',
        label: '${j['label']}',
        path: '${j['path']}',
        native: j['native'] == true,
        children: [
          for (final c in (j['children'] as List? ?? const []))
            SectionChild(key: _str((c as Map)['key']), label: '${c['label']}', path: '${c['path']}'),
        ],
      );
  final String key;
  final String label;
  final String path;
  final bool native;
  final List<SectionChild> children;
}

class SectionChild {
  SectionChild({required this.key, required this.label, required this.path});
  final String? key;
  final String label;
  final String path;
}

class Branch {
  Branch({required this.id, required this.name, required this.isMain, required this.status});
  final String id;
  final String name;
  final bool isMain;
  final String status;
}

class Bootstrap {
  Bootstrap({
    required this.userName,
    required this.role,
    required this.businessName,
    required this.businessType,
    required this.businessTypeLabel,
    required this.logo,
    required this.sections,
    required this.deniedActions,
    required this.costHidden,
    required this.branches,
    required this.activeBranch,
    required this.canSwitchBranch,
    required this.billoriEnabled,
  });

  factory Bootstrap.fromJson(Map<String, dynamic> j) {
    final b = j['business'] as Map<String, dynamic>? ?? const {};
    final u = j['user'] as Map<String, dynamic>? ?? const {};
    final br = j['branches'] as Map<String, dynamic>? ?? const {};
    final s = j['settings'] as Map<String, dynamic>? ?? const {};
    return Bootstrap(
      userName: '${u['name'] ?? ''}',
      role: '${u['role'] ?? ''}',
      businessName: '${b['name'] ?? ''}',
      businessType: '${b['type'] ?? ''}',
      businessTypeLabel: '${b['typeLabel'] ?? ''}',
      logo: _str(b['logo']),
      sections: [for (final x in (j['sections'] as List? ?? const [])) Section.fromJson(x as Map<String, dynamic>)],
      deniedActions: [for (final x in (j['deniedActions'] as List? ?? const [])) '$x'],
      costHidden: j['costHidden'] == true,
      branches: [
        for (final x in (br['list'] as List? ?? const []))
          Branch(id: '${(x as Map)['id']}', name: '${x['name']}', isMain: x['isMain'] == true, status: '${x['status']}'),
      ],
      activeBranch: _str(br['active']),
      canSwitchBranch: br['canSwitch'] == true,
      billoriEnabled: s['billoriEnabled'] == true,
    );
  }

  final String userName;
  final String role;
  final String businessName;
  final String businessType;
  final String businessTypeLabel;
  final String? logo;
  final List<Section> sections;
  final List<String> deniedActions;
  final bool costHidden;
  final List<Branch> branches;
  final String? activeBranch;
  final bool canSwitchBranch;
  final bool billoriEnabled;

  Section? section(String key) {
    for (final s in sections) {
      if (s.key == key) return s;
    }
    return null;
  }

  String get branchName {
    for (final b in branches) {
      if (b.id == activeBranch) return b.name;
    }
    return branches.isEmpty ? '' : branches.first.name;
  }
}

class ProductRow {
  ProductRow({required this.id, required this.name, required this.qty, required this.salePrice, this.unit});
  factory ProductRow.fromJson(Map<String, dynamic> j) =>
      ProductRow(id: '${j['id']}', name: '${j['name']}', qty: _num(j['qty']), salePrice: _num(j['salePrice']), unit: _str(j['unit']));
  final String id;
  final String name;
  final double qty;
  final double salePrice;
  final String? unit;
}

class ProductPage {
  ProductPage({required this.rows, required this.nextOffset});
  factory ProductPage.fromJson(Map<String, dynamic> j) => ProductPage(
        rows: [for (final x in (j['rows'] as List? ?? const [])) ProductRow.fromJson(x as Map<String, dynamic>)],
        nextOffset: j['nextOffset'] is num ? (j['nextOffset'] as num).toInt() : null,
      );
  final List<ProductRow> rows;
  final int? nextOffset;
}

class Batch {
  Batch({required this.batchNo, required this.expiry, required this.qty, required this.purchasePrice});
  final String? batchNo;
  final String? expiry;
  final double qty;

  /// Null: hidden from this login.
  final double? purchasePrice;
}

class ProductDetail {
  ProductDetail({
    required this.id,
    required this.name,
    required this.barcode,
    required this.company,
    required this.category,
    required this.packing,
    required this.unit,
    required this.salePrice,
    required this.mrp,
    required this.qty,
    required this.batches,
  });
  factory ProductDetail.fromJson(Map<String, dynamic> j) => ProductDetail(
        id: '${j['id']}',
        name: '${j['name']}',
        barcode: _str(j['barcode']),
        company: _str(j['company']),
        category: _str(j['category']),
        packing: _num(j['packing']),
        unit: _str(j['unit']),
        salePrice: _num(j['salePrice']),
        mrp: _num(j['mrp']),
        qty: _num(j['qty']),
        batches: [
          for (final x in (j['batches'] as List? ?? const []))
            Batch(
              batchNo: _str((x as Map)['batchNo']),
              expiry: _str(x['expiry']),
              qty: _num(x['qty']),
              purchasePrice: x['purchasePrice'] == null ? null : _num(x['purchasePrice']),
            ),
        ],
      );
  final String id;
  final String name;
  final String? barcode;
  final String? company;
  final String? category;
  final double packing;
  final String? unit;
  final double salePrice;
  final double mrp;
  final double qty;
  final List<Batch> batches;
}

class Dashboard {
  Dashboard({required this.sales, required this.invoiceCount, required this.expenses, required this.cashIn, required this.cashOut, required this.lowStock, required this.expiring, required this.recent});
  factory Dashboard.fromJson(Map<String, dynamic> j) {
    final s = j['summary'] as Map<String, dynamic>? ?? const {};
    return Dashboard(
      sales: _num(s['sales']),
      invoiceCount: _num(s['invoiceCount']).toInt(),
      expenses: _num(s['expenses']),
      cashIn: _num(s['cashIn']),
      cashOut: _num(s['cashOut']),
      lowStock: [for (final x in (j['lowStock'] as List? ?? const [])) (id: '${(x as Map)['id']}', name: '${x['name']}', qty: _num(x['qty']))],
      expiring: [
        for (final x in (j['expiring'] as List? ?? const []))
          (product: '${(x as Map)['product']}', batchNo: _str(x['batchNo']), expiry: '${x['expiry']}', qty: _num(x['qty'])),
      ],
      recent: [
        for (final x in (j['recentInvoices'] as List? ?? const []))
          (no: (x as Map)['invoiceNo'] is num ? (x['invoiceNo'] as num).toInt() : null, customer: '${x['customer']}', total: _num(x['total']), balance: _num(x['balance'])),
      ],
    );
  }
  final double sales;
  final int invoiceCount;
  final double expenses;
  final double cashIn;
  final double cashOut;
  final List<({String id, String name, double qty})> lowStock;
  final List<({String product, String? batchNo, String expiry, double qty})> expiring;
  final List<({int? no, String customer, double total, double balance})> recent;
}
