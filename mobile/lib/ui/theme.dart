import 'package:material_ui/material_ui.dart';

/// The MAVIN.pk website's look (src/app/globals.css, components/ui/*):
/// page #f5f5f7, text #1d1d1f, MAVIN blue #1e88e5, navy menu #071640 → #0b2a6b,
/// pill buttons with a gradient, white rounded-2xl cards with a soft shadow,
/// small grey labels above inputs.
const mavinAccent = Color(0xFF1E88E5);
const mavinNavy = Color(0xFF0B2A6B);
const mavinNavyDeep = Color(0xFF071640);
const mavinBlue = mavinAccent;
const mavinTint = Color(0xFFE3F0FC);
const mavinGreen = Color(0xFF10B981);
const saleGreen = Color(0xFF059669);
const purchaseBlue = Color(0xFF2563EB);
const whatsappGreen = Color(0xFF128C4A);
const fbrGreen = Color(0xFF006633);
const lowStock = Color(0xFFD97706);
const noStock = Color(0xFFE11D48);
const ink = Color(0xFF1D1D1F);
const muted = Color(0xFF737373);
const faint = Color(0xFFA3A3A3);
const hairline = Color(0xFFE5E5E5);
const pageBg = Color(0xFFF5F5F7);
const amberHi = Color(0xFFFEF3C7);

/// The app logo's blue gradient (splash, start screen, launcher icon).
const brandLight = Color(0xFF0067B3);
const brandDark = Color(0xFF00225B);

ThemeData mavinTheme() {
  final scheme = ColorScheme.fromSeed(seedColor: mavinAccent, primary: mavinAccent, secondary: mavinNavy, surface: Colors.white, onSurface: ink);
  final base = ThemeData(colorScheme: scheme, useMaterial3: true);
  OutlineInputBorder border(Color c, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: c, width: w));
  return base.copyWith(
    scaffoldBackgroundColor: pageBg,
    textTheme: base.textTheme.apply(bodyColor: ink, displayColor: ink),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      toolbarHeight: 56,
      shape: Border(bottom: BorderSide(color: Color(0x0F000000))),
      titleTextStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: ink),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Colors.transparent,
      elevation: 0,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith((s) => TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: s.contains(WidgetState.selected) ? mavinAccent : muted)),
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? mavinAccent : muted)),
    ),
    navigationRailTheme: const NavigationRailThemeData(backgroundColor: Colors.white, indicatorColor: mavinTint),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      hintStyle: const TextStyle(color: faint, fontSize: 14),
      prefixIconColor: muted,
      suffixIconColor: muted,
      border: border(hairline),
      enabledBorder: border(hairline),
      focusedBorder: border(mavinAccent, 1.5),
      errorBorder: border(noStock),
      focusedErrorBorder: border(noStock, 1.5),
      disabledBorder: border(const Color(0xFFF0F0F0)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: mavinAccent,
        shape: const StadiumBorder(),
        minimumSize: const Size(64, 44),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: const StadiumBorder(),
        backgroundColor: Colors.white,
        foregroundColor: ink,
        minimumSize: const Size(64, 44),
        side: const BorderSide(color: Color(0x14000000)),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(foregroundColor: mavinAccent, textStyle: const TextStyle(fontWeight: FontWeight.w600))),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: SegmentedButton.styleFrom(
        shape: const StadiumBorder(),
        selectedBackgroundColor: const Color(0xFFF59E0B),
        selectedForegroundColor: Colors.white,
        side: const BorderSide(color: hairline),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
        visualDensity: VisualDensity.compact,
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(backgroundColor: mavinAccent, foregroundColor: Colors.white, shape: StadiumBorder()),
    listTileTheme: const ListTileThemeData(iconColor: muted),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0x0A000000))),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(16))),
    ),
    dialogTheme: DialogThemeData(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))),
    snackBarTheme: SnackBarThemeData(behavior: SnackBarBehavior.floating, backgroundColor: const Color(0xFF171717), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), actionTextColor: const Color(0xFF90CAF9)),
    dividerTheme: const DividerThemeData(color: Color(0xFFF0F0F0), space: 1, thickness: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: mavinAccent, linearTrackColor: mavinTint),
  );
}

/// The website's card: white, rounded-2xl, a soft shadow and a faint ring.
class WebCard extends StatelessWidget {
  const WebCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.onTap});
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x0A000000)),
        boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 4, offset: Offset(0, 1))],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(borderRadius: BorderRadius.circular(16), onTap: onTap, child: Padding(padding: padding, child: child)),
      ),
    );
  }
}

/// A pill button with the website's gradient (accent to accent darkened 20%), or a given pair.
class GradientButton extends StatelessWidget {
  const GradientButton({super.key, required this.label, required this.onPressed, this.icon, this.colors, this.busy = false, this.height = 46, this.expand = false});
  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final List<Color>? colors;
  final bool busy;
  final double height;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final c = colors ?? [mavinAccent, Color.lerp(mavinAccent, Colors.black, .2)!];
    final enabled = onPressed != null && !busy;
    final content = Row(mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
      if (busy)
        const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
      else if (icon != null)
        Icon(icon, size: 18, color: Colors.white),
      if (busy || icon != null) const SizedBox(width: 8),
      Flexible(child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14))),
    ]);
    return Opacity(
      opacity: enabled || busy ? 1 : .5,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: c),
          borderRadius: BorderRadius.circular(height),
          boxShadow: [BoxShadow(color: c.first.withValues(alpha: .25), blurRadius: 8, offset: const Offset(0, 2))],
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(height),
            onTap: enabled ? onPressed : null,
            child: SizedBox(height: height, child: Padding(padding: const EdgeInsets.symmetric(horizontal: 18), child: Center(widthFactor: 1, child: content))),
          ),
        ),
      ),
    );
  }
}

/// The website's field: a small grey label above (red * when required), then the input.
class LabeledField extends StatelessWidget {
  const LabeledField({super.key, required this.label, required this.child, this.required = false});
  final String label;
  final Widget child;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      Padding(
        padding: const EdgeInsets.only(bottom: 4, left: 2),
        child: Text.rich(TextSpan(children: [
          if (required) const TextSpan(text: '* ', style: TextStyle(color: noStock)),
          TextSpan(text: label),
        ]), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Color(0xFF525252))),
      ),
      child,
    ]);
  }
}

/// A read-only value boxed like an input (Total, Tax, Payable, Balance).
class ReadOnlyBox extends StatelessWidget {
  const ReadOnlyBox(this.value, {super.key, this.strong = false, this.color});
  final String value;
  final bool strong;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 42,
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      decoration: BoxDecoration(color: const Color(0xFFFAFAFA), borderRadius: BorderRadius.circular(8), border: Border.all(color: hairline)),
      child: Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: strong ? FontWeight.w700 : FontWeight.w500, color: color ?? ink)),
    );
  }
}

/// Small uppercase grey heading (the website's table headers and KPI labels).
class SmallCaps extends StatelessWidget {
  const SmallCaps(this.text, {super.key, this.color = faint});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Text(text.toUpperCase(), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, letterSpacing: 1.2, color: color));
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
