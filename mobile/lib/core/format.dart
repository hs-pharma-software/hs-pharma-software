import 'package:intl/intl.dart';

final _money = NumberFormat('#,##0.##', 'en_US');
final _qty = NumberFormat('#,##0.##', 'en_US');

/// "Rs 1,250" / "Rs 1,250.5".
String rs(num v) => 'Rs ${_money.format(v)}';

/// "48" / "2.5".
String qty(num v) => _qty.format(v);

/// "2028-05-31" -> "May 2028".
String monthYear(String? isoDate) {
  if (isoDate == null || isoDate.length < 7) return isoDate ?? '';
  final d = DateTime.tryParse(isoDate.length == 7 ? '$isoDate-01' : isoDate);
  return d == null ? isoDate : DateFormat('MMM yyyy', 'en_US').format(d);
}
