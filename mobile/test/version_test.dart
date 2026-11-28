import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mavin_business/main.dart';

void main() {
  test('the version shown in the app is the one in pubspec.yaml', () {
    final line = File('pubspec.yaml').readAsLinesSync().firstWhere((l) => l.startsWith('version:'));
    expect(appVersion, line.split(':')[1].trim().split('+').first);
  });
}
