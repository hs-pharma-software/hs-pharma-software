import 'package:material_ui/material_ui.dart';

/// MAVIN navy and blue (the website's and the logo's colours), Material 3.
const mavinNavy = Color(0xFF0B2A6B);
const mavinBlue = Color(0xFF1565C0);
const mavinTint = Color(0xFFE7EEFB);
const mavinGreen = Color(0xFF12A150);
const whatsappGreen = Color(0xFF1FA855);
const lowStock = Color(0xFFB25E00);
const noStock = Color(0xFFC62828);
const muted = Color(0xFF667085);
const hairline = Color(0xFFE4E7EE);
const pageBg = Color(0xFFF4F6FB);

ThemeData mavinTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: mavinNavy, primary: mavinNavy, secondary: mavinBlue, surface: Colors.white);
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  final text = base.textTheme.copyWith(
    titleLarge: base.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: -.2),
    titleMedium: base.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600),
    bodyMedium: base.textTheme.bodyMedium?.copyWith(height: 1.3),
  );
  final radius12 = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: c, width: w));
  return base.copyWith(
    textTheme: text,
    scaffoldBackgroundColor: pageBg,
    appBarTheme: const AppBarTheme(
      backgroundColor: mavinNavy,
      foregroundColor: Colors.white,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      toolbarHeight: 58,
      titleTextStyle: TextStyle(fontSize: 19, fontWeight: FontWeight.w600, color: Colors.white, letterSpacing: -.2),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: mavinTint,
      elevation: 3,
      shadowColor: const Color(0x22000000),
      height: 66,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 12, fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500, color: s.contains(WidgetState.selected) ? mavinNavy : muted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(color: s.contains(WidgetState.selected) ? mavinNavy : muted)),
    ),
    navigationRailTheme: const NavigationRailThemeData(backgroundColor: Colors.white, indicatorColor: mavinTint),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      prefixIconColor: muted,
      suffixIconColor: muted,
      labelStyle: const TextStyle(color: muted),
      floatingLabelStyle: const TextStyle(color: mavinNavy, fontWeight: FontWeight.w500),
      border: border(const Color(0xFFD5DAE4)),
      enabledBorder: border(const Color(0xFFD5DAE4)),
      focusedBorder: border(mavinNavy, 1.6),
      errorBorder: border(noStock),
      focusedErrorBorder: border(noStock, 1.6),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: radius12,
        minimumSize: const Size(64, 48),
        textStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, letterSpacing: .1),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: radius12,
        minimumSize: const Size(64, 46),
        side: const BorderSide(color: Color(0xFFD5DAE4)),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(textStyle: const TextStyle(fontWeight: FontWeight.w600))),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        shape: radius12,
        selectedBackgroundColor: mavinNavy,
        selectedForegroundColor: Colors.white,
        side: const BorderSide(color: Color(0xFFD5DAE4)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(backgroundColor: mavinNavy, foregroundColor: Colors.white, extendedTextStyle: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
    listTileTheme: const ListTileThemeData(minVerticalPadding: 10, dense: false, iconColor: muted),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: hairline)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent, showDragHandle: true),
    dialogTheme: DialogThemeData(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18))),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: const Color(0xFF1B2333), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), actionTextColor: const Color(0xFF8FB8FF)),
    dividerTheme: const DividerThemeData(color: hairline, space: 1, thickness: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: mavinNavy, linearTrackColor: mavinTint),
  );
}

/// The MAVIN.pk logo (wordmark), sized by width.
class MavinLogo extends StatelessWidget {
  const MavinLogo({super.key, this.width = 220});
  final double width;
  @override
  Widget build(BuildContext context) => Image.asset('assets/mavin-logo.png', width: width, filterQuality: FilterQuality.medium, semanticLabel: 'MAVIN.pk');
}

/// The MAVIN "M" mark.
class MavinMark extends StatelessWidget {
  const MavinMark({super.key, this.size = 96});
  final double size;
  @override
  Widget build(BuildContext context) => Image.asset('assets/mavin-mark.png', width: size, height: size, filterQuality: FilterQuality.medium, semanticLabel: 'MAVIN');
}
