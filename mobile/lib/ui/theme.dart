import 'package:material_ui/material_ui.dart';

/// MAVIN navy and blue (the website's colours), Material 3, Roboto.
const mavinNavy = Color(0xFF0B2A6B);
const mavinBlue = Color(0xFF1565C0);
const mavinTint = Color(0xFFE7EEFB);
const lowStock = Color(0xFFB25E00);
const noStock = Color(0xFFC62828);

ThemeData mavinTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: mavinNavy, primary: mavinNavy, secondary: mavinBlue, surface: const Color(0xFFF7F8FC));
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF4F6FB),
    appBarTheme: const AppBarTheme(backgroundColor: mavinNavy, foregroundColor: Colors.white, elevation: 0, centerTitle: false, toolbarHeight: 56),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: mavinTint,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: s.contains(WidgetState.selected) ? mavinNavy : const Color(0xFF667085))),
    ),
    navigationRailTheme: const NavigationRailThemeData(backgroundColor: Colors.white, indicatorColor: mavinTint),
    inputDecorationTheme: InputDecorationTheme(
      isDense: true,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFFCFD5E1))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Color(0xFFCFD5E1))),
    ),
    listTileTheme: const ListTileThemeData(minVerticalPadding: 10, dense: false),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0xFFE4E7EE))),
    ),
    dividerTheme: const DividerThemeData(color: Color(0xFFE4E7EE), space: 1, thickness: 1),
  );
}
