import 'package:flutter/material.dart';
import 'core.dart';
import 'auth.dart';

class MeridianApp extends StatelessWidget {
  const MeridianApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(
    title: 'Meridian', debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: primary),
      scaffoldBackgroundColor: const Color(0xFFF7F9FD),
      appBarTheme: const AppBarTheme(backgroundColor: Colors.white, surfaceTintColor: Colors.transparent),
      cardTheme: CardThemeData(color: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Color(0xFFE8EDF5)))),
    ),
    home: const EntryPage(),
  );
}

